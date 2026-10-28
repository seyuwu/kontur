import { authPost } from "./auth-request";
import "dotenv/config";
import { test, expect, request, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/server/db";

const origin = "http://localhost:3000";
async function loginApi(email: string) {
  const client = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
  const login = await authPost(client, "/api/auth/sign-in/email", { email, password: process.env.DEMO_PASSWORD });
  expect(login.status()).toBe(200);
  return client;
}
async function workspace(client: APIRequestContext) { const result = await client.get("/api/workspace"); expect(result.status()).toBe(200); return result.json(); }
async function command(client: APIRequestContext, data: object) { return client.post("/api/workspace", { data }); }
async function loginUi(page: Page, account: RegExp) {
  await page.goto("/login"); await page.waitForLoadState("networkidle");
  for (let attempt = 0; attempt < 2; attempt++) {
    const [response] = await Promise.all([
      page.waitForResponse(result => result.url().endsWith("/api/auth/sign-in/email") && result.request().method() === "POST"),
      page.getByRole("button", { name: account }).click()
    ]);
    if (response.status() !== 429 || attempt === 1) { expect(response.status()).toBe(200); break; }
    // Учитываем настоящий лимит входов, не отключая его ради тестов.
    const seconds = Number(response.headers()["x-retry-after"]);
    expect(seconds).toBeGreaterThan(0); expect(seconds).toBeLessThanOrEqual(60);
    await new Promise(resolve => setTimeout(resolve, seconds * 1000 + 100));
  }
  await page.waitForURL(/\/(doctor|patient)$/);
  await page.waitForLoadState("networkidle");
}
test.afterAll(async () => { await db.$disconnect(); });

test("доступ: сессии, роли, чужие пациенты и запрет повышения роли", async () => {
  const anonymous = await request.newContext({ baseURL: origin });
  expect((await anonymous.get("/api/workspace")).status()).toBe(401);
  const doctor = await loginApi("doctor@kontur.demo");
  const patient = await loginApi("patient@kontur.demo");
  expect((await (await doctor.get("/api/patients")).json()).patients.some((p: { id: string }) => p.id === "patient-victor")).toBe(false);
  expect((await doctor.get("/api/patients/patient-victor")).status()).toBe(404);
  expect((await doctor.get("/api/workspace")).status()).toBe(410);
  expect((await command(doctor, { action: "note", patientId: "patient-victor", note: "Недопустимое изменение" })).status()).toBe(404);
  expect((await command(patient, { action: "create-patient", name: "Нельзя", birthDate: "1990-01-01" })).status()).toBe(403);
  expect((await command(patient, { action: "note", patientId: "patient-anna", note: "Не врач" })).status()).toBe(403);
  expect((await command(patient, { action: "observation", patientId: "patient-victor", score: 3, note: "", needsContact: false, requestKey: randomUUID() })).status()).toBe(404);
  const evil = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: "https://untrusted.example" } });
  expect((await evil.post("/api/workspace", { data: { action: "create-patient", name: "Нельзя", birthDate: "1990-01-01" } })).status()).toBe(403);
  const email = `test-role-${randomUUID()}@synthetic.kontur.demo`;
  const newcomer = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
  let userId: string | undefined;
  try {
    const signup = await authPost(newcomer, "/api/auth/sign-up/email", { name: "Тест роли", email, password: randomUUID(), role: "DOCTOR", specialty: "Врач" });
    expect(signup.status()).toBe(400);
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
    const safeSignup = await authPost(newcomer, "/api/auth/sign-up/email", { name: "Тест роли", email, password: randomUUID() });
    expect(safeSignup.status()).toBe(200);
    const result = await workspace(newcomer); userId = result.actor.id;
    expect(result.actor.role).toBe("PATIENT"); expect(result.actor.specialty).toBeNull();
    expect((await command(newcomer, { action: "create-patient", name: "Нельзя", birthDate: "1990-01-01" })).status()).toBe(403);
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
    await Promise.all([anonymous.dispose(), doctor.dispose(), patient.dispose(), evil.dispose(), newcomer.dispose()]);
  }
});

