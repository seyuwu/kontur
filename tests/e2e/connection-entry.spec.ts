import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, request, test } from "@playwright/test";
import jsQR from "jsqr";
import { db } from "../../src/server/db";
import { authPost } from "./auth-request";

const origin = "http://localhost:3000";

for (const method of ["code", "qr"] as const) test(`a doctor ${method} opens a pending patient account without email or password`, async ({ page, browser }) => {
  const api = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
  const openDoctor = await browser.newContext();
  const doctorPage = await openDoctor.newPage();
  let doctorId = "", patientId = "";
  const userIds: string[] = [];
  try {
    const doctor = await authPost(api, "/api/auth/sign-up/email", { name: "Врач входа по коду", email: `code-entry-${randomUUID()}@synthetic.kontur.demo`, password: randomUUID(), accountType: "DOCTOR" });
    expect(doctor.status()).toBe(200); doctorId = (await doctor.json()).user.id;
    const card = await api.post("/api/workspace", { data: { action: "create-patient", name: "Пациент входа по коду", birthDate: "1990-01-01" } });
    expect(card.status()).toBe(200); patientId = (await card.json()).id;
    await openDoctor.addCookies((await api.storageState()).cookies);
    await doctorPage.goto(`/doctor?patient=${patientId}`);
    const invited = doctorPage.waitForResponse(r => r.url().endsWith("/api/workspace") && r.request().postDataJSON()?.action === "invite");
    await doctorPage.getByRole("button", { name: "Подключить пациента", exact: true }).click();
    const response = await invited; expect(response.status()).toBe(200); const { code, url } = await response.json();
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message)); doctorPage.on("pageerror", error => errors.push(error.message));
    if (method === "code") {
      await page.goto("/login");
      await page.getByRole("link", { name: "У меня есть код от врача", exact: true }).click();
      await page.getByLabel("Код приглашения").fill("000000");
      await page.getByRole("button", { name: "Войти по коду", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Код неверный" })).toBeVisible();
      expect((await page.request.get("/api/workspace")).status()).toBe(401);
      await page.getByLabel("Код приглашения").fill(`${code.slice(0, 3)} ${code.slice(3)}`);
      await page.getByLabel("Код приглашения").press("Enter");
    } else {
      await page.goto(url);
      await page.getByRole("button", { name: "Войти по коду", exact: true }).click();
    }
    await expect(page).toHaveURL(/\/patient(?:\?|$)/, { timeout: 5000 });
    await expect(page.getByRole("heading", { name: "Врач проверяет подключение" })).toBeVisible();
    const workspace = await (await page.request.get("/api/workspace")).json();
    userIds.push(workspace.actor.id);
    expect(workspace.actor.role).toBe("PATIENT");
    expect(workspace.actor.name).toBe("Пациент");
    await expect(page.getByText(/Проверочный номер:/)).toContainText(workspace.actor.id.slice(-6).toUpperCase());
    expect(workspace.patients).toEqual([]);
    expect((await page.request.get(`/api/patients/${patientId}`)).status()).toBe(404);
    expect((await db.patient.findUniqueOrThrow({ where: { id: patientId } })).userId).toBeNull();
    if (method === "code") {
      const other = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
      try {
        expect((await authPost(other, "/api/auth/sign-in/invitation", { secret: code })).status()).toBe(400);
        expect((await other.get("/api/workspace")).status()).toBe(401);
        expect(await db.linkRequest.count({ where: { invitation: { patientId } } })).toBe(1);
      } finally { await other.dispose(); }
    }
    const incoming = (await (await api.get("/api/patients")).json()).linkRequests;
    expect(incoming.some((item: { user: { email: string } }) => item.user.email === workspace.actor.email)).toBe(true);
    await doctorPage.bringToFront();
    const drawerRow = doctorPage.getByRole("dialog").locator(".request-row").filter({ hasText: workspace.actor.id.slice(-6).toUpperCase() });
    await expect(drawerRow).toContainText("Пациент входа по коду");
    for (const width of [1440, 390, 320]) {
      await doctorPage.setViewportSize({ width, height: 900 });
      expect(await doctorPage.getByRole("dialog").evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
      await expect(drawerRow.getByRole("button", { name: "Подтвердить", exact: true })).toBeEnabled();
    }
    await doctorPage.screenshot({ path: `.impeccable/review/connection-request-${method}.png`, fullPage: true });
    if (method === "qr") await doctorPage.getByRole("button", { name: "Закрыть панель", exact: true }).click();
    const row = method === "qr" ? doctorPage.getByRole("main").locator(".request-row").filter({ hasText: workspace.actor.id.slice(-6).toUpperCase() }) : drawerRow;
    await expect(row).toContainText("Пациент входа по коду");
    await row.getByRole("button", { name: "Подтвердить", exact: true }).click();
    await expect(row).not.toBeVisible();
    await page.bringToFront();
    await expect(page.getByRole("heading", { name: "Ваши назначения", exact: true })).toBeVisible();
    expect((await db.patient.findUniqueOrThrow({ where: { id: patientId } })).userId).toBe(workspace.actor.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: workspace.actor.id } })).name).toBe("Пациент входа по коду");
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.getByRole("button", { name: "Выйти из аккаунта", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    const reused = await authPost(page.request, "/api/auth/sign-in/invitation", { secret: code }, { Origin: origin });
    expect(reused.status()).toBe(400);
    expect((await page.request.get("/api/workspace")).status()).toBe(401);
    const doctorContext = await browser.newContext();
    let loginCode = "", loginUrl = "";
    try {
      await doctorContext.addCookies((await api.storageState()).cookies);
      const doctorPage = await doctorContext.newPage();
      await doctorPage.goto(`/doctor?patient=${patientId}`);
      const loginInvitation = doctorPage.waitForResponse(r => r.url().endsWith("/api/workspace") && r.request().postDataJSON()?.action === "invite");
      await doctorPage.getByRole("button", { name: "Выдать код входа", exact: true }).click();
      const response = await loginInvitation; expect(response.status()).toBe(200);
      const invitation = await response.json(); loginCode = invitation.code; loginUrl = invitation.url;
      expect(new Date(invitation.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);
      await expect(doctorPage.getByText(/Проверьте личность пациента перед передачей/)).toBeVisible();
    } finally { await doctorContext.close(); }
    if (method === "code") {
      await page.getByRole("link", { name: "У меня есть код от врача", exact: true }).click();
      await page.getByLabel("Код приглашения").fill(loginCode);
    } else await page.goto(loginUrl);
    await page.getByRole("button", { name: "Войти по коду", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Ваши назначения", exact: true })).toBeVisible();
    const returned = await (await page.request.get("/api/workspace")).json();
    expect(returned.actor.id).toBe(workspace.actor.id);
    expect(returned.patients[0].id).toBe(patientId);
    expect(await db.linkRequest.count({ where: { invitation: { patientId } } })).toBe(1);
    await page.getByRole("button", { name: "Выйти из аккаунта", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    expect((await authPost(page.request, "/api/auth/sign-in/invitation", { secret: loginCode }, { Origin: origin })).status()).toBe(400);
    expect((await page.request.get("/api/workspace")).status()).toBe(401);
    expect(errors).toEqual([]);
  } finally {
    await openDoctor.close();
    if (patientId) {
      const requests = await db.linkRequest.findMany({ where: { invitation: { patientId } }, select: { userId: true } });
      userIds.push(...requests.map(r => r.userId));
      await db.linkRequest.deleteMany({ where: { invitation: { patientId } } });
      await db.patient.deleteMany({ where: { id: patientId } });
    }
    if (doctorId) userIds.push(doctorId);
    if (userIds.length) { await db.auditEvent.deleteMany({ where: { actorId: { in: userIds } } }); await db.user.deleteMany({ where: { id: { in: userIds } } }); }
    await api.dispose();
  }
});

test("invitation sign-in rejects expired or revoked codes, foreign origins and existing sessions", async () => {
  const doctor = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
  const guest = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
  let doctorId = "", patientId = "";
  try {
    const signup = await authPost(doctor, "/api/auth/sign-up/email", { name: "Врач проверки кода", email: `code-security-${randomUUID()}@synthetic.kontur.demo`, password: randomUUID(), accountType: "DOCTOR" });
    expect(signup.status()).toBe(200); doctorId = (await signup.json()).user.id;
    const card = await doctor.post("/api/workspace", { data: { action: "create-patient", name: "Пациент проверки кода", birthDate: "1990-01-01" } });
    expect(card.status()).toBe(200); patientId = (await card.json()).id;
    const first = await doctor.post("/api/workspace", { data: { action: "invite", patientId } });
    expect(first.status()).toBe(200); const { code } = await first.json();
    expect((await authPost(guest, "/api/auth/sign-in/invitation", { secret: code }, { Origin: "https://foreign.invalid" })).status()).toBe(403);
    expect((await authPost(doctor, "/api/auth/sign-in/invitation", { secret: code })).status()).toBe(409);
    expect(await db.linkRequest.count({ where: { invitation: { patientId } } })).toBe(0);
    await db.invitation.updateMany({ where: { patientId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await authPost(guest, "/api/auth/sign-in/invitation", { secret: code })).status()).toBe(400);
    const fresh = await doctor.post("/api/workspace", { data: { action: "invite", patientId } });
    expect(fresh.status()).toBe(200); const next = await fresh.json();
    expect((await doctor.post("/api/workspace", { data: { action: "revoke-invite", patientId } })).status()).toBe(200);
    expect((await authPost(guest, "/api/auth/sign-in/invitation", { secret: next.code })).status()).toBe(400);
    expect((await guest.get("/api/workspace")).status()).toBe(401);
    expect(await db.linkRequest.count({ where: { invitation: { patientId } } })).toBe(0);
  } finally {
    if (patientId) await db.patient.deleteMany({ where: { id: patientId } });
    if (doctorId) { await db.auditEvent.deleteMany({ where: { actorId: doctorId } }); await db.user.deleteMany({ where: { id: doctorId } }); }
    await doctor.dispose(); await guest.dispose();
  }
});

test("a doctor can reject a live request from the patient card without exposing data", async ({ browser }) => {
  const doctor = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
  const patient = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
  const context = await browser.newContext();
  const ids: string[] = []; let patientId = "";
  try {
    for (const [client, accountType] of [[doctor, "DOCTOR"], [patient, "PATIENT"]] as const) {
      const signup = await authPost(client, "/api/auth/sign-up/email", { name: "Проверка отклонения", email: `reject-${randomUUID()}@synthetic.kontur.demo`, password: randomUUID(), accountType });
      expect(signup.status()).toBe(200); ids.push((await signup.json()).user.id);
    }
    const card = await doctor.post("/api/workspace", { data: { action: "create-patient", name: "Карточка отклонения", birthDate: "1990-01-01" } });
    expect(card.status()).toBe(200); patientId = (await card.json()).id;
    await context.addCookies((await doctor.storageState()).cookies);
    const page = await context.newPage(); await page.goto(`/doctor?patient=${patientId}`);
    const invitation = await doctor.post("/api/workspace", { data: { action: "invite", patientId } }); expect(invitation.status()).toBe(200);
    expect((await patient.post("/api/workspace", { data: { action: "request-link", secret: (await invitation.json()).code } })).status()).toBe(200);
    const row = page.getByRole("main").locator(".request-row");
    await expect(row).toContainText("Проверка отклонения");
    await row.getByRole("button", { name: "Отклонить", exact: true }).click();
    await expect(row).not.toBeVisible();
    expect((await db.linkRequest.findFirstOrThrow({ where: { userId: ids[1] } })).status).toBe("REJECTED");
    expect((await db.patient.findUniqueOrThrow({ where: { id: patientId } })).userId).toBeNull();
    const workspace = await (await patient.get("/api/workspace")).json(); expect(workspace.patients).toEqual([]); expect(workspace.pendingLink).toBe(false);
    expect((await patient.get(`/api/patients/${patientId}`)).status()).toBe(404);
  } finally {
    await context.close();
    if (ids.length) await db.linkRequest.deleteMany({ where: { userId: { in: ids } } });
    if (patientId) await db.patient.deleteMany({ where: { id: patientId } });
    if (ids.length) { await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } }); await db.user.deleteMany({ where: { id: { in: ids } } }); }
    await doctor.dispose(); await patient.dispose();
  }
});

test("new patients can enter a doctor's invitation code during registration", async ({ page }) => {
  await page.goto("/register");
  await page.getByRole("radio", { name: "Пациент", exact: true }).check();
  await expect(page.getByRole("textbox", { name: /Код.*врача/ })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("button", { name: "Создать аккаунт", exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".impeccable/review/patient-registration-code.png", fullPage: true });
});

for (const method of ["code-registration", "code-before-registration", "qr-registration", "qr-login"] as const) {
  test(`doctor invitation connects the correct patient using ${method}`, async ({ browser }) => {
    const doctorApi = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
    const userIds: string[] = [];
    let patientId = "";
    const patientEmail = `patient-invite-${randomUUID()}@synthetic.kontur.demo`;
    const password = randomUUID();
    const doctorContext = await browser.newContext();
    const patientContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const createdDoctor = await authPost(doctorApi, "/api/auth/sign-up/email", { name: "Врач для проверки подключения", email: `doctor-invite-${randomUUID()}@synthetic.kontur.demo`, password: randomUUID(), accountType: "DOCTOR" });
      expect(createdDoctor.status()).toBe(200);
      const doctorId = (await createdDoctor.json()).user.id;
      userIds.push(doctorId);
      const card = await doctorApi.post("/api/workspace", { data: { action: "create-patient", name: "Пациент для проверки подключения", birthDate: "1990-01-01" } });
      expect(card.status()).toBe(200);
      patientId = (await card.json()).id;
      await doctorContext.addCookies((await doctorApi.storageState()).cookies);
      const doctorPage = await doctorContext.newPage();
      await doctorPage.goto(`${origin}/doctor?patient=${patientId}`);
      const invited = doctorPage.waitForResponse(r => r.url().endsWith("/api/workspace") && r.request().method() === "POST" && r.request().postDataJSON()?.action === "invite");
      await doctorPage.getByRole("button", { name: "Подключить пациента", exact: true }).click();
      const invitationResponse = await invited;
      expect(invitationResponse.status()).toBe(200);
      const invitation = await invitationResponse.json() as { code: string; url: string };
      expect(invitation.code).toMatch(/^\d{6}$/);
      const qr = doctorPage.locator(".qr-box svg");
      await expect(qr).toBeVisible();
      const pixels = await qr.evaluate(async svg => {
        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
        await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 512;
        const context = canvas.getContext("2d")!; context.fillStyle = "white"; context.fillRect(0, 0, 512, 512); context.imageSmoothingEnabled = false; context.drawImage(image, 0, 0, 512, 512);
        return Array.from(context.getImageData(0, 0, 512, 512).data);
      });
      const decoded = jsQR(Uint8ClampedArray.from(pixels), 512, 512);
      expect(decoded?.data === invitation.url).toBe(true);

      if (method === "qr-login") {
        const patientApi = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
        try {
          const registered = await authPost(patientApi, "/api/auth/sign-up/email", { name: "Имя существующего аккаунта", email: patientEmail, password, accountType: "PATIENT" });
          expect(registered.status()).toBe(200); userIds.push((await registered.json()).user.id);
        } finally { await patientApi.dispose(); }
      }

      const patientPage = await patientContext.newPage();
      if (method === "code-registration") {
        await patientPage.goto(`${origin}/register`);
        const codeField = patientPage.getByLabel(/Код от врача/);
        await expect(codeField).toBeEnabled();
        await codeField.evaluate((field, code) => {
          const clipboard = new DataTransfer(); clipboard.setData("text/plain", `${code.slice(0, 3)} ${code.slice(3)}`);
          field.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: clipboard }));
        }, invitation.code);
        await expect(codeField).toHaveValue(invitation.code);
      } else if (method === "code-before-registration") {
        await patientPage.goto(`${origin}/login`);
        await patientPage.getByRole("link", { name: "У меня есть код от врача", exact: true }).click();
        await patientPage.getByLabel("Код приглашения").fill(invitation.code);
        await patientPage.getByRole("link", { name: "Создать аккаунт", exact: true }).click();
      } else {
        await patientPage.goto(decoded!.data);
        await expect(patientPage.getByLabel("Приглашение из QR-кода")).toHaveValue(/^[a-f0-9]{64}$/);
        await expect(patientPage).toHaveURL(/\/connect$/);
        await patientPage.getByRole("link", { name: method === "qr-login" ? "Войти с почтой и паролем" : "Создать аккаунт", exact: true }).click();
      }
      if (method === "qr-login") {
        await patientPage.getByLabel("Электронная почта", { exact: true }).fill(patientEmail);
        await patientPage.getByLabel("Пароль", { exact: true }).fill(password);
        await patientPage.getByRole("button", { name: "Войти", exact: true }).click();
      } else {
        await expect(patientPage.getByLabel("Имя и фамилия", { exact: true })).toHaveCount(0);
        await patientPage.getByLabel("Электронная почта", { exact: true }).fill(patientEmail);
        await patientPage.getByLabel("Пароль", { exact: true }).fill(password);
        await expect(patientPage.getByRole("checkbox")).toHaveCount(0);
        const signedUp = patientPage.waitForResponse(r => r.url().endsWith("/api/auth/sign-up/email") && r.request().method() === "POST");
        await patientPage.getByRole("button", { name: "Создать аккаунт", exact: true }).click();
        expect((await signedUp).status()).toBe(200);
        userIds.push((await db.user.findUniqueOrThrow({ where: { email: patientEmail } })).id);
      }
      await expect(patientPage).toHaveURL(/\/connect$/, { timeout: 30000 });
      if (method.startsWith("code")) await expect(patientPage.getByLabel("Код приглашения")).toHaveValue(invitation.code);
      else await expect(patientPage.getByLabel("Приглашение из QR-кода")).toHaveValue(/^[a-f0-9]{64}$/);
      await patientPage.getByRole("button", { name: "Запросить подключение", exact: true }).click();
      await expect(patientPage.getByRole("heading", { name: "Запрос отправлен", exact: true })).toBeVisible();
      expect((await db.patient.findUniqueOrThrow({ where: { id: patientId } })).userId).toBeNull();
      if (method !== "qr-login") expect((await db.user.findUniqueOrThrow({ where: { email: patientEmail } })).name).toBe("Пациент");
      await doctorPage.getByRole("button", { name: "Закрыть панель", exact: true }).click();
      await doctorPage.getByRole("button", { name: "К списку пациентов", exact: true }).click();
      const row = doctorPage.locator(".request-row").filter({ hasText: patientEmail });
      await expect(row).toBeVisible();
      await expect(row).toContainText("Пациент для проверки подключения");
      await row.getByRole("button", { name: "Подтвердить", exact: true }).click();
      await expect(row).not.toBeVisible();
      await patientPage.getByRole("link", { name: "Перейти в кабинет", exact: true }).click();
      await expect(patientPage.getByRole("heading", { name: "Ваши назначения", exact: true })).toBeVisible();
      expect((await db.patient.findUniqueOrThrow({ where: { id: patientId } })).userId).toBe(userIds.at(-1));
      expect((await db.user.findUniqueOrThrow({ where: { email: patientEmail } })).name).toBe(method === "qr-login" ? "Имя существующего аккаунта" : "Пациент для проверки подключения");
      await patientPage.getByRole("link", { name: "Подключение к врачу", exact: true }).click();
      await expect(patientPage.getByRole("heading", { name: "Вы уже подключены к врачу", exact: true })).toBeVisible();
    } finally {
      await doctorContext.close(); await patientContext.close();
      if (userIds.length) await db.linkRequest.deleteMany({ where: { userId: { in: userIds } } });
      if (patientId) await db.patient.deleteMany({ where: { id: patientId } });
      if (userIds.length) { await db.auditEvent.deleteMany({ where: { actorId: { in: userIds } } }); await db.user.deleteMany({ where: { id: { in: userIds } } }); }
      await doctorApi.dispose();
    }
  });
}

test("an unlinked patient sees the invitation code field immediately after login", async ({ browser }) => {
  const api = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
  const email = `connection-${randomUUID()}@synthetic.kontur.demo`;
  const password = randomUUID();
  let userId = "";
  try {
    const signup = await authPost(api, "/api/auth/sign-up/email", { name: "Тестовый пациент", email, password });
    expect(signup.status()).toBe(200);
    userId = (await signup.json()).user.id;
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`${origin}/login`);
      await page.getByLabel("Электронная почта", { exact: true }).fill(email);
      await page.getByLabel("Пароль", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(page).toHaveURL(/\/connect$/, { timeout: 30000 });
      await expect(page.getByRole("textbox", { name: "Код приглашения" })).toBeVisible({ timeout: 5000 });
    } finally { await context.close(); }
  } finally {
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    await api.dispose();
    await db.$disconnect();
  }
});
