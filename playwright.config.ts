import "dotenv/config";
import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const localBrowser = "C:/Users/nefon/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90000,
  expect: { timeout: 12000 },
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    locale: "ru-RU",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(localBrowser) ? localBrowser : undefined) },
    trace: "retain-on-failure"
  },
  reporter: "list"
});
