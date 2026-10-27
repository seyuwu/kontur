import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const phase = process.argv[2] ?? "after";
const directory = `.impeccable/review/ux-${phase}`;
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? "C:/Users/nefon/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe" });
const results = []; const errors = [];
async function inspect(page, name, screenshot = false) {
  await page.waitForLoadState("networkidle");
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  const layout = await page.evaluate(() => {
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
    const scope = document.querySelector("dialog[open]") ?? document;
    return {
      width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      overflow: [...document.querySelectorAll("main *, dialog[open] *")].filter(visible).filter(el => el.getBoundingClientRect().right > innerWidth + 2).slice(0, 8).map(el => ({ tag: el.tagName, class: el.className?.baseVal ?? el.className })),
      smallTargets: [...scope.querySelectorAll("button, a, input:not([type=hidden]), textarea")].filter(visible).filter(el => !el.disabled && !el.closest("[inert]")).map(el => { const target = el.matches('input[type="checkbox"]') ? el.closest("label") ?? el : el; const r = target.getBoundingClientRect(); return { label: el.getAttribute("aria-label") ?? target.textContent.trim().slice(0, 60), width: Math.round(r.width), height: Math.round(r.height) }; }).filter(r => r.width < 44 || r.height < 44),
      fontLoaded: document.fonts.check('400 14px "Manrope"')
    };
  });
  const result = { name, ...layout, violations: axe.violations.map(v => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), incomplete: axe.incomplete.map(v => ({ id: v.id, nodes: v.nodes.length })) };
  results.push(result);
  if (screenshot) await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true });
  console.log(name, JSON.stringify({ width: layout.width, overflow: layout.overflow.length, violations: result.violations.map(v => ({ id: v.id, nodes: v.nodes.length })), smallTargets: layout.smallTargets.length }));
}
async function login(page, name) {
  await page.goto("http://localhost:3000/login"); await page.waitForLoadState("networkidle");
  for (let attempt = 0; attempt < 2; attempt++) {
    const [response] = await Promise.all([page.waitForResponse(r => r.url().endsWith("/api/auth/sign-in/email") && r.request().method() === "POST"), page.getByRole("button", { name }).click()]);
    if (response.status() === 200) break;
    if (response.status() !== 429 || attempt === 1) throw new Error(`Login status: ${response.status()}`);
    const seconds = Number(response.headers()["x-retry-after"]);
    if (!(seconds > 0 && seconds <= 60)) throw new Error("Invalid login Retry-After");
    await new Promise(resolve => setTimeout(resolve, seconds * 1000 + 100));
  }
  await page.waitForURL(/\/(doctor|patient)$/); await page.waitForLoadState("networkidle");
}
try {
  if (phase === "confirm") {
    const context = await browser.newContext({ viewport: { width: 320, height: 844 }, locale: "ru-RU", reducedMotion: "reduce" });
    const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
    await login(page, /Кабинет пациента/);
    await inspect(page, "patient-today-320", true);
    await page.getByRole("button", { name: "4 Хорошо", exact: true }).click(); await inspect(page, "patient-form-320");
    await page.getByRole("navigation").getByRole("button", { name: "Динамика", exact: true }).click(); await inspect(page, "patient-dynamics-320", true);
    const labelHeight = await page.locator(".chart-label").first().evaluate(el => parseFloat(getComputedStyle(el).fontSize) * el.getScreenCTM().d);
    if (labelHeight < 11.5) throw new Error(`Chart labels too small: ${labelHeight}px`);
    console.log("Chart label rendered pixels:", labelHeight);
    const doctor = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", reducedMotion: "reduce" });
    const doc = await doctor.newPage(); doc.on("pageerror", e => errors.push(e.message)); await login(doc, /Кабинет терапевта/);
    await doc.goto("http://localhost:3000/doctor?patient=patient-anna&tab=messages"); await inspect(doc, "doctor-messages-1440");
    await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole("navigation").getByRole("button", { name: "Сегодня", exact: true }).click(); await inspect(page, "patient-today-390", true);
  } else {
  const doctor = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", reducedMotion: "reduce" });
  const page = await doctor.newPage(); page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://localhost:3000/login"); await inspect(page, "login-desktop");
  await page.setViewportSize({ width: 320, height: 780 }); await inspect(page, "login-320");
  await page.goto("http://localhost:3000/register"); await inspect(page, "register-320");
  await page.goto("http://localhost:3000/connect"); await inspect(page, "connect-320");
  await page.setViewportSize({ width: 1440, height: 1000 }); await login(page, /Кабинет терапевта/);
  await inspect(page, "doctor-list-1440", true);
  for (const width of [768, 390, 320]) { await page.setViewportSize({ width, height: 844 }); await inspect(page, `doctor-list-${width}`, width === 390); }
  await page.getByRole("searchbox", { name: "Найти пациента" }).fill("НичегоТакогоНеСуществует"); await inspect(page, "doctor-empty-320");
  await page.getByRole("searchbox", { name: "Найти пациента" }).fill("Анна"); await page.getByRole("button", { name: /Анна Ковалёва/ }).first().click();
  await inspect(page, "doctor-card-320", true);
  await page.getByRole("button", { name: "Добавить запись" }).click(); await inspect(page, "doctor-note-320"); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Открыть самоотчёт" }).first().click(); await inspect(page, "doctor-source-320"); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Помощь", exact: true }).click(); await inspect(page, "doctor-help-320"); await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Данные", exact: true }).click(); await inspect(page, "doctor-data-320");
  await page.getByRole("tab", { name: "Динамика", exact: true }).click(); await inspect(page, "doctor-dynamics-320");
  await page.getByRole("tab", { name: /Общение/ }).click(); await inspect(page, "doctor-messages-320");
  await page.setViewportSize({ width: 1440, height: 1000 }); await inspect(page, "doctor-messages-1440");
  await page.getByRole("button", { name: "К списку пациентов" }).click(); await page.getByRole("button", { name: "Добавить пациента" }).click(); await inspect(page, "doctor-new-1440"); await page.keyboard.press("Escape");
  const patient = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", reducedMotion: "reduce" });
  const mobile = await patient.newPage(); mobile.on("pageerror", e => errors.push(e.message)); await login(mobile, /Кабинет пациента/);
  await inspect(mobile, "patient-today-1440", true);
  for (const width of [768, 390, 320]) { await mobile.setViewportSize({ width, height: 844 }); await inspect(mobile, `patient-today-${width}`, width === 390); }
  await mobile.getByRole("button", { name: "4 Хорошо", exact: true }).click(); await inspect(mobile, "patient-form-320", true);
  await mobile.getByRole("navigation").getByRole("button", { name: "Динамика", exact: true }).click(); await inspect(mobile, "patient-dynamics-320");
  await mobile.getByRole("navigation").getByRole("button", { name: "Связь с врачом" }).click(); await inspect(mobile, "patient-messages-320", true);
  }
} finally {
  writeFileSync(`${directory}/results.json`, JSON.stringify({ checkedAt: new Date().toISOString(), results, errors }, null, 2));
  await browser.close();
}
