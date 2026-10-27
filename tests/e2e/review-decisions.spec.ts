import "dotenv/config";
import { test, expect, request, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { authPost } from "./auth-request";
import { db } from "../../src/server/db";
import { emptyProfile } from "../../src/modules/clinical-profile/contract";
import type { ReviewEventData } from "../../src/lib/assessments";
const origin = "http://localhost:3000";
test.describe.serial("Действия по версии основания", () => {
  let doctor: APIRequestContext, patient: APIRequestContext, other: APIRequestContext;
  let doctorId = "", patientUser = "", otherId = "", patientId = "", eventId = "", secondEvent = "", firstBasis = "";
  let lastSend: object;
  const get = async (id = eventId): Promise<ReviewEventData> => { const r = await doctor.get(`/api/review-events?eventId=${id}`); expect(r.status()).toBe(200); return r.json(); };
  const post = (data: object) => doctor.post("/api/review-events", { data });
  async function refresh(id = eventId) { const e = await get(id); const r = await post({ action: "refresh-context", eventId: id, revision: e.revision, contextToken: e.currentContext!.token, reviewed: true }); expect(r.status()).toBe(200); return get(id); }
  async function observation() { const r = await patient.post("/api/workspace", { data: { action: "observation", patientId, score: 3, note: "Учебное обновление самочувствия", needsContact: false, requestKey: randomUUID() } }); expect(r.status()).toBe(200); }
  test.beforeAll(async () => {
    async function account(name: string, role: string) {
      const client = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
      const r = await authPost(client, "/api/auth/sign-up/email", { name, email: `decision-${randomUUID()}@synthetic.kontur.demo`, password: randomUUID() }); expect(r.status()).toBe(200); const id = (await r.json()).user.id;
      if (role === "DOCTOR") await db.user.update({ where: { id }, data: { role, specialty: "Тестовый профиль" } }); return { client, id };
    }
    const d = await account("Врач событий", "DOCTOR"); doctor = d.client; doctorId = d.id;
    const p = await account("Пациент событий", "PATIENT"); patient = p.client; patientUser = p.id;
    const o = await account("Другой врач событий", "DOCTOR"); other = o.client; otherId = o.id;
    patientId = (await db.patient.create({ data: { doctorId, userId: patientUser, name: "Разбор Учебный", publicId: `DECISION-${randomUUID()}`, birthDate: new Date("1990-01-01") } })).id;
    const catalogue = await (await doctor.get(`/api/assessments?patientId=${patientId}`)).json();
    const assigned = await doctor.post("/api/assessments", { data: { action: "assign", patientId, definitionId: catalogue.assignableDefinitionIds[0] } }); expect(assigned.status()).toBe(200); const assignmentId = (await assigned.json()).id;
    expect((await patient.post("/api/assessments", { data: { action: "submit", assignmentId, revision: 0, answers: { clarity: "unclear", contact: "yes" }, note: "Уточнить порядок следующего контакта", requestKey: randomUUID() } })).status()).toBe(200);
    const events = await db.reviewEvent.findMany({ where: { patientId } }); eventId = events.find(e => e.ruleId === "contact_requested")!.id; secondEvent = events.find(e => e.id !== eventId)!.id;
  });
  test.afterAll(async () => {
    if (patientId) await db.patient.deleteMany({ where: { id: patientId, doctorId: { in: [doctorId, otherId].filter(Boolean) } } });
    await db.auditEvent.deleteMany({ where: { actorId: { in: [doctorId, patientUser, otherId].filter(Boolean) } } });
    await db.user.deleteMany({ where: { id: { in: [doctorId, patientUser, otherId].filter(Boolean) } } });
    await Promise.all([doctor?.dispose(), patient?.dispose(), other?.dispose()]); await db.$disconnect();
  });
  test("доступ, повтор взятия в работу и проверяемое основание", async () => {
    expect((await patient.get(`/api/review-events?eventId=${eventId}`)).status()).toBe(403); expect((await other.get(`/api/review-events?eventId=${eventId}`)).status()).toBe(404);
    expect((await get()).basis).toBeNull();
    const commands = await Promise.all([post({ action: "claim", eventId, revision: 0 }), post({ action: "claim", eventId, revision: 0 })]); expect(commands.map(r => r.status())).toEqual([200, 200]);
    const e = await get(); firstBasis = e.basis!.id; expect(e.basis?.version).toBe(1); expect(e.basis?.actions).toEqual(e.actions); expect(e.basis?.catalogue.version).toBe(1); expect(e.basis?.catalogue.checksum).toMatch(/^[a-f0-9]{64}$/); expect(e.basis?.context.unknowns).toHaveLength(3);
    expect((await doctor.get(`/api/review-events?eventId=${secondEvent}&basisId=${firstBasis}`)).status()).toBe(404);
    const resolve = { action: "resolve", eventId, revision: e.revision, basisId: firstBasis, actionId: "contact_patient", outcome: "Сообщение сохранено", method: "IN_APP_MESSAGE", requestKey: randomUUID(), reviewed: true };
    expect((await post(resolve)).status()).toBe(409); expect((await post({ ...resolve, method: "NOTE" })).status()).toBe(400); expect((await post({ ...resolve, reviewed: false })).status()).toBe(400);
  });
  test("новые сведения требуют проверки, старые основания остаются неизменными", async () => {
    const before = await get();
    const content = emptyProfile(); content.conditions.note = "Требуется уточнить сведения на следующем контакте";
    expect((await doctor.post("/api/clinical-profile", { data: { patientId, expectedVersion: 0, content, requestKey: randomUUID(), reviewed: true } })).status()).toBe(200);
    const care = await (await doctor.get(`/api/care?patientId=${patientId}`)).json();
    const draft = await doctor.post("/api/care", { data: { action: "save-draft", patientId, revision: 0, basisToken: care.context.token, content: { goal: "Уточнить вопросы до следующего контакта", instructions: "Подготовьте вопросы, которые хотите обсудить с врачом.", nextContactDate: null, tasks: [] } } }); expect(draft.status()).toBe(200); const saved = await draft.json();
    expect((await doctor.post("/api/care", { data: { action: "confirm", patientId, draftId: saved.id, revision: saved.revision, reviewed: true, requestKey: randomUUID() } })).status()).toBe(200);
    const stale = await get(); expect(stale.stale).toBe(true); expect(stale.currentContext?.profile?.version).toBe(1); expect(stale.basis).toEqual(before.basis);
    const send = { action: "send-message", eventId, revision: stale.revision, basisId: firstBasis, actionId: "contact_patient", text: "Проверка устаревшего основания", requestKey: randomUUID(), reviewed: true };
    expect((await post(send)).status()).toBe(409);
    expect((await post({ action: "refresh-context", eventId, revision: stale.revision, contextToken: before.currentContext!.token, reviewed: true })).status()).toBe(409);
    const fresh = await refresh(); expect(fresh.basis?.version).toBe(2); expect(fresh.basis?.context.plan?.version).toBe(1); expect(fresh.stale).toBe(false);
    expect((await (await doctor.get(`/api/review-events?eventId=${eventId}&basisId=${firstBasis}`)).json()).context.profile).toBeNull();
    await observation(); expect((await get()).stale).toBe(true); await refresh();
    expect((await patient.post("/api/workspace", { data: { action: "message", patientId, text: "Учебный вопрос пациента", requestKey: randomUUID() } })).status()).toBe(200); expect((await get()).stale).toBe(true); await refresh();
    expect((await doctor.post("/api/workspace", { data: { action: "message", patientId, text: "Учебный ответ врача", requestKey: randomUUID() } })).status()).toBe(200); expect((await get()).stale).toBe(false);
    const history = await (await doctor.get(`/api/review-events?eventId=${eventId}&view=basis-history`)).json(); expect(history.versions.map((b: { version: number }) => b.version)).toEqual([4, 3, 2, 1]);
    expect((await doctor.get(`/api/review-events?eventId=${secondEvent}&view=basis-history&cursor=${firstBasis}`)).status()).toBe(400);
  });
  test("сообщение и подтверждение действия сохраняются однократно, повтор переживает новые данные", async () => {
    const e = await get(); lastSend = { action: "send-message", eventId, revision: e.revision, basisId: e.basis!.id, actionId: "contact_patient", text: "Здравствуйте! Уточните, пожалуйста, удобное время следующего контакта.", requestKey: randomUUID(), reviewed: true };
    const replies = await Promise.all([post(lastSend), post(lastSend)]); expect(replies.map(r => r.status())).toEqual([200, 200]); expect(await replies[0].json()).toEqual(await replies[1].json());
    expect(await db.reviewMessageExecution.count({ where: { eventId } })).toBe(1); const e2 = await get(); expect(e2.stale).toBe(false); expect(e2.receipts).toHaveLength(1); expect(e2.receipts[0].basisVersion).toBe(4);
    expect((await post({ ...lastSend, text: "Подмена текста с тем же ключом" })).status()).toBe(409);
    await observation(); expect((await get()).stale).toBe(true); expect((await post(lastSend)).status()).toBe(200); await refresh();
    const current = await get(); const data = { action: "resolve", eventId, revision: current.revision, basisId: current.basis!.id, actionId: "contact_patient", outcome: "Сообщение сохранено. Ответ пациента ожидается.", method: "IN_APP_MESSAGE", requestKey: randomUUID(), reviewed: true };
    const results = await Promise.all([post(data), post(data)]); expect(results.map(r => r.status())).toEqual([200, 200]);
    const resolved = await get(); expect(resolved.status).toBe("RESOLVED"); expect(resolved.currentContext).toBeNull(); expect(resolved.resolutionMethod).toBe("IN_APP_MESSAGE"); expect(await db.auditEvent.count({ where: { targetId: eventId, action: "review-event.resolve" } })).toBe(1);
    expect((await post({ ...data, outcome: "Незаметная перезапись" })).status()).toBe(409); expect((await post(lastSend)).status()).toBe(200);
    await observation(); expect((await get()).basis).toEqual(resolved.basis);
  });
  test("старое событие без основания, ограниченная история и результат по другому каналу", async () => {
    const forms = await (await doctor.get(`/api/assessments?patientId=${patientId}`)).json();
    const assigned = await doctor.post("/api/assessments", { data: { action: "assign", patientId, definitionId: forms.assignableDefinitionIds[0] } }); expect(assigned.status()).toBe(200); const assignmentId = (await assigned.json()).id;
    expect((await patient.post("/api/assessments", { data: { action: "submit", assignmentId, revision: 0, answers: { clarity: "clear", contact: "yes" }, note: "", requestKey: randomUUID() } })).status()).toBe(200);
    const row = await db.reviewEvent.findFirstOrThrow({ where: { submission: { assignmentId } } });
    // Simulate an event claimed before the additive basis migration.
    await db.reviewEvent.update({ where: { id: row.id }, data: { status: "IN_PROGRESS", ownerId: doctorId, revision: 1 } });
    const old = await get(row.id); expect(old.basis).toBeNull(); await refresh(row.id);
    for (let n = 0; n < 20; n++) { await observation(); await refresh(row.id); }
    const history = await (await doctor.get(`/api/review-events?eventId=${row.id}&view=basis-history`)).json(); expect(history.versions).toHaveLength(20); expect(history.versions[0].version).toBe(21);
    const tail = await (await doctor.get(`/api/review-events?eventId=${row.id}&view=basis-history&cursor=${history.nextCursor}`)).json(); expect(tail.versions.map((b: { version: number }) => b.version)).toEqual([1]); expect(tail.nextCursor).toBeNull();
    await db.patient.update({ where: { id: patientId }, data: { userId: null } }); const e = await refresh(row.id); expect(e.basis?.context.linked).toBe(false);
    expect((await post({ action: "send-message", eventId: row.id, revision: e.revision, basisId: e.basis!.id, actionId: "contact_patient", text: "Не должно отправиться", requestKey: randomUUID(), reviewed: true })).status()).toBe(409);
    expect((await post({ action: "resolve", eventId: row.id, revision: e.revision, basisId: e.basis!.id, actionId: "contact_patient", outcome: "По словам врача, контакт состоялся по согласованному каналу.", method: "OTHER_CHANNEL", requestKey: randomUUID(), reviewed: true })).status()).toBe(200);
    expect((await get(row.id)).receipts).toEqual([]); expect((await get(row.id)).resolutionMethod).toBe("OTHER_CHANNEL"); await db.patient.update({ where: { id: patientId }, data: { userId: patientUser } });
  });
  test("результат показывает источники без обязательного разбора", async ({ browser }) => {
    const context=await browser.newContext({storageState:await doctor.storageState()});const page=await context.newPage();
    await page.goto(`/doctor?patient=${patientId}`);
    await page.getByRole("region",{name:"Результаты анкет",exact:true}).locator(".assessment-row").first().click();
    const dialog=page.getByRole("dialog");await expect(dialog.getByRole("button",{name:"Взять в работу",exact:true})).toHaveCount(0);
    await dialog.getByText("Исходные ответы",{exact:true}).click();
    for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);}
    await dialog.getByRole("button",{name:"Написать пациенту",exact:true}).click();
    await expect(page.getByRole("textbox",{name:"Текст сообщения",exact:true})).toBeVisible();
    await context.close();
  });
});
