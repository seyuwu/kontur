import { authPost } from "./auth-request";
import "dotenv/config";
import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { db } from "../../src/server/db";
import type { CareContent, CareWorkspace } from "../../src/lib/care";

const origin = "http://localhost:3000";
test.describe.serial("Подтверждаемый план наблюдения", () => {
  let doctor: APIRequestContext, patient: APIRequestContext, other: APIRequestContext;
  let doctorId = "", patientUser = "", otherId = "", patientId = "", assignmentId = "", firstPlan = "";
  const content: CareContent = { goal: "Подготовиться к следующему контакту", instructions: "Сохраните вопросы, которые хотите обсудить на следующем контакте.", nextContactDate: "2026-11-02", tasks: [{ id: randomUUID(), kind: "ACTION", title: "Подготовить список вопросов", details: "Запишите то, что осталось непонятным.", dueDate: "2026-11-01", assignmentId: null }] };
  const post = (client: APIRequestContext, data: object) => client.post("/api/care", { data: { patientId, ...data } });
  async function workspace(client = doctor): Promise<CareWorkspace> { const r = await client.get(`/api/care?patientId=${patientId}`); expect(r.status()).toBe(200); return r.json(); }
  async function save(next = content) { const data = await workspace(); const r = await post(doctor, { action: "save-draft", revision: data.draftRevision, content: next, basisToken: data.draft?.basisToken ?? data.context!.token }); expect(r.status()).toBe(200); return r.json(); }
  async function confirm() { const data = await workspace(); const r = await post(doctor, { action: "confirm", draftId: data.draft!.id, revision: data.draft!.revision, requestKey: randomUUID(), reviewed: true }); expect(r.status()).toBe(200); return r.json(); }
  test.beforeAll(async () => {
    async function account(name: string, role: string) {
      const context = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
      const r = await authPost(context, "/api/auth/sign-up/email", { name, email: `care-${randomUUID()}@synthetic.kontur.demo`, password: randomUUID() }); expect(r.status()).toBe(200); const id = (await r.json()).user.id;
      if (role === "DOCTOR") await db.user.update({ where: { id }, data: { role, specialty: "Тестовый профиль" } }); return { context, id };
    }
    const d = await account("Врач плана", "DOCTOR"); doctor = d.context; doctorId = d.id;
    const p = await account("Пациент плана", "PATIENT"); patient = p.context; patientUser = p.id;
    const o = await account("Другой врач плана", "DOCTOR"); other = o.context; otherId = o.id;
    const card = await db.patient.create({ data: { doctorId, userId: patientUser, name: "Тестовый Пациент плана", publicId: `CARE-${randomUUID()}`, birthDate: new Date("1990-01-01"), note: "PRIVATE_CLINICIAN_NOTE" } }); patientId = card.id;
  });
  test.afterAll(async () => {
    if (patientId) await db.patient.deleteMany({ where: { id: patientId } });
    await db.auditEvent.deleteMany({ where: { actorId: { in: [doctorId, patientUser, otherId].filter(Boolean) } } });
    await db.user.deleteMany({ where: { id: { in: [doctorId, patientUser, otherId].filter(Boolean) } } });
    await Promise.all([doctor?.dispose(), patient?.dispose(), other?.dispose()]); await db.$disconnect();
  });
  test("черновик приватен, владение и конкурирующее сохранение проверяются", async () => {
    expect((await other.get(`/api/care?patientId=${patientId}`)).status()).toBe(404);
    const before = await workspace(); const payload = { action: "save-draft", revision: 0, content, basisToken: before.context!.token };
    expect((await post(patient, payload)).status()).toBe(403);
    const results = await Promise.all([post(doctor, payload), post(doctor, payload)]); expect(results.map(r => r.status()).sort()).toEqual([200, 409]);
    expect(await workspace(patient)).toEqual({ current: null });
    const card = await patient.get(`/api/patients/${patientId}`); expect(JSON.stringify(await card.json())).not.toContain("PRIVATE_CLINICIAN_NOTE");
    expect((await post(doctor, { ...payload, revision: 1, content: { ...content, nextContactDate: "2026-02-30" } })).status()).toBe(400);
  });
  test("свежесть отличает чтение и заметки от новых ответов; повтор подтверждения не дублируется", async () => {
    const data = await workspace(); const token = data.context!.token;
    await doctor.post("/api/workspace", { data: { action: "note", patientId, note: "PRIVATE_NEW_NOTE" } });
    expect((await workspace()).context!.token).toBe(token);
    await patient.post("/api/workspace", { data: { action: "observation", patientId, score: 3, note: "Новая отметка", needsContact: false, requestKey: randomUUID() } });
    const payload = { action: "confirm", draftId: data.draft!.id, revision: data.draft!.revision, requestKey: randomUUID(), reviewed: true };
    expect((await post(doctor, payload)).status()).toBe(409);
    const fresh = await workspace(); expect(fresh.draft!.stale).toBe(true);
    expect((await post(doctor, { action: "rebase", content, revision: fresh.draftRevision, basisToken: token, reviewed: true })).status()).toBe(409);
    const rebased = await post(doctor, { action: "rebase", content, revision: fresh.draftRevision, basisToken: fresh.context!.token, reviewed: true }); expect(rebased.status()).toBe(200);
    payload.revision = (await rebased.json()).revision;
    const results = await Promise.all([post(doctor, payload), post(doctor, payload)]); expect(results.map(r => r.status())).toEqual([200, 200]); firstPlan = (await results[0].json()).id;
    expect(await db.carePlanVersion.count({ where: { patientId } })).toBe(1);
    expect((await post(doctor, { ...payload, revision: payload.revision + 1 })).status()).toBe(409);
    const mine = await workspace(patient); expect(mine.current!.instructions).toBe(content.instructions); expect(mine.current!.appointment).toBeNull(); expect(mine.draft).toBeUndefined();
    const card = await db.patient.findUniqueOrThrow({ where: { id: patientId } }); expect(card.currentPlanId).toBe(firstPlan); expect(card.nextVisit!.toISOString()).toBe("2026-11-02T09:00:00.000Z");
    expect((await doctor.post("/api/workspace", { data: { action: "note", patientId, note: "note", nextVisit: null } })).status()).toBe(409);
  });
  test("самоотчёт, вопрос врачу и неизменность истории между версиями", async () => {
    const taskId = content.tasks[0].id;
    const report = { action: "report", planVersionId: firstPlan, taskId, revision: 0, state: "DONE", note: "Подготовил", requestKey: randomUUID() };
    expect((await post(doctor, report)).status()).toBe(403);
    const results = await Promise.all([post(patient, report), post(patient, report)]); expect(results.map(r => r.status())).toEqual([200, 200]);
    expect((await post(patient, { ...report, note: "Подмена" })).status()).toBe(409);
    await save({ ...content, instructions: "Обновлённая памятка. Список вопросов остаётся прежним." }); await confirm();
    const version2 = (await workspace(patient)).current!; expect(version2.tasks[0].report!.state).toBe("DONE"); expect(version2.tasks[0].id).toBe(taskId);
    expect((await post(patient, { ...report, revision: 1, requestKey: randomUUID() })).status()).toBe(409);
    const question = { action: "report", planVersionId: version2.id, taskId, revision: 1, state: "NEEDS_HELP", note: "Как перенести контакт?", requestKey: randomUUID() };
    expect((await post(patient, question)).status()).toBe(200); expect((await post(patient, question)).status()).toBe(200);
    expect(await db.message.count({ where: { patientId, senderId: patientUser } })).toBe(1);
    const message = await db.message.findFirstOrThrow({ where: { patientId } }); expect(message.text).toContain("версия 2"); expect(message.text).toContain(content.tasks[0].title); expect(message.readAt).toBeNull();
    const old = await (await patient.get(`/api/care?patientId=${patientId}&versionId=${firstPlan}`)).json(); expect(old.instructions).toBe(content.instructions); expect(old.tasks[0].report.state).toBe("DONE");
    const changed = await save({ ...content, tasks: [{ ...content.tasks[0], title: "Другая задача наблюдения" }] }); expect(changed.content.tasks[0].id).not.toBe(taskId); await confirm();
    expect((await workspace(patient)).current!.tasks[0].report).toBeNull();
    const history = await (await patient.get(`/api/care?patientId=${patientId}&view=history`)).json(); expect(history.versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
  });
  test("связь с назначенной анкетой и её фактическим состоянием", async () => {
    const forms = await (await doctor.get(`/api/assessments?patientId=${patientId}`)).json(); const definitionId = forms.assignableDefinitionIds[0];
    const assigned = await doctor.post("/api/assessments", { data: { action: "assign", patientId, definitionId } }); expect(assigned.status()).toBe(200); assignmentId = (await assigned.json()).id;
    await save({ ...content, tasks: [{ ...content.tasks[0], id: randomUUID(), kind: "ASSESSMENT", assignmentId, title: "Заполнить учебную анкету" }] });
    expect((await patient.get(`/api/assessments?patientId=${patientId}&assignmentId=${assignmentId}`)).status()).toBe(200);
    await confirm(); const plan = (await workspace(patient)).current!;
    expect((await post(patient, { action: "report", planVersionId: plan.id, taskId: plan.tasks[0].id, revision: 0, state: "DONE", note: "", requestKey: randomUUID() })).status()).toBe(400);
    const draft = await save({ ...content, tasks: [{ ...content.tasks[0], kind: "ASSESSMENT", assignmentId }] });
    await doctor.post("/api/assessments", { data: { action: "cancel", assignmentId, revision: 0, reason: "Изменили договорённость" } });
    expect((await post(doctor, { action: "confirm", draftId: draft.id, revision: draft.revision, reviewed: true, requestKey: randomUUID() })).status()).toBe(409);
    expect((await workspace(patient)).current!.tasks[0].assignment!.status).toBe("CANCELLED");
    await post(doctor, { action: "discard", revision: draft.revision }); expect((await workspace()).draft).toBeNull();
  });
  test("архивная анкета скрыта с главной, но доступна по точной ссылке", async ({ browser }) => {
    const original = await db.assessmentAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
    const fixtureIds = Array.from({ length: 21 }, () => randomUUID());
    await db.assessmentAssignment.createMany({ data: fixtureIds.map(id => ({ id, patientId, definitionId: original.definitionId, definitionCode: original.definitionCode, assignedById: doctorId, status: "CANCELLED" as const, cancellationReason: "Учебная история" })) });
    const first = await (await patient.get(`/api/assessments?patientId=${patientId}`)).json(); expect(first.assignments.some((a: { id: string }) => a.id === assignmentId)).toBe(false);
    const context = await browser.newContext({ storageState: await patient.storageState(), viewport: { width: 390, height: 844 } }); const page = await context.newPage();
    await page.goto("/patient"); await expect(page.getByRole("button", { name: /Заполнить учебную анкету/ })).toHaveCount(0); await page.goto(`/patient?assignment=${assignmentId}`); const url = page.url();
    await expect(page.getByRole("dialog").getByText("Назначение отменено: Изменили договорённость", { exact: true })).toBeVisible(); expect(page.url()).toBe(url); await context.close(); await db.assessmentAssignment.deleteMany({ where: { id: { in: fixtureIds }, patientId } });
  });
  test("единая панель врача, мобильный план и история ввода", async ({ browser }) => {
    const doctorContext = await browser.newContext({ storageState: await doctor.storageState(), viewport: { width: 1440, height: 1000 } }); const page = await doctorContext.newPage();
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/doctor?patient=${patientId}`);
    await page.locator(".overview-contact").getByRole("button").click();
    const visit=page.getByRole("dialog",{name:"Дата следующего приёма",exact:true});await visit.getByLabel("Дата приёма",{exact:true}).fill("2026-11-04");await visit.getByLabel("Время приёма · Москва",{exact:true}).fill("15:30");await visit.getByRole("button",{name:"Сохранить",exact:true}).click();await expect(visit).not.toBeVisible();
    await page.getByRole("tab", { name: "Лечение и задачи", exact: true }).click(); await page.getByRole("button", { name: "Обновить план", exact: true }).click();
    await page.getByLabel("Цель наблюдения", { exact: true }).fill("Договориться о следующем контакте");
    await page.getByRole("textbox", { name: "Памятка пациенту", exact: true }).fill("Подготовьте вопросы к следующему контакту. Если нужно уточнение, задайте вопрос по задаче.");
    await page.getByRole("button", { name: "Удалить задачу 1", exact: true }).click(); await page.getByRole("button", { name: "Добавить задачу", exact: true }).click();
    await page.getByLabel("Название задачи 1", { exact: true }).fill("Записать вопросы к контакту");
    await expect(page.getByLabel("Дата следующего приёма · необязательно")).toHaveCount(0);
    await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Сохранить и проверить", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Проверить план перед подтверждением" });
    await expect(dialog).toBeVisible(); await expect(dialog.getByText(/4 нояб/)).toBeVisible(); await expect(dialog.getByRole("button", { name: "Подтвердить и показать пациенту", exact: true })).toBeDisabled();
    await page.screenshot({ path: ".impeccable/review/care-preview-1440.png" });
    await dialog.getByRole("checkbox").check(); await dialog.getByRole("button", { name: "Подтвердить и показать пациенту", exact: true }).click(); await expect(dialog).not.toBeVisible();
    expect((await db.patient.findUniqueOrThrow({where:{id:patientId}})).nextVisit!.toISOString()).toBe("2026-11-04T12:30:00.000Z");
    await page.screenshot({ path: ".impeccable/review/care-doctor-1440.png", fullPage: true });
    expect((await new AxeBuilder({ page }).analyze()).violations.filter(v => v.impact === "critical" || v.impact === "serious")).toEqual([]);
    await page.getByRole("button", { name: "Обновить план", exact: true }).click(); await page.getByRole("textbox", { name: "Памятка пациенту", exact: true }).fill("Личный черновик для следующего контакта");
    await page.getByRole("button", { name: "Закрыть панель", exact: true }).click(); await page.getByRole("tab", { name: "Общение" }).click(); await page.getByRole("tab", { name: "Обзор", exact: true }).click(); await page.getByRole("button", { name: "Продолжить черновик", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Памятка пациенту", exact: true })).toHaveValue("Личный черновик для следующего контакта");
    await page.getByRole("button", { name: "Сохранить и проверить", exact: true }).click(); await page.getByRole("button", { name: "Закрыть панель", exact: true }).click(); await page.reload(); await page.getByRole("tab", { name: "Лечение и задачи", exact: true }).click(); await page.getByRole("button", { name: "Продолжить черновик", exact: true }).click(); await expect(page.getByRole("textbox", { name: "Памятка пациенту", exact: true })).toHaveValue("Личный черновик для следующего контакта");
    for (const width of [390, 320]) { await page.setViewportSize({ width, height: 844 }); const editor = page.getByRole("dialog", { name: "Подготовить план наблюдения", exact: true }); await editor.evaluate(el => { el.scrollTop = 0; }); await page.screenshot({ path: `.impeccable/review/care-editor-${width}.png` }); await editor.evaluate(el => { el.scrollTop = el.scrollHeight; }); await page.screenshot({ path: `.impeccable/review/care-editor-bottom-${width}.png` }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(await editor.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); }
    await doctorContext.close();
    const pc = await browser.newContext({ storageState: await patient.storageState(), viewport: { width: 390, height: 844 } }); const pp = await pc.newPage(); pp.on("pageerror", error => errors.push(error.message)); await pp.goto("/patient");
    await pp.getByText("Памятка врача",{exact:true}).click(); await expect(pp.getByText("Договориться о следующем контакте", { exact: true })).toBeVisible(); await expect(pp.getByText("Личный черновик для следующего контакта", { exact: true })).toHaveCount(0);
    await pp.getByRole("button",{name:/Записать вопросы к контакту/}).click(); await pp.getByRole("button",{name:"Сохранить отметку",exact:true}).click(); await expect(pp.getByRole("dialog")).not.toBeVisible(); await expect(pp.getByRole("button",{name:/Записать вопросы к контакту/})).toHaveCount(0);
    await pp.getByRole("button",{name:"Чат с врачом",exact:true}).click(); await pp.getByRole("textbox",{name:"Текст сообщения",exact:true}).fill("Можно обсудить время контакта?"); await pp.getByRole("button",{name:"Отправить сообщение",exact:true}).click(); await expect(pp.getByRole("log").getByText("Можно обсудить время контакта?",{exact:true})).toBeVisible();
    await pp.setViewportSize({width:320,height:844}); await pp.screenshot({path:".impeccable/review/care-patient-320.png",fullPage:true});expect(await pp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page:pp}).analyze()).violations.filter(v=>v.impact==="critical"||v.impact==="serious")).toEqual([]);await pc.close();
    expect(errors).toEqual([]);
  });
});
