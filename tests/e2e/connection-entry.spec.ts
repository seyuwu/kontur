import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, request, test } from "@playwright/test";
import jsQR from "jsqr";
import { db } from "../../src/server/db";
import { authPost } from "./auth-request";

const origin = "http://localhost:3000";

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
      const createdDoctor = await authPost(doctorApi, "/api/auth/sign-up/email", { name: "Врач для проверки подключения", email: `doctor-invite-${randomUUID()}@synthetic.kontur.demo`, password: randomUUID(), accountType: "DOCTOR", syntheticData: true });
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
          const registered = await authPost(patientApi, "/api/auth/sign-up/email", { name: "Пациент для проверки подключения", email: patientEmail, password, accountType: "PATIENT", syntheticData: true });
          expect(registered.status()).toBe(200); userIds.push((await registered.json()).user.id);
        } finally { await patientApi.dispose(); }
      }

      const patientPage = await patientContext.newPage();
      if (method === "code-registration") {
        await patientPage.goto(`${origin}/register`);
        await patientPage.getByLabel(/Код от врача/).fill(invitation.code);
      } else if (method === "code-before-registration") {
        await patientPage.goto(`${origin}/login`);
        await patientPage.getByRole("link", { name: "У меня есть код от врача", exact: true }).click();
        await patientPage.getByLabel("Код приглашения").fill(invitation.code);
        await patientPage.getByRole("link", { name: "Создать аккаунт", exact: true }).click();
      } else {
        await patientPage.goto(decoded!.data);
        await expect(patientPage.getByLabel("Приглашение из QR-кода")).toHaveValue(/^[a-f0-9]{64}$/);
        await expect(patientPage).toHaveURL(/\/connect$/);
        await patientPage.getByRole("link", { name: method === "qr-login" ? "Войти в аккаунт" : "Создать аккаунт", exact: true }).click();
      }
      if (method === "qr-login") {
        await patientPage.getByLabel("Электронная почта", { exact: true }).fill(patientEmail);
        await patientPage.getByLabel("Пароль", { exact: true }).fill(password);
        await patientPage.getByRole("button", { name: "Войти", exact: true }).click();
      } else {
        await patientPage.getByLabel("Имя и фамилия", { exact: true }).fill("Пациент для проверки подключения");
        await patientPage.getByLabel("Электронная почта", { exact: true }).fill(patientEmail);
        await patientPage.getByLabel("Пароль", { exact: true }).fill(password);
        await patientPage.getByRole("checkbox").check();
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
      await doctorPage.getByRole("button", { name: "Закрыть панель", exact: true }).click();
      await doctorPage.getByRole("button", { name: "К списку пациентов", exact: true }).click();
      const row = doctorPage.locator(".request-row").filter({ hasText: patientEmail });
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "Подтвердить", exact: true }).click();
      await expect(row).not.toBeVisible();
      await patientPage.getByRole("link", { name: "Перейти в кабинет", exact: true }).click();
      await expect(patientPage.getByRole("heading", { name: "Ваши назначения", exact: true })).toBeVisible();
      expect((await db.patient.findUniqueOrThrow({ where: { id: patientId } })).userId).toBe(userIds.at(-1));
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