test("врач сохраняет поиск, исходный факт, вкладку и черновик сообщения", async ({ page }) => {
  await loginUi(page, /Кабинет терапевта/);
  await page.getByRole("searchbox", { name: "Найти пациента" }).fill("Анна");
  await page.getByRole("button", { name: /Анна Ковалёва/ }).first().click();
  await expect(page.getByRole("heading", { name: "Анна Ковалёва", exact: true })).toBeVisible();
  await page.getByRole("tab", {name:"Динамика",exact:true}).click();
  await page.getByRole("button", { name: "Исходная отметка" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Сообщил пациент", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("tab", {name:"Обзор",exact:true}).click();
  await page.getByRole("button", { name: /^(Добавить запись|Редактировать заметку)$/ }).click();
  await page.getByRole("textbox", { name: "Что обсудить с пациентом" }).fill("Несохранённая заметка");
  await expect(page.getByRole("dialog").locator('input[type="date"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^(Добавить запись|Редактировать заметку)$/ }).click();
  await expect(page.getByRole("textbox", { name: "Что обсудить с пациентом" })).toHaveValue("Несохранённая заметка");
  await page.getByRole("button", { name: "Сбросить изменения" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /Общение/ }).click();
  await page.getByRole("textbox", { name: "Текст сообщения" }).fill("Черновик не должен потеряться");
  await page.getByRole("tab", { name: "Данные", exact: true }).click();
  await page.getByRole("tab", { name: /Общение/ }).click();
  await expect(page.getByRole("textbox", { name: "Текст сообщения" })).toHaveValue("Черновик не должен потеряться");
  await page.getByRole("button", { name: "К списку пациентов" }).click();
  await expect(page.getByRole("searchbox", { name: "Найти пациента" })).toHaveValue("Анна");
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
});

test("пациент: один чат, навигация сохраняет черновик, сбой не теряет ввод",async({page})=>{
  await page.setViewportSize({width:390,height:844});await loginUi(page,/Кабинет пациента/);await expect(page.getByRole("heading",{name:"Ваши назначения",exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:"Как вы себя чувствуете?",exact:true})).toHaveCount(0);
  const attempts:{requestKey:string}[]=[];await page.route("**/api/workspace",async route=>{if(route.request().method()==="POST"&&route.request().postDataJSON().action==="message"){attempts.push(route.request().postDataJSON());await route.abort("internetdisconnected");}else await route.continue();});
  await page.getByRole("navigation").getByRole("button",{name:"Чат с врачом"}).click();await expect(page).toHaveURL(/\/patient\?tab=messages$/);await expect(page.getByRole("heading",{name:"Чат с врачом",exact:true})).toBeFocused();const text=page.getByRole("textbox",{name:"Текст сообщения"});await text.fill("Черновик до обрыва связи");
  for(let i=0;i<2;i++){await page.getByRole("button",{name:"Отправить сообщение"}).click();await expect(page.getByRole("alert").filter({hasText:"Нет связи с сервером"})).toBeVisible();await expect(page.getByRole("button",{name:"Отправить сообщение"})).toBeEnabled();}expect(attempts[1].requestKey).toBe(attempts[0].requestKey);
  await text.fill("Исправленный черновик после ошибки");await page.getByRole("button",{name:"Отправить сообщение"}).click();await expect(page.getByRole("button",{name:"Отправить сообщение"})).toBeEnabled();expect(attempts[2].requestKey).not.toBe(attempts[0].requestKey);
  await page.goBack();await expect(page.getByRole("heading",{name:"Ваши назначения",exact:true})).toBeVisible();await page.getByRole("navigation").getByRole("button",{name:"Чат с врачом"}).click();await expect(text).toHaveValue("Исправленный черновик после ошибки");await page.unroute("**/api/workspace");await text.fill("");await page.reload();await expect(page.getByRole("heading",{name:"Чат с врачом",exact:true})).toBeVisible();
});

test("врач на телефоне: фильтр сообщений, вся строка пациента и защита панели во время отправки", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await loginUi(page, /Кабинет терапевта/);
  const filters = page.getByRole("group", { name: "Фильтр пациентов" });
  await filters.getByRole("button", { name: "Сообщения", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Новые сообщения" })).toBeVisible();
  await expect(filters.getByRole("button", { name: "Сообщения", exact: true })).toHaveAttribute("aria-pressed", "true");
  await filters.getByRole("button", { name: "Все пациенты" }).click();
  await page.getByRole("searchbox", { name: "Найти пациента" }).fill("Анна");
  await page.getByRole("row").filter({ hasText: "Анна Ковалёва" }).locator("td").nth(1).click({ position: { x: 3, y: 3 } });
  await expect(page.getByRole("heading", { name: "Анна Ковалёва", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^(Добавить запись|Редактировать заметку)$/ }).click();
  await page.getByRole("textbox", { name: "Что обсудить с пациентом" }).fill("Заметка при медленном соединении");
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/workspace", async route => {
    if (route.request().method() === "POST" && route.request().postDataJSON().action === "note") {
      await gate; await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Временный сбой. Повторите сохранение." }) });
    } else await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Сохранить запись" }).click();
    await expect(page.getByRole("button", { name: "Закрыть панель" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeVisible();
    release!();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Временный сбой");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.getByRole("button", { name: /^(Добавить запись|Редактировать заметку)$/ }).click();
    await expect(page.getByRole("textbox", { name: "Что обсудить с пациентом" })).toHaveValue("Заметка при медленном соединении");
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await page.getByRole("dialog").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  } finally { release?.(); }
});

test("сквозной сценарий: код → подтверждение → чат и просьба связаться", async ({ browser }) => {
  const doctorContext = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 }, locale: "ru-RU" });
  const patientContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 }, locale: "ru-RU" });
  const doctorPage = await doctorContext.newPage(); const patientPage = await patientContext.newPage();
  const unique = randomUUID().slice(0, 8); const name = `Учебный Пациент ${unique}`; const email = `test-link-${unique}@synthetic.kontur.demo`;
  let patientId: string | undefined; let userId: string | undefined;
  try {
    await loginUi(doctorPage, /Кабинет терапевта/);
    await doctorPage.getByRole("button", { name: "Добавить пациента" }).click();
    await doctorPage.getByRole("textbox", { name: "Имя и фамилия" }).fill(name);
    await doctorPage.getByLabel("Дата рождения", { exact: true }).fill("1992-05-17");
    await doctorPage.getByRole("button", { name: "Создать карточку" }).click();
    await expect(doctorPage.getByRole("heading", { name, exact: true })).toBeVisible();
    patientId = new URL(doctorPage.url()).searchParams.get("patient")!;
    await doctorPage.getByRole("button", { name: "Подключить пациента", exact: true }).click();
    await expect(doctorPage.locator(".invite-code")).toBeVisible();
    const code = (await doctorPage.locator(".invite-code").innerText()).replace(/\s/g, "");
    await doctorPage.getByRole("button", { name: "Закрыть панель" }).click();
    await patientPage.goto("/register"); await patientPage.waitForLoadState("networkidle");
    await expect(patientPage.getByRole("textbox", { name: "Имя и фамилия" })).toHaveCount(0);
    await patientPage.getByRole("textbox", { name: "Электронная почта" }).fill(email);
    await patientPage.getByLabel("Пароль", { exact: true }).fill(randomUUID());
    await expect(patientPage.getByRole("checkbox")).toHaveCount(0);
    expect(await patientPage.locator("form").evaluate(form => Array.from((form as HTMLFormElement).elements).filter(element => element instanceof HTMLInputElement && !element.validity.valid).map(element => ({ name: (element as HTMLInputElement).name, issue: (element as HTMLInputElement).validationMessage })))).toEqual([]);
    const registered = patientPage.waitForResponse(response => response.url().endsWith("/api/auth/sign-up/email") && response.request().method() === "POST", { timeout: 10000 });
    await patientPage.getByRole("button", { name: "Создать аккаунт", exact: true }).click();
    expect((await registered).status()).toBe(200);
    await patientPage.waitForURL("**/connect");
    await patientPage.getByRole("textbox", { name: "Код приглашения" }).fill(code);
    await patientPage.getByRole("button", { name: "Запросить подключение" }).click();
    await expect(patientPage.getByRole("heading", { name: "Запрос отправлен" })).toBeVisible();
    const before = await workspace(patientContext.request); userId = before.actor.id;
    expect(before.patients).toHaveLength(0);
    await doctorPage.getByRole("button", { name: "К списку пациентов" }).click();
    const requestRow = doctorPage.locator(".request-row").filter({ hasText: email });
    await expect(requestRow).toBeVisible();
    await requestRow.getByRole("button", { name: "Подтвердить", exact: true }).click();
    await expect(requestRow).not.toBeVisible();
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).name).toBe(name);
    await patientPage.getByRole("link", { name: "Перейти в кабинет" }).click();
    await expect(patientPage.getByRole("heading", { name: "Ваши назначения",exact:true })).toBeVisible();
    await patientPage.getByRole("navigation").getByRole("button",{name:"Чат с врачом"}).click();
    await patientPage.getByRole("checkbox",{name:"Попросить врача связаться со мной при отправке сообщения"}).check();
    await patientPage.getByRole("textbox", { name: "Текст сообщения" }).fill("Тестовый вопрос врачу");
    await patientPage.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(patientPage.locator(".message-bubble").filter({ hasText: "Тестовый вопрос врачу" })).toBeVisible();
    const detail = await doctorContext.request.get(`/api/patients/${patientId}`); expect(detail.status()).toBe(200);
    const linked = (await detail.json()).patient;
    expect(linked.observations).toHaveLength(1);
    expect(linked.messages[0].text).toBe("Тестовый вопрос врачу");
    const key = randomUUID();
    const payload = { action: "observation", patientId, score: 3, note: "Повтор запроса", needsContact: false, requestKey: key };
    const [first, repeat] = await Promise.all([patientContext.request.post("/api/workspace", { data: payload, headers: { Origin: origin } }), patientContext.request.post("/api/workspace", { data: payload, headers: { Origin: origin } })]);
    expect(first.status()).toBe(200); expect(repeat.status()).toBe(200);
    expect(await db.observation.count({ where: { requestKey: key } })).toBe(1);
    expect((await patientContext.request.post("/api/workspace", { data: { action: "request-link", secret: code }, headers: { Origin: origin } })).status()).toBe(409);
    expect(await patientPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    const account = userId ? { id: userId } : await db.user.findUnique({ where: { email }, select: { id: true } });
    if (account) await db.linkRequest.deleteMany({ where: { userId: account.id } });
    if (patientId) await db.patient.delete({ where: { id: patientId } });
    if (account) await db.user.delete({ where: { id: account.id } });
    await doctorContext.close(); await patientContext.close();
  }
});
