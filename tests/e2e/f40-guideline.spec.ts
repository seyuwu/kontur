import "dotenv/config";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test, expect, request, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { db } from "../../src/server/db";
import { authPost } from "./auth-request";
import { f40BaiDefinition as form, f40Source } from "../../src/modules/clinical/f40-bai-definition";
const origin = "http://localhost:3000";
function answersFor(total: number) { let rest = total; return Object.fromEntries(form.questions.map(q => { const n = Math.min(3, rest); rest -= n; return [q.id, q.options.find(o => o.points === n)!.id]; })); }
test.describe.serial("F40 guideline source and questionnaire", () => {
  let doctor: APIRequestContext, patient: APIRequestContext, other: APIRequestContext;
  const userIds: string[] = []; let patientId = "", minorId = "", definitionId = "", eventId = "";
  const post = (c: APIRequestContext, data: object) => c.post("/api/assessments", { data });
  async function assign() { const response = await post(doctor, { action: "assign", patientId, definitionId }); expect(response.status()).toBe(200); return (await response.json()).id as string; }
  async function submit(id: string, total: number, requestKey = randomUUID()) { return post(patient, { action: "submit", assignmentId: id, revision: 0, answers: answersFor(total), note: "Синтетическая проверка переноса", requestKey }); }
  test.beforeAll(async () => {
    async function account(role: string) { const c = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } }); const r = await authPost(c, "/api/auth/sign-up/email", { name: "КР Учебный", email: `f40-${randomUUID()}@synthetic.kontur.demo`, password: randomUUID() }); expect(r.status()).toBe(200); const id = (await r.json()).user.id; userIds.push(id); if (role === "DOCTOR") await db.user.update({ where: { id }, data: { role } }); return { c, id }; }
    const d = await account("DOCTOR"), p = await account("PATIENT"), o = await account("DOCTOR"); doctor = d.c; patient = p.c; other = o.c;
    patientId = (await db.patient.create({ data: { doctorId: d.id, userId: p.id, name: "Анкета Учебная", publicId: `F40-${randomUUID().slice(0, 8)}`, birthDate: new Date("1995-01-01") } })).id;
    minorId = (await db.patient.create({ data: { doctorId: d.id, name: "Возраст Учебный", publicId: `F40-M-${randomUUID().slice(0, 8)}`, birthDate: new Date("2012-01-01") } })).id;
    const data = await (await doctor.get(`/api/assessments?patientId=${patientId}`)).json(); definitionId = data.definitions.find((d: { form: { code: string } }) => d.form.code === form.code).id;
  });
  test.afterAll(async () => { await db.patient.deleteMany({ where: { id: { in: [patientId, minorId].filter(Boolean) } } }); await db.auditEvent.deleteMany({ where: { actorId: { in: userIds } } }); await db.user.deleteMany({ where: { id: { in: userIds } } }); await Promise.all([doctor?.dispose(), patient?.dispose(), other?.dispose()]); await db.$disconnect(); });
  test("original PDF is authenticated, immutable by hash and included in standalone output", async () => {
    const anonymous = await request.newContext({ baseURL: origin }); expect((await anonymous.get(`/api/clinical-source?id=${f40Source.id}`)).status()).toBe(401); await anonymous.dispose();
    const response = await doctor.get(`/api/clinical-source?id=${f40Source.id}`); expect(response.status()).toBe(200); expect(response.headers()["content-type"]).toBe("application/pdf"); expect(response.headers()["cache-control"]).toContain("no-store"); expect(response.headers()["x-source-sha256"]).toBe(f40Source.sha256);
    expect(createHash("sha256").update(await response.body()).digest("hex")).toBe(f40Source.sha256);
    expect(createHash("sha256").update(readFileSync(".next/standalone/resources/clinical/f40-455-2024.pdf")).digest("hex")).toBe(f40Source.sha256);
    expect((await patient.get(`/api/clinical-source?id=${f40Source.id}`)).status()).toBe(200);
    expect((await doctor.get("/api/clinical-source?id=../../.env")).status()).toBe(404);
  });
  test("adult applicability is enforced by server, not only the selector", async () => {
    const data = await (await doctor.get(`/api/assessments?patientId=${minorId}`)).json(); expect(data.assignableDefinitionIds).not.toContain(definitionId);
    expect((await post(doctor, { action: "assign", patientId: minorId, definitionId })).status()).toBe(422);
    expect((await post(patient, { action: "assign", patientId, definitionId })).status()).toBe(403); expect((await post(other, { action: "assign", patientId, definitionId })).status()).toBe(404);
  });
  test("incomplete submission is rejected, high total creates exactly one traceable noncritical event", async () => {
    const id = await assign(); const answers = answersFor(36); delete answers.bai_21;
    expect((await post(patient, { action: "submit", assignmentId: id, revision: 0, answers, note: "", requestKey: randomUUID() })).status()).toBe(400); expect(await db.assessmentSubmission.count({ where: { assignmentId: id } })).toBe(0);
    const key = randomUUID(); expect((await submit(id, 36, key)).status()).toBe(200); expect((await submit(id, 36, key)).status()).toBe(200);
    const events = await db.reviewEvent.findMany({ where: { submission: { assignmentId: id } } }); expect(events).toHaveLength(1); eventId = events[0].id; expect(events[0]).toMatchObject({ mode: "DEMO", priority: 3, status: "OPEN" });
    const event = await (await doctor.get(`/api/review-events?eventId=${eventId}`)).json(); expect(event.source.metric.value).toBe(36); expect(event.source.metric.maximum).toBe(63); expect(event.source.metric.interpretation).toContain("36–63"); expect(event.source.form.provenance.sha256).toBe(f40Source.sha256); expect(event.actions).toHaveLength(2);
    expect((await other.get(`/api/review-events?eventId=${eventId}`)).status()).toBe(404);
  });
  test("low and middle totals or a single fear-of-death item never fabricate a high event", async () => {
    for (const total of [9, 10, 21, 22, 35]) { const id = await assign(); expect((await submit(id, total)).status()).toBe(200); expect(await db.reviewEvent.count({ where: { submission: { assignmentId: id } } })).toBe(1); expect(await db.reviewEvent.count({ where: { submission: { assignmentId: id }, priority: { gte: 3 } } })).toBe(0); }
    const id = await assign(), answers = answersFor(0); answers.bai_16 = "severe"; expect((await post(patient, { action: "submit", assignmentId: id, revision: 0, answers, note: "", requestKey: randomUUID() })).status()).toBe(200); expect(await db.reviewEvent.count({ where: { submission: { assignmentId: id } } })).toBe(1); expect(await db.reviewEvent.count({ where: { submission: { assignmentId: id }, priority: { gte: 3 } } })).toBe(0);
  });
  test("patient fills bounded groups, draft survives failed save and reload, doctor sees source-based actions", async ({ browser }) => {
    const assignmentId = await assign(); const context = await browser.newContext({ storageState: await patient.storageState(), viewport: { width: 390, height: 1000 } }); const page = await context.newPage();
    await page.goto("/patient");
    // Assignments live in the existing Today section; select the only open BAI assignment.
    if (!await page.getByRole("dialog", { name: form.title }).isVisible()) {
      await page.getByRole("button", { name: new RegExp(form.title.replace(/[()]/g, "\\$&")) }).filter({ hasText: "Не заполнена" }).click();
    }
    const dialog = page.getByRole("dialog", { name: form.title }); await expect(dialog.getByRole("heading", { name: "Вопросы 1–3 из 21" })).toBeVisible(); expect(await dialog.locator("fieldset").count()).toBe(3);
    for (const width of [1440, 1575, 390, 320]) { await page.setViewportSize({ width, height: 1000 }); await dialog.evaluate(el => { el.scrollTop = 0; }); await page.screenshot({ fullPage: true, animations: "disabled", path: `.impeccable/review/f40-patient-${width}.png` }); await dialog.evaluate(el => { el.scrollTop = el.scrollHeight; }); await page.screenshot({ fullPage: true, animations: "disabled", path: `.impeccable/review/f40-patient-bottom-${width}.png` }); expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true); }
    for (const radio of await dialog.getByRole("radio", { name: "Совсем не беспокоил", exact: true }).all()) await radio.check();
    await page.route("**/api/assessments", route => route.request().method() === "POST" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Учебный сбой сохранения" }) }) : route.continue());
    await dialog.getByRole("button", { name: "Сохранить черновик" }).click(); await expect(dialog.getByRole("alert")).toContainText("Учебный сбой"); expect(await dialog.locator("input:checked").count()).toBe(3); await page.unroute("**/api/assessments");
    await dialog.getByRole("button", { name: "Сохранить черновик" }).click(); await expect(dialog.getByRole("status")).toContainText("Черновик сохранён");
    await page.reload(); await page.getByRole("button", { name: new RegExp(form.title.replace(/[()]/g, "\\$&")) }).filter({ hasText: "В процессе" }).click(); await expect(dialog.getByRole("heading", { name: "Вопросы 4–6 из 21" })).toBeVisible();
    for (let group = 1; group < 7; group++) { for (const radio of await dialog.getByRole("radio", { name: "Совсем не беспокоил", exact: true }).all()) await radio.check(); if (group < 6) await dialog.getByRole("button", { name: /^Далее/ }).click(); }
    await dialog.getByRole("button", { name: "Отправить врачу", exact: true }).click(); await expect(dialog.getByText("Ответы отправлены", { exact: true })).toBeVisible();
    await context.close();
    const dc = await browser.newContext({ storageState: await doctor.storageState(), viewport: { width: 1440, height: 1000 } }); const dp = await dc.newPage(); await dp.goto(`/doctor?patient=${patientId}&event=${eventId}`); const review = dp.getByRole("dialog", { name: "Шкала тревоги Бека (BAI)" }); await expect(review.getByText(/36 из 63/)).toBeVisible(); await review.getByText("По рекомендациям: что уточнить", { exact: true }).click();
    for (const width of [1440, 390, 320]) { await dp.setViewportSize({ width, height: 1000 }); await review.evaluate(el => { el.scrollTop = 0; }); await dp.screenshot({ fullPage: true, animations: "disabled", path: `.impeccable/review/f40-review-${width}.png` }); await review.getByText("По рекомендациям: что уточнить", { exact: true }).scrollIntoViewIfNeeded(); await dp.screenshot({ fullPage: true, animations: "disabled", path: `.impeccable/review/f40-evidence-${width}.png` }); expect(await review.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true); }
    await expect(review.getByRole("link", { name: /Раздел 2.1.*PDF, стр. 14/ }).first()).toHaveAttribute("href", `/api/clinical-source?id=${f40Source.id}#page=14`);
    await expect(review.getByRole("heading", {name:"Рекомендация врачу по этому результату",exact:true})).toBeVisible();
    await expect(review.getByRole("button", {name:"Взять в работу",exact:true})).toHaveCount(0);
    const audit = await new AxeBuilder({ page: dp }).include("dialog[open]").analyze(); expect(audit.violations.filter(v => ["critical", "serious"].includes(v.impact ?? ""))).toEqual([]); await dc.close();
  });
});
