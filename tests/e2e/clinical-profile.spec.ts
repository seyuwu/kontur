import "dotenv/config";
import { test, expect, request, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { authPost } from "./auth-request";
import { db } from "../../src/server/db";
import { emptyProfile } from "../../src/modules/clinical-profile/contract";
import type { ProfileContent, ProfileWorkspace } from "../../src/lib/clinical-profile";

const origin = "http://localhost:3000";
test.describe.serial("Версионные клинические сведения", () => {
  let doctor: APIRequestContext, patient: APIRequestContext, other: APIRequestContext;
  let doctorId = "", patientUser = "", otherId = "", patientId = "", secondId = "", historyId = "", firstVersionId = "", latestVersionId = "";
  const evidence = { kind: "PATIENT_REPORT" as const, reference: "Учебная беседа на приёме", date: "2026-10-17" };
  const initial: ProfileContent = { ...emptyProfile(), allergies: { status: "NONE", note: "Отрицательный ответ по указанному источнику", evidence, items: [] }, medications: { status: "KNOWN", note: "Уточнить текущий статус", evidence: null, items: [{ id: randomUUID(), title: "Учебный препарат A", details: "Синтетическая запись для проверки", evidence: { kind: "DOCUMENT", reference: "Учебная выписка, раздел назначений", date: "2026-10-01" }, regimen: "Режим в документе не уточнён", intake: "UNKNOWN", startedOn: null, stoppedOn: null }] } };
  const url = (pid = patientId, extra = "") => `/api/clinical-profile?patientId=${pid}${extra}`;
  const post = (client: APIRequestContext, content: ProfileContent, expectedVersion: number, requestKey = randomUUID(), pid = patientId) => client.post("/api/clinical-profile", { data: { patientId: pid, content, expectedVersion, requestKey, reviewed: true } });
  async function current(pid = patientId): Promise<ProfileWorkspace> { const r = await doctor.get(url(pid)); expect(r.status()).toBe(200); return r.json(); }
  test.beforeAll(async () => {
    async function account(name: string, role: string) {
      const client = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
      const r = await authPost(client, "/api/auth/sign-up/email", { name, email: `profile-${randomUUID()}@synthetic.kontur.demo`, password: randomUUID() }); expect(r.status()).toBe(200); const id = (await r.json()).user.id;
      if (role === "DOCTOR") await db.user.update({ where: { id }, data: { role, specialty: "Тестовый профиль" } }); return { client, id };
    }
    const d = await account("Врач сведений", "DOCTOR"); doctor = d.client; doctorId = d.id;
    const p = await account("Пациент сведений", "PATIENT"); patient = p.client; patientUser = p.id;
    const o = await account("Другой врач сведений", "DOCTOR"); other = o.client; otherId = o.id;
    for (const [index, name] of ["Профиль Первый", "Профиль Второй", "Профиль История"].entries()) { const card = await db.patient.create({ data: { doctorId, userId: index === 0 ? patientUser : null, name, publicId: `PROFILE-${randomUUID()}`, birthDate: new Date("1990-01-01") } }); if (index === 0) patientId = card.id; else if (index === 1) secondId = card.id; else historyId = card.id; }
  });
  test.afterAll(async () => {
    await db.patient.deleteMany({ where: { id: { in: [patientId, secondId, historyId].filter(Boolean) }, doctorId: { in: [doctorId, otherId].filter(Boolean) } } });
    await db.auditEvent.deleteMany({ where: { actorId: { in: [doctorId, patientUser, otherId].filter(Boolean) } } });
    await db.user.deleteMany({ where: { id: { in: [doctorId, patientUser, otherId].filter(Boolean) } } });
    await Promise.all([doctor?.dispose(), patient?.dispose(), other?.dispose()]); await db.$disconnect();
  });
  test("доступ, неизвестность и отсутствие источника", async () => {
    expect(await current()).toEqual({ current: null, version: 0 });
    expect((await patient.get(url())).status()).toBe(403); expect((await other.get(url())).status()).toBe(404);
    expect((await post(patient, initial, 0)).status()).toBe(403); expect((await post(other, initial, 0)).status()).toBe(404);
    expect((await post(doctor, { ...initial, allergies: { ...initial.allergies, evidence: null } }, 0)).status()).toBe(400);
    expect((await post(doctor, { ...initial, allergies: { ...initial.allergies, evidence: { ...evidence, date: "2026-02-30" } } }, 0)).status()).toBe(400);
    expect(await db.clinicalProfileVersion.count({ where: { patientId } })).toBe(0);
  });
  test("повтор, конфликт вкладок, неизменность источников и условное чтение", async () => {
    const key = randomUUID(); const before = await db.patient.findUniqueOrThrow({ where: { id: patientId } });
    const replies = await Promise.all([post(doctor, initial, 0, key), post(doctor, initial, 0, key)]); expect(replies.map(r => r.status())).toEqual([200, 200]); firstVersionId = (await replies[0].json()).id;
    expect(await db.clinicalProfileVersion.count({ where: { patientId } })).toBe(1); expect((await db.patient.findUniqueOrThrow({ where: { id: patientId } })).clinicalDataVersion).toBe(before.clinicalDataVersion + 1);
    expect((await post(doctor, initial, 0, key, secondId)).status()).toBe(409);
    const currentResponse = await doctor.get(url()); const etag = currentResponse.headers().etag; expect(etag).toBeTruthy(); expect((await doctor.get(url(), { headers: { "If-None-Match": etag } })).status()).toBe(304); expect((await other.get(url(), { headers: { "If-None-Match": etag } })).status()).toBe(404);
    const a = { ...initial, conditions: { ...initial.conditions, note: "Нужно уточнить дополнительные сведения" } }; const b = { ...initial, conditions: { ...initial.conditions, note: "Конкурирующая вкладка" } };
    const attempts = await Promise.all([post(doctor, a, 1), post(doctor, b, 1)]); expect(attempts.map(r => r.status()).sort()).toEqual([200, 409]); latestVersionId = (await attempts.find(r => r.status() === 200)!.json()).id;
    expect((await doctor.get(url(), { headers: { "If-None-Match": etag } })).status()).toBe(200);
    const stored = await current(); expect((await post(doctor, stored.current!.content, 2)).status()).toBe(400); expect(await db.clinicalProfileVersion.count({ where: { patientId } })).toBe(2);
    const old = await (await doctor.get(url(patientId, `&versionId=${firstVersionId}`))).json(); expect(old.current.content).toEqual(initial); expect(old.current.isCurrent).toBe(false);
    expect((await doctor.get(url(secondId, `&versionId=${firstVersionId}`))).status()).toBe(404);
    const publicData = JSON.stringify(await (await patient.get("/api/workspace")).json()); expect(publicData).not.toContain("Учебный препарат A"); expect(publicData).not.toContain("Учебная выписка");
  });
  test("изменение сведений устаревает черновик, план хранит выбранную версию", async () => {
    const care = await (await doctor.get(`/api/care?patientId=${patientId}`)).json();
    const content = { goal: "Следующий контакт", instructions: "Подготовить вопросы к следующему контакту", nextContactDate: null, tasks: [] };
    const draft = await doctor.post("/api/care", { data: { action: "save-draft", patientId, revision: 0, content, basisToken: care.context.token } }); expect(draft.status()).toBe(200); const saved = await draft.json();
    const profile = await current(); const next = { ...profile.current!.content, conditions: { ...profile.current!.content.conditions, note: "Обновлённые сведения для проверки плана" } }; expect((await post(doctor, next, profile.version)).status()).toBe(200); latestVersionId = (await current()).current!.id;
    const confirmation = { action: "confirm", patientId, draftId: saved.id, revision: saved.revision, reviewed: true, requestKey: randomUUID() };
    expect((await doctor.post("/api/care", { data: confirmation })).status()).toBe(409);
    const fresh = await (await doctor.get(`/api/care?patientId=${patientId}`)).json(); expect(fresh.draft.stale).toBe(true);
    const rebased = await doctor.post("/api/care", { data: { action: "rebase", patientId, content, revision: saved.revision, basisToken: fresh.context.token, reviewed: true } }); expect(rebased.status()).toBe(200);
    confirmation.revision = (await rebased.json()).revision; expect((await doctor.post("/api/care", { data: confirmation })).status()).toBe(200);
    expect((await (await doctor.get(`/api/care?patientId=${patientId}`)).json()).current.clinicalProfileVersionId).toBe(latestVersionId);
    expect((await (await patient.get(`/api/care?patientId=${patientId}`)).json()).current.clinicalProfileVersionId).toBeUndefined();
    const changed = await current(); await post(doctor, { ...next, conditions: { ...next.conditions, note: "Уточнение после подтверждения" } }, changed.version);
    const plan = await (await doctor.get(`/api/care?patientId=${patientId}`)).json(); expect(plan.current.clinicalProfileVersionId).toBe(latestVersionId); expect(plan.context.changesSincePlan).toBe(true);
  });
  test("история ограничена страницей и проверяет область курсора", async () => {
    const ids: string[] = [];
    for (let version = 1; version <= 21; version++) { const row = await db.clinicalProfileVersion.create({ data: { patientId: historyId, version, content: emptyProfile(), contentHash: `synthetic-${version}`, savedById: doctorId, savedByName: "Учебный врач", requestKey: randomUUID(), payloadHash: randomUUID() } }); ids.push(row.id); }
    await db.patient.update({ where: { id: historyId }, data: { currentClinicalProfileId: ids.at(-1) } });
    const first = await (await doctor.get(url(historyId, "&view=history"))).json(); expect(first.versions).toHaveLength(20); expect(first.versions[0].version).toBe(21); expect(JSON.stringify(first)).not.toContain("contentHash");
    const second = await (await doctor.get(url(historyId, `&view=history&cursor=${first.nextCursor}`))).json(); expect(second.versions.map((v: { version: number }) => v.version)).toEqual([1]); expect(second.nextCursor).toBeNull();
    expect((await doctor.get(url(patientId, `&view=history&cursor=${first.nextCursor}`))).status()).toBe(400);
  });
  test("редактирование в одной панели, сохранение ввода, сбой и мобильные состояния", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await doctor.storageState(), viewport: { width: 1440, height: 1000 } }); const page = await context.newPage(); const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(`/doctor?patient=${secondId}`); await expect(page.getByRole("button", { name: "Назначить анкету", exact: true })).toBeVisible(); await page.getByRole("tab", { name: "Лечение и задачи", exact: true }).click(); await expect(page.getByRole("button", { name: "Назначить лечение", exact: true })).toBeVisible(); await expect(page.getByRole("tab", { name: "Обзор", exact: true })).toBeEnabled(); await page.screenshot({ animations: "disabled", path: ".impeccable/review/profile-overview-1440.png" }); await page.getByRole("tab", { name: "Данные", exact: true }).click(); await page.getByRole("button", { name: "Уточнить сведения", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Уточнить клинические сведения", exact: true });
    await editor.getByRole("textbox", { name: "Что осталось уточнить · необязательно", exact: true }).fill("Уточнить сведения на следующем контакте");
    await editor.getByRole("button", { name: "Аллергии", exact: true }).click(); await editor.getByRole("combobox", { name: "Статус сведений", exact: true }).selectOption("NONE"); await editor.getByRole("textbox", { name: "Где получены сведения", exact: true }).fill("Учебная беседа на приёме");
    await editor.getByRole("button", { name: "Препараты", exact: true }).click(); await editor.getByRole("combobox", { name: "Статус сведений", exact: true }).selectOption("KNOWN"); await editor.getByRole("button", { name: "Добавить запись", exact: true }).click();
    await editor.getByRole("textbox", { name: "Название", exact: true }).fill("Учебный препарат B"); await editor.getByRole("combobox", { name: "Статус приёма", exact: true }).selectOption("STOPPED"); await editor.getByRole("textbox", { name: "Где получены сведения", exact: true }).fill("Учебная выписка, раздел терапии"); await editor.getByRole("combobox", { name: "Тип источника", exact: true }).selectOption("DOCUMENT");
    await expect(editor.getByRole("button", { name: "Сохранить сведения", exact: true })).toBeDisabled(); await page.getByRole("button", { name: "Закрыть панель", exact: true }).click();
    await page.getByRole("button", { name: "К списку пациентов", exact: true }).click(); await page.getByRole("button", { name: /Открыть карточку: Профиль Первый/ }).click(); await page.getByRole("button", { name: "К списку пациентов", exact: true }).click(); await page.getByRole("button", { name: /Открыть карточку: Профиль Второй/ }).click();
    await page.getByRole("tab", { name: "Данные", exact: true }).click(); await page.getByRole("button", { name: "Продолжить ввод", exact: true }).click(); await editor.getByRole("button", { name: "Препараты", exact: true }).click(); await expect(editor.getByRole("textbox", { name: "Название", exact: true })).toHaveValue("Учебный препарат B");
    for (const width of [1440, 390, 320]) { await page.setViewportSize({ width, height: 844 }); await editor.evaluate(el => { el.scrollTop = 0; }); await page.screenshot({ animations: "disabled", path: `.impeccable/review/profile-editor-${width}.png` }); await editor.evaluate(el => { el.scrollTop = el.scrollHeight; }); await page.screenshot({ animations: "disabled", path: `.impeccable/review/profile-editor-bottom-${width}.png` }); expect(await editor.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
    expect((await new AxeBuilder({ page }).include("dialog[open]").analyze()).violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    await editor.getByRole("checkbox").check(); let fail = true;
    await page.route("**/api/clinical-profile", async route => { if (route.request().method() === "POST" && fail) { fail = false; await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Временный сбой. Повторите сохранение." }) }); } else await route.continue(); });
    await editor.getByRole("button", { name: "Сохранить сведения", exact: true }).click(); await expect(editor.getByRole("alert")).toContainText("Временный сбой"); await expect(editor.getByRole("textbox", { name: "Название", exact: true })).toHaveValue("Учебный препарат B");
    await editor.getByRole("button", { name: "Сохранить сведения", exact: true }).click(); await expect(editor).not.toBeVisible(); await page.reload(); await page.getByRole("tab", { name: "Данные", exact: true }).click(); await expect(page.getByText("Учебный препарат B", { exact: true })).toBeVisible();
    for (const width of [1440, 390, 320]) { await page.setViewportSize({ width, height: 844 }); await page.screenshot({ animations: "disabled", path: `.impeccable/review/profile-data-${width}.png`, fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
    expect((await new AxeBuilder({ page }).analyze()).violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    await page.getByRole("button", { name: "Уточнить сведения", exact: true }).click(); await editor.getByRole("button", { name: "Препараты", exact: true }).click(); await editor.getByRole("textbox", { name: "Название", exact: true }).fill("Мой несохранённый учебный препарат");
    const remote = await current(secondId); expect((await post(doctor, { ...remote.current!.content, conditions: { ...remote.current!.content.conditions, note: "Уточнение в другой вкладке" } }, remote.version, randomUUID(), secondId)).status()).toBe(200);
    await expect(editor.getByText(/На сервере уже версия 2/)).toBeVisible({ timeout: 12000 }); await expect(editor.getByRole("textbox", { name: "Название", exact: true })).toHaveValue("Мой несохранённый учебный препарат"); await page.setViewportSize({ width: 390, height: 844 }); await editor.evaluate(el => { el.scrollTop = 0; }); await page.screenshot({ animations: "disabled", path: ".impeccable/review/profile-conflict-390.png" });
    await editor.getByRole("button", { name: "Посмотреть актуальные сведения", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "Продолжить ввод", exact: true }).click(); await editor.getByRole("button", { name: "Заменить мой ввод актуальной версией", exact: true }).click(); await expect(editor.getByRole("textbox", { name: "Название", exact: true })).toHaveValue("Учебный препарат B"); await page.getByRole("button", { name: "Закрыть панель", exact: true }).click(); await page.setViewportSize({ width: 320, height: 844 });
    await page.getByRole("button", { name: "История сведений", exact: true }).click(); await page.getByRole("button", { name: /^Версия 1/ }).click(); await expect(page.getByRole("dialog").getByText("Учебный препарат B", { exact: true })).toBeVisible(); await page.screenshot({ animations: "disabled", path: ".impeccable/review/profile-history-320.png" }); await page.getByRole("button", { name: "Закрыть панель", exact: true }).click();
    await page.getByRole("button", { name: "К списку пациентов", exact: true }).click(); await page.getByRole("button", { name: /Открыть карточку: Профиль Первый/ }).click(); await page.getByRole("tab", { name: "Лечение и задачи", exact: true }).click(); await page.getByRole("button", { name: "Открыть план", exact: true }).click(); await page.getByRole("button", { name: "Сведения на момент подтверждения", exact: true }).click(); await expect(page.getByRole("dialog").getByText("Обновлённые сведения для проверки плана", { exact: true })).toBeVisible(); await page.screenshot({ animations: "disabled", path: ".impeccable/review/profile-plan-source-320.png" }); await page.getByRole("button", { name: "Закрыть панель", exact: true }).click();
    await page.getByRole("tab",{name:"Обзор",exact:true}).click(); await page.getByRole("button", { name: "Открыть план", exact: true }).click(); await page.getByRole("button", { name: "История версий", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: /^Версия 1 ·/ }).click(); await page.getByRole("dialog").getByRole("button", { name: "Сведения на момент подтверждения", exact: true }).click(); await expect(page.getByRole("dialog").getByText("Обновлённые сведения для проверки плана", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "Закрыть панель", exact: true }).click();
    await page.getByRole("tab", { name: "Данные", exact: true }).click(); await db.patient.update({ where: { id: patientId }, data: { doctorId: otherId } });
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 12000 }); await expect(page.getByText("Учебный препарат A", { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]); await context.close();
  });
});
