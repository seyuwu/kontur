import "dotenv/config";
import { test, expect, request } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { authPost } from "./auth-request";

test("Фильтры списка сохраняют положение при открытии событий внимания", async ({ browser }) => {
  const api = await request.newContext({ baseURL: "http://localhost:3000", extraHTTPHeaders: { Origin: "http://localhost:3000" } });
  expect((await authPost(api, "/api/auth/sign-in/email", { email: "doctor@kontur.demo", password: process.env.DEMO_PASSWORD })).status()).toBe(200);
  const context = await browser.newContext({ storageState: await api.storageState() }); const page = await context.newPage();
  try {
    await page.goto("/doctor");
    const toolbar = page.locator(".list-toolbar");
    for (const width of [1575, 390, 320]) {
      await page.setViewportSize({ width, height: 930 }); await page.evaluate(() => scrollTo(0, 0));
      await toolbar.getByRole("button", { name: "Все пациенты", exact: true }).click();
      const before = await toolbar.boundingBox();
      await toolbar.getByRole("button", { name: "Внимание", exact: true }).click();
      await expect(page).toHaveURL(/filter=attention/);
      await expect(page.getByRole("heading", { name: "Результаты анкет", exact: true })).toBeVisible();
      const after = await toolbar.boundingBox();
      expect(Math.abs(after!.y - before!.y)).toBeLessThan(1); expect(Math.abs(after!.x - before!.x)).toBeLessThan(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.impeccable/review/attention-toolbar-${width}.png`, fullPage: true, animations: "disabled" });
      await toolbar.getByRole("button", { name: "Подключение", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Результаты анкет", exact: true })).toHaveCount(0);
      const pending = await toolbar.boundingBox(); expect(Math.abs(pending!.y - before!.y)).toBeLessThan(1);
    }
    expect((await new AxeBuilder({ page }).analyze()).violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  } finally { await context.close(); await api.dispose(); }
});
