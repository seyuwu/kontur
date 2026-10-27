import "dotenv/config";
import { randomUUID, createHash } from "node:crypto";
import { test, expect, request, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { existsSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { resolve } from "node:path";
import { db } from "../../src/server/db";
import { authPost } from "./auth-request";
import { docxFile, pdfFile, syntheticText } from "../helpers/document-files";
const origin = "http://localhost:3000";
test.describe.serial("PDF/DOCX import with a cloud-ready extraction flow", () => {
  let doctor: APIRequestContext, other: APIRequestContext, patient: APIRequestContext; const userIds: string[] = []; let patientId = "", documentId = "";
  const upload = (context: APIRequestContext, buffer: Buffer, name: string, action = "preview", key = randomUUID(), title = "Учебная выписка из файла") => context.post("/api/documents/file", { multipart: { action, patientId, title, requestKey: key, file: { name, mimeType: "application/octet-stream", buffer } } });
  test.beforeAll(async () => {
    async function account(role: string) { const c = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } }); const r = await authPost(c, "/api/auth/sign-up/email", { name: "Импорт Учебный", email: `file-${randomUUID()}@synthetic.kontur.demo`, password: randomUUID() }); expect(r.status()).toBe(200); const id = (await r.json()).user.id; userIds.push(id); if (role === "DOCTOR") await db.user.update({ where: { id }, data: { role } }); return { c, id }; }
    const d = await account("DOCTOR"); doctor = d.c; const o = await account("DOCTOR"); other = o.c; const p = await account("PATIENT"); patient = p.c;
    patientId = (await db.patient.create({ data: { doctorId: d.id, userId: p.id, name: "Импорт Учебная", publicId: `FILE-${randomUUID()}`, birthDate: new Date("1990-01-01") } })).id;
  });
  test.afterAll(async () => { await db.patient.deleteMany({ where: { id: patientId || "missing" } }); await db.auditEvent.deleteMany({ where: { actorId: { in: userIds } } }); await db.user.deleteMany({ where: { id: { in: userIds } } }); await Promise.all([doctor?.dispose(), other?.dispose(), patient?.dispose()]); await db.$disconnect(); });
  test("previews safely without saving or invoking a model; checks role, origin and file validity", async () => {
    const bytes = await docxFile(); expect((await upload(patient, bytes, "record.docx")).status()).toBe(403); expect((await upload(other, bytes, "record.docx")).status()).toBe(404);
    const r = await upload(doctor, bytes, "Выписка.docx"); expect(r.status()).toBe(200); expect(r.headers()["cache-control"]).toBe("private, no-store"); expect((await r.json()).text).toBe(syntheticText);
    expect(await db.clinicalDocument.count({ where: { patientId } })).toBe(0); expect((await upload(doctor, pdfFile(""), "scan.pdf")).status()).toBe(422);
    expect((await upload(doctor, bytes, "fake.pdf")).status()).toBe(415); expect((await upload(doctor, Buffer.alloc(5 * 1024 * 1024 + 1), "large.pdf")).status()).toBe(413);
    const badOrigin = await doctor.post("/api/documents/file", { headers: { Origin: "https://outside.invalid" }, multipart: { action: "preview", patientId, file: { name: "record.docx", mimeType: "application/octet-stream", buffer: bytes } } }); expect(badOrigin.status()).toBe(403);
  });
  test("saves exact original bytes once, protects the source, and detects binary corruption", async () => {
    const bytes = await docxFile(); const key = randomUUID(); const replies = await Promise.all([upload(doctor, bytes, "Выписка.docx", "save", key), upload(doctor, bytes, "Выписка.docx", "save", key)]); expect(replies.map(r => r.status())).toEqual([200, 200]); documentId = (await replies[0].json()).id; expect((await replies[1].json()).id).toBe(documentId);
    expect((await upload(doctor, await docxFile(syntheticText + " Другой текст."), "Выписка.docx", "save", key)).status()).toBe(409);
    const detail = await (await doctor.get(`/api/documents?patientId=${patientId}&id=${documentId}`)).json(); expect(detail.file.name).toBe("Выписка.docx"); expect(detail.text).toBe(syntheticText); expect(detail.sourceBytes).toBeUndefined();
    expect((await patient.get(`/api/documents/source?id=${documentId}`)).status()).toBe(403); expect((await other.get(`/api/documents/source?id=${documentId}`)).status()).toBe(404);
    const original = await doctor.get(`/api/documents/source?id=${documentId}`); expect(original.status()).toBe(200); expect(original.headers()["content-disposition"]).toContain("attachment;"); expect(original.headers()["cache-control"]).toBe("private, no-store"); expect(createHash("sha256").update(await original.body()).digest("hex")).toBe(createHash("sha256").update(bytes).digest("hex"));
    await db.clinicalDocument.update({ where: { id: documentId }, data: { sourceBytes: new Uint8Array([1, 2, 3]) } }); expect((await doctor.get(`/api/documents/source?id=${documentId}`)).status()).toBe(409); await db.clinicalDocument.update({ where: { id: documentId }, data: { sourceBytes: new Uint8Array(bytes) } });
  });
  test("reads PDF from the packaged parser and keeps all source pages", async () => {
    expect(existsSync(".next/standalone/resources/document-parser/worker.mjs")).toBe(true);
    const packed = await new Promise<{ ok: boolean; pages: number }>((res, rej) => { const worker = new Worker(resolve(".next/standalone/resources/document-parser/worker.mjs"), { workerData: { bytes: pdfFile(undefined, 2), kind: "pdf" }, execArgv: [] }); const timer = setTimeout(() => { void worker.terminate(); rej(new Error("packaged parser timed out")); }, 20000); worker.once("message", value => { clearTimeout(timer); void worker.terminate(); res(value); }); worker.once("error", error => { clearTimeout(timer); rej(error); }); }); expect(packed).toMatchObject({ ok: true, pages: 2 });
    const r = await upload(doctor, pdfFile(undefined, 2), "Synthetic record.pdf", "save"); expect(r.status()).toBe(200); const id = (await r.json()).id; const doc = await (await doctor.get(`/api/documents?patientId=${patientId}&id=${id}`)).json(); expect(doc.file.pages).toBe(2); expect(doc.text.match(/Synthetic record/g)).toHaveLength(2);
  });
  test("previews on mobile, retains file after failure and exposes truthful cloud consent", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await doctor.storageState(), viewport: { width: 1440, height: 1000 } }); const page = await context.newPage(); const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(`/doctor?patient=${patientId}&tab=data`); await page.getByRole("button", { name: "Из истории болезни", exact: true }).click(); await page.getByRole("button", { name: "Добавить документ", exact: true }).click();
    let panel = page.getByRole("dialog", { name: "Добавить документ", exact: true });
    await panel.locator('input[type="file"]').setInputFiles({ name: "Выписка_учебного_пациента_без_реальных_данных.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: await docxFile() });
    const preview = panel.getByRole("textbox", { name: "Извлечённый текст · проверьте перед сохранением", exact: true }); await expect(preview).toHaveValue(syntheticText); await expect(preview).toHaveAttribute("readonly", "");
    for (const width of [1440, 390, 320]) { await page.setViewportSize({ width, height: 1000 }); await panel.evaluate(el => { el.scrollTop = 0; }); await page.screenshot({ animations: "disabled", path: `.impeccable/review/file-form-${width}.png` }); await panel.evaluate(el => { el.scrollTop = el.scrollHeight; }); await page.screenshot({ animations: "disabled", path: `.impeccable/review/file-form-bottom-${width}.png` }); expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true); }
    await page.route("**/api/documents/file", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Учебный отказ сохранения файла" }) }));
    await panel.getByRole("button", { name: "Сохранить документ", exact: true }).click(); await expect(panel.getByRole("alert")).toHaveText("Учебный отказ сохранения файла"); await expect(preview).toHaveValue(syntheticText); await page.keyboard.press("Escape"); await page.getByRole("button", { name: "Из истории болезни", exact: true }).click(); await page.getByRole("button", { name: "Добавить документ", exact: true }).click(); await expect(preview).toHaveValue(syntheticText); await page.unroute("**/api/documents/file");
    // Only the displayed capability is mocked: no model request is sent in this browser test.
    await page.route("**/api/documents?**", async route => { const response = await route.fetch(); const json = await response.json(); await route.fulfill({ response, json: Array.isArray(json.entries) ? { ...json, extractionEnabled: true, extractionProvider: "groq" } : json }); });
    await panel.getByRole("button", { name: "Сохранить документ", exact: true }).click(); panel = page.getByRole("dialog", { name: "Выписка_учебного_пациента_без_реальных_данных", exact: true }); await expect(panel).toBeVisible(); await expect(panel.getByText(/Текст будет передан Groq/)).toBeVisible(); await expect(panel.getByRole("button", { name: "Извлечь кандидаты фактов", exact: true })).toBeDisabled();
    await panel.getByText("Исходный текст документа", { exact: true }).click(); await expect(panel.getByRole("link", { name: "Скачать исходный файл", exact: true })).toBeVisible();
    for (const width of [1440, 390, 320]) { await page.setViewportSize({ width, height: 1000 }); await panel.evaluate(el => { el.scrollTop = 0; }); await page.screenshot({ animations: "disabled", path: `.impeccable/review/file-source-${width}.png` }); await panel.evaluate(el => { el.scrollTop = el.scrollHeight; }); await page.screenshot({ animations: "disabled", path: `.impeccable/review/file-cloud-${width}.png` }); expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true); }
    expect((await new AxeBuilder({ page }).include("dialog[open]").analyze()).violations.filter(v => ["serious", "critical"].includes(v.impact ?? "")).map(v => v.id)).toEqual([]); expect(errors).toEqual([]); await context.close();
  });
});
