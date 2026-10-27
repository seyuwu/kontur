import { authPost } from "./auth-request";
import "dotenv/config";
import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { db } from "../../src/server/db";

const origin = "http://localhost:3000";
test.describe.serial("Версионная анкета и разбор события", () => {
  let doctor: APIRequestContext, patient: APIRequestContext, other: APIRequestContext;
  let patientId = "", userId = "", definitionId = "", assignmentId = "", eventId = "";
  const targetIds: string[] = [];
  const post = (client: APIRequestContext, data: object) => client.post("/api/assessments", { data });
  const review = (data: object) => doctor.post("/api/review-events", { data });
  async function forms(client: APIRequestContext) { const response = await client.get(`/api/assessments?patientId=${patientId}`); expect(response.status()).toBe(200); return response.json(); }
  async function assign() { const response = await post(doctor, { action: "assign", patientId, definitionId }); expect(response.status()).toBe(200); const { id } = await response.json(); targetIds.push(id); return id as string; }
  test.beforeAll(async () => {
    async function login(email: string) {
      const context = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
      const response = await authPost(context, "/api/auth/sign-in/email", { email, password: process.env.DEMO_PASSWORD });
      expect(response.status()).toBe(200); return context;
    }
    doctor = await login("doctor@kontur.demo"); other = await login("psychiatrist@kontur.demo");
    patient = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
    const signup = await authPost(patient, "/api/auth/sign-up/email", { name: "Тест анкет", email: `assessment-${randomUUID()}@synthetic.kontur.demo`, password: randomUUID() });
    expect(signup.status()).toBe(200); userId = (await signup.json()).user.id;
    const created = await doctor.post("/api/workspace", { data: { action: "create-patient", name: "Тест анкет и событий", birthDate: "1995-01-01" } });
    expect(created.status()).toBe(200); patientId = (await created.json()).id; targetIds.push(patientId);
    // Pairing itself is covered by workspace.spec.ts; this fixture isolates assessment behavior.
    await db.patient.update({ where: { id: patientId }, data: { userId } });
    const data = await forms(doctor); definitionId = data.assignableDefinitionIds[0]; expect(definitionId).toBeTruthy();
  });
  test.afterAll(async () => {
    if (patientId) await db.patient.deleteMany({ where: { id: patientId } });
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    await db.auditEvent.deleteMany({ where: { OR: [{ actorId: userId || "absent" }, { targetId: { in: targetIds } }] } });
    await Promise.all([doctor?.dispose(), patient?.dispose(), other?.dispose()]); await db.$disconnect();
  });

  test("доступ и одновременное назначение без дублей", async () => {
    expect((await other.get(`/api/assessments?patientId=${patientId}`)).status()).toBe(404);
    expect((await post(patient, { action: "assign", patientId, definitionId })).status()).toBe(403);
    const attempts = await Promise.all([post(doctor, { action: "assign", patientId, definitionId }), post(doctor, { action: "assign", patientId, definitionId })]);
    expect(attempts.map(r => r.status()).sort()).toEqual([200, 409]);
    assignmentId = (await attempts.find(r => r.status() === 200)!.json()).id; targetIds.push(assignmentId);
    expect((await forms(patient)).assignments).toHaveLength(1);
  });
  test("черновик приватен, старая вкладка и неполная отправка отклоняются", async () => {
    const partial = { action: "save-draft", assignmentId, revision: 0, answers: { clarity: "unclear" }, note: "Личный черновик" };
    expect((await post(patient, partial)).status()).toBe(200);
    expect((await post(patient, { ...partial, note: "Старая вкладка" })).status()).toBe(409);
    const mine = (await forms(patient)).assignments[0]; expect(mine.note).toBe("Личный черновик"); expect(mine.revision).toBe(1);
    const theirs = (await forms(doctor)).assignments[0]; expect(theirs.answers).toEqual({}); expect(theirs.note).toBe(""); expect(theirs.submission).toBeNull();
    expect((await post(patient, { ...partial, action: "submit", revision: 1, requestKey: randomUUID() })).status()).toBe(400);
    expect(await db.assessmentSubmission.count({ where: { assignmentId } })).toBe(0);
  });
  test("повтор отправки создаёт один результат и одно событие на правило", async () => {
    const data = { action: "submit", assignmentId, revision: 1, answers: { clarity: "unclear", contact: "yes" }, note: "Нужен контакт", requestKey: randomUUID() };
    const responses = await Promise.all([post(patient, data), post(patient, data)]);
    expect(responses.map(r => r.status())).toEqual([200, 200]);
    expect((await responses[0].json()).submissionId).toBe((await responses[1].json()).submissionId);
    const saved = await db.assessmentSubmission.findUniqueOrThrow({ where: { assignmentId } }); targetIds.push(saved.id);
    expect(await db.reviewEvent.count({ where: { submissionId: saved.id } })).toBe(2);
    expect((await post(patient, { ...data, note: "Подмена результата" })).status()).toBe(409);
    expect((await post(patient, { ...data, action: "save-draft", requestKey: undefined })).status()).toBe(409);
    expect((await forms(doctor)).assignments[0].submission.note).toBe("Нужен контакт");
    eventId = (await db.reviewEvent.findFirstOrThrow({ where: { submissionId: saved.id, ruleId: "contact_requested" } })).id;
    targetIds.push(...(await db.reviewEvent.findMany({ where: { submissionId: saved.id }, select: { id: true } })).map(e => e.id));
  });
  test("переиспользование ключа другой анкеты откатывает незавершённую транзакцию", async () => {
    const id = await assign(); const saved = await db.assessmentSubmission.findUniqueOrThrow({ where: { assignmentId } });
    expect((await post(patient, { action: "submit", assignmentId: id, revision: 0, answers: { clarity: "clear", contact: "no" }, note: "", requestKey: saved.requestKey })).status()).toBe(409);
    expect((await db.assessmentAssignment.findUniqueOrThrow({ where: { id } })).status).toBe("ASSIGNED");
    expect(await db.assessmentSubmission.count({ where: { assignmentId: id } })).toBe(0);
    expect((await post(doctor, { action: "cancel", assignmentId: id, revision: 0, reason: "Проверка отмены" })).status()).toBe(200);
    expect((await post(patient, { action: "submit", assignmentId: id, revision: 0, answers: { clarity: "clear", contact: "no" }, note: "", requestKey: randomUUID() })).status()).toBe(409);
  });
  test("событие закрывается с действием и результатом, без перезаписи", async () => {
    expect((await patient.get("/api/review-events")).status()).toBe(403);
    expect((await other.get(`/api/review-events?eventId=${eventId}`)).status()).toBe(404);
    const response = await doctor.get(`/api/review-events?eventId=${eventId}`); expect(response.status()).toBe(200);
    const event = await response.json(); expect(event.source.answers.contact).toBe("yes"); expect(event.actions).toHaveLength(2);
    const resolution = { action: "resolve", eventId, revision: 0, basisId: "not-claimed", method: "NOTE", reviewed: true, requestKey: randomUUID(), actionId: "review_answers", outcome: "Ответы разобраны, следующий контакт согласован." };
    expect((await review(resolution)).status()).toBe(409);
    const claimed = await review({ action: "claim", eventId, revision: 0 }); expect(claimed.status()).toBe(200); resolution.basisId = (await claimed.json()).basisId;
    expect((await review({ ...resolution, revision: 1, actionId: "invented" })).status()).toBe(400);
    expect((await review({ ...resolution, revision: 1 })).status()).toBe(200);
    expect((await review({ ...resolution, revision: 1 })).status()).toBe(200);
    expect((await review({ ...resolution, revision: 2, outcome: "Тихая перезапись" })).status()).toBe(409);
    const list = await (await doctor.get(`/api/review-events?patientId=${patientId}&status=RESOLVED`)).json(); expect(list.events).toHaveLength(1); expect(list.events[0].source).toBeUndefined();
  });
  test("неизменившийся кабинет возвращает 304, изменение обновляет версию", async () => {
    const initial = await doctor.get("/api/patients"); const etag = initial.headers().etag; expect(etag).toBeTruthy();
    expect((await doctor.get("/api/patients", { headers: { "If-None-Match": etag } })).status()).toBe(304);
    expect((await patient.get("/api/workspace", { headers: { "If-None-Match": etag } })).status()).toBe(200);
    expect((await doctor.post("/api/workspace", { data: { action: "note", patientId, note: "Изменение для проверки версии" } })).status()).toBe(200);
    const changed = await doctor.get("/api/patients", { headers: { "If-None-Match": etag } }); expect(changed.status()).toBe(200); expect(changed.headers().etag).not.toBe(etag);
  });
  test("мобильная анкета сохраняет черновик после перезагрузки и доступна с клавиатуры", async ({ browser }) => {
    const doctorContext = await browser.newContext({ storageState: await doctor.storageState(), viewport: { width: 1440, height: 1000 } });
    const doctorPage = await doctorContext.newPage(); await doctorPage.goto(`/doctor?patient=${patientId}&tab=overview`);
    await doctorPage.getByRole("tab", { name: "Обзор", exact: true }).click();
    await doctorPage.getByRole("button", { name: "Назначить анкету", exact: true }).waitFor();
    await doctorPage.screenshot({ path: ".impeccable/review/assessment-overview-1440.png", fullPage: true });
    await doctorPage.getByRole("button", { name: "Назначить анкету", exact: true }).click();
    const doctorDialog = doctorPage.getByRole("dialog", { name: "Назначить анкету", exact: true });
    await expect(doctorDialog).toBeVisible(); await doctorDialog.getByRole("combobox",{name:"Анкета",exact:true}).selectOption(definitionId);
    for (const width of [1440, 390]) {
      await doctorPage.setViewportSize({ width, height: 1000 });
      await doctorPage.screenshot({ path: `.impeccable/review/assessment-assign-${width}.png` });
      expect(await doctorDialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    expect((await new AxeBuilder({ page: doctorPage }).include("dialog[open]").analyze()).violations.map(v => v.id)).toEqual([]);
    await doctorDialog.getByRole("button", { name: "Назначить пациенту" }).click(); await expect(doctorDialog).not.toBeVisible();
    const id = (await db.assessmentAssignment.findFirstOrThrow({ where: { patientId, status: "ASSIGNED" } })).id; targetIds.push(id);
    const context = await browser.newContext({ storageState: await patient.storageState(), viewport: { width: 390, height: 844 } });
    const page = await context.newPage(); await page.goto("/patient");
    await page.getByRole("button", { name: /Связь и понятность следующих шагов/ }).click();
    const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
    await dialog.getByRole("radio", { name: "Нужно объяснить", exact: true }).check();
    await dialog.getByLabel("Комментарий к анкете · необязательно").fill("Черновик на сервере");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button",{name:/Связь и понятность следующих шагов/})).toHaveCount(1);
    await page.getByRole("button", { name: /Связь и понятность следующих шагов/ }).click();
    await expect(dialog.getByRole("radio", { name: "Нужно объяснить", exact: true })).toBeChecked();
    await expect(dialog.getByLabel("Комментарий к анкете · необязательно")).toHaveValue("Черновик на сервере");
    await dialog.getByRole("button", { name: "Сохранить черновик" }).click();
    await expect(dialog.getByText(/Черновик сохранён на сервере/)).toBeVisible();
    await page.keyboard.press("Escape"); await page.reload();
    await page.getByRole("button", { name: /Связь и понятность следующих шагов/ }).click();
    await expect(dialog.getByRole("radio", { name: "Нужно объяснить", exact: true })).toBeChecked();
    await expect(dialog.getByLabel("Комментарий к анкете · необязательно")).toHaveValue("Черновик на сервере");
    await dialog.getByRole("radio", { name: "Сейчас не нужно", exact: true }).check();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await dialog.evaluate(el => { el.scrollTop = 0; });
      await page.screenshot({ path: `.impeccable/review/assessment-patient-${width}.png` });
      if (width === 390) { await dialog.evaluate(el => { el.scrollTop = el.scrollHeight; }); await page.screenshot({ path: ".impeccable/review/assessment-patient-bottom-390.png" }); }
    }
    const audit = await new AxeBuilder({ page }).include("dialog[open]").analyze(); expect(audit.violations.map(v => v.id)).toEqual([]);
    await dialog.getByRole("button", { name: "Отправить врачу" }).click();
    await expect(dialog.getByText("Ответы отправлены", { exact: true })).toBeVisible();
    const submission = await db.assessmentSubmission.findUniqueOrThrow({ where: { assignmentId: id } }); targetIds.push(submission.id);
    const nextEvent = await db.reviewEvent.findFirstOrThrow({ where: { submissionId: submission.id } }); targetIds.push(nextEvent.id);
    await doctorPage.goto(`/doctor?patient=${patientId}&tab=overview`);
    await doctorPage.getByRole("region", {name:"Результаты анкет",exact:true}).locator(".assessment-row").first().click();
    const reviewDialog = doctorPage.getByRole("dialog");
    await expect(reviewDialog).toBeVisible();
    await doctorPage.screenshot({ path: ".impeccable/review/assessment-review-collapsed-390.png" });
    await reviewDialog.getByText("Исходные ответы", { exact: true }).click();
    await expect(reviewDialog.getByText("Черновик на сервере", { exact: true })).toBeVisible();
    await expect(reviewDialog.getByRole("button", {name:"Взять в работу"})).toHaveCount(0);
    for (const width of [390, 1440]) {
      await doctorPage.setViewportSize({ width, height: 1000 });
      await reviewDialog.evaluate(el => { el.scrollTop = 0; });
      await doctorPage.screenshot({ path: `.impeccable/review/assessment-review-${width}.png` });
      await reviewDialog.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await doctorPage.screenshot({ path: `.impeccable/review/assessment-review-bottom-${width}.png` });
      expect(await reviewDialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    expect((await new AxeBuilder({ page: doctorPage }).include("dialog[open]").analyze()).violations.map(v => v.id)).toEqual([]);
    await expect.poll(() => db.reviewEvent.count({where:{patientId,viewedAt:{not:null}}})).toBeGreaterThan(0);
    await doctorContext.close();
    await context.close();
  });
});
