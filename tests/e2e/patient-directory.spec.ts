import { authPost } from "./auth-request";
import "dotenv/config";
import { test, expect, request, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { db } from "../../src/server/db";

const origin = "http://localhost:3000";
test.describe.serial("Серверный каталог и отдельная история", () => {
  let doctor: APIRequestContext, patient: APIRequestContext, other: APIRequestContext;
  let doctorId = "", userId = "", otherId = "";
  const token = randomUUID(); const ids = Array.from({ length: 120 }, (_, i) => `directory-${token}-${String(i).padStart(3, "0")}`);
  const oldest = ids[0]; const outside = ids[1]; let oldMessageId = "", newestMessageId = "";
  const path = (query = "") => `/api/patients${query ? `?${query}` : ""}`;
  async function directory(query = "") { const response = await doctor.get(path(query)); expect(response.status()).toBe(200); return response.json(); }
  test.beforeAll(async () => {
    async function account(name: string, role: string) {
      const context = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
      const response = await authPost(context, "/api/auth/sign-up/email", { name, email: `${name === "Пациент каталога" ? "patient" : role.toLowerCase()}-${randomUUID()}@synthetic.kontur.demo`, password: randomUUID() });
      expect(response.status()).toBe(200); const id = (await response.json()).user.id;
      // Trusted fixture provisioning; public signup still cannot choose a doctor role.
      if (role === "DOCTOR") await db.user.update({ where: { id }, data: { role, specialty: "Тестовый профиль" } });
      return { context, id };
    }
    const d = await account("Врач каталога", "DOCTOR"); doctor = d.context; doctorId = d.id;
    const p = await account("Пациент каталога", "PATIENT"); patient = p.context; userId = p.id;
    const o = await account("Другой врач", "DOCTOR"); other = o.context; otherId = o.id;
    await db.patient.createMany({ data: ids.map((id, index) => ({ id, doctorId, userId: index === 0 ? userId : null, publicId: `TEST-${token}-${String(index).padStart(3, "0")}`, name: index === 4 ? "Каталог 100%_готов" : `Тестовый Пациент ${String(index).padStart(3, "0")}`, birthDate: new Date("1990-01-01"), note: "PRIVATE_NOTE_NOT_IN_DIRECTORY", updatedAt: new Date(Date.UTC(2026, 0, 2, 0, 0, index)), nextVisit: index === 1 ? new Date("2026-10-20T09:00:00Z") : null })) });
    await db.observation.createMany({ data: Array.from({ length: 41 }, (_, index) => ({ patientId: oldest, requestKey: `directory-observation-${token}-${index}`, score: 3, needsContact: index === 0, note: index === 0 ? "Старая просьба связаться" : "Последующая отметка", createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)) })) });
    await db.observation.create({ data: { patientId: outside, requestKey: `directory-source-${token}`, score: 3, note: "Проверяемый исходный ответ", createdAt: new Date("2026-01-02") } });
    await db.message.createMany({ data: Array.from({ length: 61 }, (_, index) => ({ patientId: oldest, requestKey: `directory-message-${token}-${index}`, senderId: index === 0 || index === 60 ? userId : doctorId, text: index === 0 ? "Старый непрочитанный вопрос" : index === 60 ? "Новый вопрос" : `Учебное сообщение ${index}`, readAt: index === 0 || index === 60 ? null : new Date("2026-01-01"), createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)) })) });
    oldMessageId = (await db.message.findUniqueOrThrow({ where: { requestKey: `directory-message-${token}-0` } })).id;
    newestMessageId = (await db.message.findUniqueOrThrow({ where: { requestKey: `directory-message-${token}-60` } })).id;
  });
  test.afterAll(async () => {
    await db.patient.deleteMany({ where: { id: { in: ids }, doctorId: { in: [doctorId, otherId] } } });
    await db.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: [doctorId, userId, otherId] } }, { targetId: { in: ids } }] } });
    await db.user.deleteMany({ where: { id: { in: [doctorId, userId, otherId].filter(Boolean) } } });
    await Promise.all([doctor?.dispose(), patient?.dispose(), other?.dispose()]); await db.$disconnect();
  });
  test("120 пациентов доступны страницами без историй и дублей", async () => {
    let cursor: string | null = null; const seen: string[] = []; let pages = 0; let maxBytes = 0; let previousCursor: string | null = null;
    do {
      const data = await directory(cursor ? `cursor=${encodeURIComponent(cursor)}` : "");
      expect(data.matchedTotal).toBe(120); expect(data.counts.all).toBe(120); expect(data.patients.length).toBeLessThanOrEqual(20);
      expect(data.upcoming[0].id).toBe(outside);
      for (const row of data.patients) { expect(row.observations).toBeUndefined(); expect(row.messages).toBeUndefined(); expect(row.note).toBeUndefined(); }
      expect(JSON.stringify(data)).not.toContain("PRIVATE_NOTE_NOT_IN_DIRECTORY");
      maxBytes = Math.max(maxBytes, Buffer.byteLength(JSON.stringify(data), "utf8"));
      seen.push(...data.patients.map((row: { id: string }) => row.id)); cursor = data.nextCursor; previousCursor = data.previousCursor; pages++; expect(data.page).toBe(pages);
    } while (cursor && pages < 10);
    expect(pages).toBe(6); expect(seen).toHaveLength(120); expect(new Set(seen)).toEqual(new Set(ids)); expect(seen[0]).toBe(oldest);
    for (let page = 5; page >= 1; page--) {
      expect(previousCursor).toBeTruthy(); const data = await directory(`cursor=${encodeURIComponent(previousCursor!)}`);
      expect(data.page).toBe(page); expect(data.patients.map((row: { id: string }) => row.id)).toEqual(seen.slice((page - 1) * 20, page * 20)); previousCursor = data.previousCursor;
    }
    expect(previousCursor).toBeNull();
    console.info("Directory fixture:", JSON.stringify({ patients: 120, pages, maxResponseBytes: maxBytes, messageBodiesInList: 0 }));
  });
  test("поиск за прежней границей 100 и буквальные спецсимволы", async () => {
    const first = await directory(); expect(first.patients.some((row: { id: string }) => row.id === outside)).toBe(false);
    const found = await directory(`q=${encodeURIComponent("тЕсТоВыЙ ПаЦиЕнТ 001")}`); expect(found.patients.map((row: { id: string }) => row.id)).toEqual([outside]);
    const literal = await directory(`q=${encodeURIComponent("100%_")}`); expect(literal.matchedTotal).toBe(1); expect(literal.patients[0].id).toBe(ids[4]);
    expect((await directory(`q=${encodeURIComponent("%")}`)).matchedTotal).toBe(1);
    const detail = await doctor.get(`/api/patients/${outside}`); expect(detail.status()).toBe(200); expect((await detail.json()).patient.id).toBe(outside);
  });
  test("счётчики и просьбы учитывают записи старше окна карточки", async () => {
    const data = await directory("filter=attention"); expect(data.patients.map((row: { id: string }) => row.id)).toEqual([oldest]); expect(data.counts.attention).toBe(1); expect(data.counts.unreadMessages).toBe(2);
    expect(data.patients[0].contactRequests).toBe(1); expect(data.patients[0].unreadMessages).toBe(2);
    const card = (await (await doctor.get(`/api/patients/${oldest}`)).json()).patient;
    expect(card.observations).toHaveLength(30); expect(card.observations.some((row: { needsContact: boolean }) => row.needsContact)).toBe(false);
    expect(card.contactRequests[0].note).toBe("Старая просьба связаться"); expect(card.messages).toHaveLength(50);
  });
  test("чужой доступ, область курсора и условное чтение", async () => {
    const first = await directory();
    expect((await other.get(`/api/patients/${oldest}`)).status()).toBe(404);
    expect((await patient.get("/api/patients")).status()).toBe(403);
    expect((await patient.get(`/api/patients/${outside}`)).status()).toBe(404);
    expect((await other.get(`/api/patients/${oldest}/messages?before=${oldMessageId}`)).status()).toBe(404);
    expect((await doctor.get(path(`filter=pending&cursor=${encodeURIComponent(first.nextCursor)}`))).status()).toBe(400);
    expect((await other.get(path(`cursor=${encodeURIComponent(first.nextCursor)}`))).status()).toBe(400);
    expect((await doctor.get(path("cursor=broken"))).status()).toBe(400);
    const initial = await doctor.get(path()); const etag = initial.headers().etag;
    expect((await doctor.get(path(), { headers: { "If-None-Match": etag } })).status()).toBe(304);
    expect((await other.get(path(), { headers: { "If-None-Match": etag } })).status()).toBe(200);
    const detailPath = `/api/patients/${outside}`; const version = (await doctor.get(detailPath)).headers().etag;
    expect((await doctor.get(detailPath, { headers: { "If-None-Match": version } })).status()).toBe(304);
    await db.patient.update({ where: { id: outside }, data: { doctorId: otherId } });
    expect((await doctor.get(detailPath, { headers: { "If-None-Match": version } })).status()).toBe(404);
    await db.patient.update({ where: { id: outside }, data: { doctorId } });
  });
  test("поиск, страница и черновик сохраняются после карточки, назад и reload", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await doctor.storageState(), viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); const requests: string[] = [];
    page.on("request", req => { if (req.method() === "GET") requests.push(new URL(req.url()).pathname); });
    await page.goto("/doctor"); const list = page.getByRole("region", { name: "Список пациентов" });
    await expect(list.getByRole("row")).toHaveCount(21);
    for (const number of [2, 3, 4]) { await list.getByRole("button", { name: "Дальше", exact: true }).click(); await expect(list.getByText(`Страница ${number}`, { exact: true })).toBeVisible(); }
    const fourth = await list.getByRole("button", { name: /Открыть карточку:/ }).first().locator("strong").innerText();
    await page.reload(); await expect(list.getByText("Страница 4", { exact: true })).toBeVisible(); await expect(list.getByRole("button", { name: /Открыть карточку:/ }).first().locator("strong")).toHaveText(fourth);
    await page.screenshot({ path: ".impeccable/review/directory-page4-1440.png", fullPage: true });
    const selected = list.getByRole("button", { name: /Открыть карточку:/ }).first(); const title = await selected.locator("strong").innerText();
    await selected.click(); await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Подключить пациента", exact: true }).waitFor();
    await page.getByRole("button", { name: "К списку пациентов", exact: true }).click();
    await expect(list.getByText("Страница 4", { exact: true })).toBeVisible(); await page.goBack(); await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible(); await page.goBack(); await expect(list.getByText("Страница 4", { exact: true })).toBeVisible();
    for (const number of [3, 2, 1]) { await list.getByRole("button", { name: "Назад", exact: true }).click(); await expect(list.getByText(`Страница ${number}`, { exact: true })).toBeVisible(); }
    await expect(list.getByRole("button", { name: "Назад", exact: true })).toBeDisabled();
    await page.getByRole("searchbox", { name: "Найти пациента" }).fill("Тестовый Пациент 001");
    await expect(list.getByRole("row")).toHaveCount(2); await list.getByRole("button", { name: /Открыть карточку: Тестовый Пациент 001/ }).click();
    await expect(page.getByRole("heading", { name: "Тестовый Пациент 001", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Общение", exact: true }).click(); await page.getByRole("textbox", { name: "Текст сообщения" }).fill("Черновик между страницами");
    await page.getByRole("button", { name: "К списку пациентов", exact: true }).click(); await expect(page.getByRole("searchbox")).toHaveValue("Тестовый Пациент 001");
    await page.goBack(); await expect(page.getByRole("textbox", { name: "Текст сообщения" })).toHaveValue("Черновик между страницами");
    await page.getByRole("button", { name: "К списку пациентов", exact: true }).click(); await page.reload(); await expect(page.getByRole("searchbox")).toHaveValue("Тестовый Пациент 001");
    expect(requests).not.toContain("/api/workspace");
    for (const width of [1440, 390, 320]) {
      await page.getByRole("searchbox").fill(""); await expect(list.getByRole("row")).toHaveCount(21);
      await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.impeccable/review/directory-${width}.png`, fullPage: true });
      const audit = await new AxeBuilder({ page }).analyze(); expect(audit.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
    }
    await context.close();
  });
  test("отозванная карточка скрывается, поздний ответ не подменяет другого пациента", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await doctor.storageState(), viewport: { width: 390, height: 844 } });
    const page = await context.newPage(); await page.goto(`/doctor?patient=${outside}&tab=overview`);
    await expect(page.getByRole("heading", { name: "Тестовый Пациент 001", exact: true })).toBeVisible();
    await page.getByRole("tab",{name:"Динамика",exact:true}).click(); await page.getByRole("combobox",{name:"Период",exact:true}).selectOption("ALL"); await page.getByRole("button", { name: "Исходная отметка", exact: true }).first().click(); await expect(page.getByRole("dialog", { name: "Исходный самоотчёт", exact: true })).toBeVisible();
    await page.route(`**/api/patients/${outside}`, route => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Карточка не найдена или недоступна." }) }));
    await expect(page.getByRole("heading", { name: "Карточка недоступна", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Тестовый Пациент 001", exact: true })).toHaveCount(0);
    await expect(page.getByRole("dialog")).not.toBeVisible(); await expect(page.getByText("Проверяемый исходный ответ", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: ".impeccable/review/directory-unavailable-390.png" });
    await page.unroute(`**/api/patients/${outside}`); await page.getByRole("button", { name: "Повторить загрузку" }).click();
    await expect(page.getByRole("heading", { name: "Тестовый Пациент 001", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Подключить пациента", exact: true }).click(); await expect(page.locator(".invite-code")).toBeVisible();
    await page.route(`**/api/patients/${outside}`, route => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Доступ к карточке отозван." }) }));
    await expect(page.getByRole("heading", { name: "Карточка недоступна", exact: true })).toBeVisible(); await expect(page.getByRole("dialog")).not.toBeVisible(); await expect(page.locator(".invite-code")).toHaveCount(0);
    await page.unroute(`**/api/patients/${outside}`); await page.getByRole("button", { name: "Повторить загрузку" }).click(); await expect(page.getByRole("heading", { name: "Тестовый Пациент 001", exact: true })).toBeVisible();
    let releaseInvite: (() => void) | undefined; let inviteFinished: (() => void) | undefined;
    const inviteGate = new Promise<void>(resolve => { releaseInvite = resolve; }); const inviteDone = new Promise<void>(resolve => { inviteFinished = resolve; });
    await page.route("**/api/workspace", async route => {
      if (route.request().method() !== "POST" || route.request().postDataJSON().action !== "invite") { await route.continue(); return; }
      await inviteGate; await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: "111222", url: `${origin}/connect#discarded`, expiresAt: new Date().toISOString() }) }); inviteFinished!();
    });
    try {
      await page.getByRole("button", { name: "Подключить пациента", exact: true }).click(); await expect(page.getByRole("dialog", { name: "Подключить пациента", exact: true })).toBeVisible();
      await page.route(`**/api/patients/${outside}`, route => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Карточка недоступна." }) }));
      await expect(page.getByRole("heading", { name: "Карточка недоступна", exact: true })).toBeVisible(); releaseInvite!(); await inviteDone;
      await expect(page.getByRole("dialog")).not.toBeVisible(); await expect(page.locator(".invite-code")).toHaveCount(0);
    } finally { releaseInvite?.(); await page.unroute("**/api/workspace"); }
    await page.getByRole("button", { name: "К списку пациентов", exact: true }).click();
    const source = await (await doctor.get(`/api/patients/${ids[2]}`)).json();
    let release: (() => void) | undefined; let finish: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; }); const finished = new Promise<void>(resolve => { finish = resolve; });
    await page.route(`**/api/patients/${ids[2]}`, async route => { await gate; await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(source) }).catch(() => {}); finish!(); });
    try {
      await page.getByRole("searchbox").fill("Тестовый Пациент 002");
      const pending = page.waitForRequest(req => new URL(req.url()).pathname === `/api/patients/${ids[2]}`);
      await page.getByRole("button", { name: /Открыть карточку: Тестовый Пациент 002/ }).click(); await pending;
      await page.goBack(); await page.getByRole("searchbox").fill("Тестовый Пациент 003");
      await page.getByRole("button", { name: /Открыть карточку: Тестовый Пациент 003/ }).click();
      await expect(page.getByRole("heading", { name: "Тестовый Пациент 003", exact: true })).toBeVisible();
      release!(); await finished;
      await expect(page.getByRole("heading", { name: "Тестовый Пациент 003", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Тестовый Пациент 002", exact: true })).toHaveCount(0);
      await page.screenshot({ path: ".impeccable/review/directory-context-390.png" });
    } finally { release?.(); await context.close(); }
  });
  test("ранние сообщения догружаются без ложного прочтения всей истории", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await doctor.storageState(), viewport: { width: 390, height: 844 } });
    const page = await context.newPage(); await page.goto(`/doctor?patient=${oldest}&tab=messages`);
    await expect(page.getByRole("log").getByText("Новый вопрос", { exact: true })).toBeVisible();
    await expect.poll(async () => (await db.message.findUniqueOrThrow({ where: { id: newestMessageId } })).readAt !== null).toBe(true);
    expect((await db.message.findUniqueOrThrow({ where: { id: oldMessageId } })).readAt).toBeNull();
    expect((await directory("filter=messages")).counts.unreadMessages).toBe(1);
    await page.getByRole("button", { name: "Показать более ранние сообщения", exact: true }).click();
    await expect(page.getByRole("log").getByText("Старый непрочитанный вопрос", { exact: true })).toHaveCount(1);
    await expect.poll(async () => (await db.message.findUniqueOrThrow({ where: { id: oldMessageId } })).readAt !== null).toBe(true);
    await expect(page.getByRole("button", { name: "Показать более ранние сообщения", exact: true })).toHaveCount(0);
    const log = page.getByRole("log"); await log.evaluate(el => { el.scrollTop = 0; });
    for (const width of [390, 1440]) { await page.setViewportSize({ width, height: 1000 }); await page.screenshot({ path: `.impeccable/review/directory-messages-${width}.png` }); }
    expect((await new AxeBuilder({ page }).analyze()).violations.map(v => v.id)).toEqual([]);
    await context.close();
  });
});
