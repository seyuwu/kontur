import "dotenv/config";
import { randomUUID } from "node:crypto";
import { test, expect, request, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { db } from "../../src/server/db";
import { authPost } from "./auth-request";
import { processDocumentExtraction } from "../../src/modules/documents/worker";
import { fingerprint } from "../../src/modules/assessments/definitions";
const origin = "http://localhost:3000";
const source = "Учебная выписка. Состояние: учебный факт Альфа. Аллергии не сообщались. Ранее принимал учебный препарат Бета; приём прекращён. Возможный факт Гамма не уточнён.";
const base = { scope: "ITEM", details: "Синтетический факт для проверки", regimen: "", intake: "UNKNOWN", startedOn: null, stoppedOn: null };
const output = { facts: [
  { ...base, section: "conditions", polarity: "PRESENT", title: "Учебный факт Альфа", quote: "Состояние: учебный факт Альфа." },
  { ...base, section: "allergies", polarity: "ABSENT", scope: "SECTION", title: "Аллергии не сообщались", quote: "Аллергии не сообщались." },
  { ...base, section: "medications", polarity: "PRESENT", title: "Учебный препарат Бета", intake: "STOPPED", quote: "Ранее принимал учебный препарат Бета; приём прекращён." },
  { ...base, section: "conditions", polarity: "UNCERTAIN", title: "Факт Гамма требует уточнения", quote: "Возможный факт Гамма не уточнён." }
], limitations: ["Синтетический пример. Не клиническая оценка модели."] };
test.describe.serial("История болезни и проверяемые кандидаты", () => {
  let doctor: APIRequestContext, patient: APIRequestContext, other: APIRequestContext;
  let doctorId = "", userId = "", otherId = "", patientId = "", secondId = "", docId = "", extractionId = "";
  const post = (c: APIRequestContext, data: object) => c.post("/api/documents", { data });
  const profile = async () => (await doctor.get(`/api/clinical-profile?patientId=${patientId}`)).json();
  const detail = async () => { const r = await doctor.get(`/api/documents?patientId=${patientId}&id=${docId}`); expect(r.status()).toBe(200); return r.json(); };
  test.beforeAll(async () => {
    async function account(role: string) { const c = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } }); const r = await authPost(c, "/api/auth/sign-up/email", { name: "Документы Учебные", email: `document-${randomUUID()}@synthetic.kontur.demo`, password: randomUUID() }); expect(r.status()).toBe(200); const id = (await r.json()).user.id; if (role === "DOCTOR") await db.user.update({ where: { id }, data: { role } }); return { c, id }; }
    const d = await account("DOCTOR"); doctor = d.c; doctorId = d.id; const p = await account("PATIENT"); patient = p.c; userId = p.id; const o = await account("DOCTOR"); other = o.c; otherId = o.id;
    patientId = (await db.patient.create({ data: { doctorId, userId, name: "Документ Первый", publicId: `DOCUMENT-${randomUUID()}`, birthDate: new Date("1990-01-01") } })).id; secondId = (await db.patient.create({ data: { doctorId, name: "Документ Второй", publicId: `DOCUMENT-${randomUUID()}`, birthDate: new Date("1990-01-01") } })).id;
  });
  test.afterAll(async () => { await db.patient.deleteMany({ where: { id: { in: [patientId, secondId].filter(Boolean) } } }); await db.auditEvent.deleteMany({ where: { actorId: { in: [doctorId, userId, otherId].filter(Boolean) } } }); await db.user.deleteMany({ where: { id: { in: [doctorId, userId, otherId].filter(Boolean) } } }); await Promise.all([doctor?.dispose(), patient?.dispose(), other?.dispose()]); await db.$disconnect(); });
  test("закрытый источник, повтор сохранения и условное чтение после проверки доступа", async () => {
    const input = { action: "save", patientId, title: "Синтетическая выписка", text: source, date: "2026-10-17", requestKey: randomUUID() };
    expect((await post(patient, input)).status()).toBe(403); expect((await post(other, input)).status()).toBe(404); const replies = await Promise.all([post(doctor, input), post(doctor, input)]); expect(replies.map(r => r.status())).toEqual([200, 200]); docId = (await replies[0].json()).id; expect((await replies[1].json()).id).toBe(docId); expect((await post(doctor, { ...input, text: source + " Подмена" })).status()).toBe(409);
    const response = await doctor.get(`/api/documents?patientId=${patientId}&id=${docId}`); const etag = response.headers().etag; expect(etag).toBeTruthy(); expect((await doctor.get(`/api/documents?patientId=${patientId}&id=${docId}`, { headers: { "If-None-Match": etag } })).status()).toBe(304); expect((await other.get(`/api/documents?patientId=${patientId}&id=${docId}`, { headers: { "If-None-Match": etag } })).status()).toBe(404); expect((await patient.get(`/api/documents/source?id=${docId}`)).status()).toBe(403); expect((await other.get(`/api/documents/source?id=${docId}`)).status()).toBe(404); expect(await (await doctor.get(`/api/documents/source?id=${docId}`)).text()).toBe(source);
    const listed = await (await doctor.get(`/api/documents?patientId=${patientId}`)).json(); expect(JSON.stringify(listed)).not.toContain("учебный факт Альфа"); expect(listed.entries[0].checksum).toBe(fingerprint(source));
    expect((await post(doctor, { action: "extract", patientId, id: docId, requestKey: randomUUID(), consent: false })).status()).toBe(400);
    if (!listed.extractionEnabled) expect((await post(doctor, { action: "extract", patientId, id: docId, requestKey: randomUUID(), consent: true })).status()).toBe(503);
  });
  test("worker проверяет цитаты, сохраняет кандидатов и не меняет клинические сведения", async () => {
    const make = async () => db.documentExtraction.create({ data: { documentId: docId, model: "synthetic-model", provider: "synthetic-test-adapter", promptVersion: "facts-1", inputChecksum: fingerprint(source), createdById: doctorId, requestKey: randomUUID() } });
    const bad = await make(); await processDocumentExtraction(bad.id, async () => ({ ...output, facts: [{ ...output.facts[0], quote: "Такого фрагмента нет в источнике" }] })); expect((await db.documentExtraction.findUniqueOrThrow({ where: { id: bad.id } })).status).toBe("FAILED"); expect((await profile()).version).toBe(0);
    const good = await make(); extractionId = good.id; let calls = 0; const adapter = async () => { calls++; return output; }; await Promise.all([processDocumentExtraction(good.id, adapter), processDocumentExtraction(good.id, adapter)]); expect(calls).toBe(1); const doc = await detail(); expect(doc.extraction.status).toBe("READY"); expect(doc.extraction.result.facts[2].intake).toBe("STOPPED"); for (const f of doc.extraction.result.facts) expect(source.slice(f.start, f.end)).toBe(f.quote); expect((await profile()).version).toBe(0);
  });
  test("перенос создаёт только проект; сохранение проверяет источник, версию и отрицания", async () => {
    const input = { action: "prepare", patientId, id: docId, extractionId, expectedVersion: 0, selected: [0, 1, 2], modes: { conditions: "ADD", allergies: "ADD", medications: "ADD" }, reviewed: true };
    expect((await post(patient, input)).status()).toBe(403); expect((await post(doctor, { ...input, selected: [3] })).status()).toBe(400); const prepared = await post(doctor, input); expect(prepared.status()).toBe(200); const draft = await prepared.json(); expect(draft.content.allergies.status).toBe("NONE"); expect(draft.content.medications.items[0].intake).toBe("STOPPED"); expect((await profile()).version).toBe(0);
    const save = { patientId, expectedVersion: 0, content: draft.content, requestKey: randomUUID(), reviewed: true }; expect((await doctor.post("/api/clinical-profile", { data: save })).status()).toBe(200);
    const poisoned = structuredClone(draft.content); poisoned.conditions.items[0].evidence.document.start += 1; poisoned.conditions.items[0].evidence.document.end += 1; expect((await doctor.post("/api/clinical-profile", { data: { ...save, expectedVersion: 1, content: poisoned, requestKey: randomUUID() } })).status()).toBe(409); expect((await post(doctor, input)).status()).toBe(409);
    const another = await post(doctor, { action: "save", patientId: secondId, title: "Чужой для первого источник", text: source, date: null, requestKey: randomUUID() }); expect(another.status()).toBe(200); poisoned.conditions.items[0].evidence.document = { ...draft.content.conditions.items[0].evidence.document, id: (await another.json()).id }; expect((await doctor.post("/api/clinical-profile", { data: { ...save, expectedVersion: 1, content: poisoned, requestKey: randomUUID() } })).status()).toBe(409);
  });
  test("проверка фактов в интерфейсе и передача в существующий редактор", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await doctor.storageState(), viewport: { width: 1440, height: 1000 } }); const page = await context.newPage(); const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(`/doctor?patient=${patientId}&tab=data`); await page.getByRole("button", { name: "Из истории болезни", exact: true }).click(); let panel = page.getByRole("dialog", { name: "Истории и документы", exact: true }); await panel.getByRole("button", { name: /Синтетическая выписка/ }).click(); panel = page.getByRole("dialog", { name: "Синтетическая выписка", exact: true }); await expect(panel.getByRole("heading", { name: "Кандидаты для проверки", exact: true })).toBeVisible();
    await panel.getByRole("checkbox", { name: /Учебный факт Альфа/ }).check(); await expect(panel.getByRole("checkbox", { name: /Факт Гамма требует уточнения/ })).toBeDisabled();
    for (const width of [1440, 390, 320]) { await page.setViewportSize({ width, height: 1000 }); await panel.evaluate(el => { el.scrollTop = 0; }); await page.screenshot({ animations: "disabled", path: `.impeccable/review/import-candidates-${width}.png` }); await panel.evaluate(el => { el.scrollTop = el.scrollHeight; }); await page.screenshot({ animations: "disabled", path: `.impeccable/review/import-review-${width}.png` }); expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true); }
    expect((await new AxeBuilder({ page }).include("dialog[open]").analyze()).violations.filter(v => ["serious", "critical"].includes(v.impact ?? "")).map(v => v.id)).toEqual([]);
    // The same fact is already saved; select an explicit replacement to inspect the draft workflow.
    await panel.getByLabel(/Состояния и ограничения · сейчас/).selectOption("REPLACE"); await panel.getByLabel("Я проверил выбранные факты, цитаты и способ переноса").check(); await panel.getByRole("button", { name: "Подготовить черновик сведений", exact: true }).click(); const editor = page.getByRole("dialog", { name: "Уточнить клинические сведения", exact: true }); await expect(editor).toBeVisible(); await expect(editor.getByRole("textbox", { name: "Название", exact: true })).toHaveValue("Учебный факт Альфа"); await expect(editor.getByText(output.facts[0].quote, { exact: true })).toBeVisible(); expect((await profile()).version).toBe(1);
    await page.keyboard.press("Escape"); await page.getByRole("tab", { name: "Обзор", exact: true }).click(); await page.getByRole("tab", { name: "Данные", exact: true }).click(); await page.getByRole("button", { name: "Продолжить ввод", exact: true }).click(); await expect(editor.getByRole("textbox", { name: "Название", exact: true })).toHaveValue("Учебный факт Альфа"); expect(errors).toEqual([]); await context.close();
  });
});
