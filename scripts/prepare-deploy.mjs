import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function deploymentValues(address) {
  const origin = new URL(address);
  if (origin.origin !== address || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Use a root origin without a path, credentials, or trailing slash.");
  if (origin.protocol !== "https:" && !(origin.protocol === "http:" && origin.hostname === "localhost" && origin.port === "3080")) throw new Error("Use HTTPS, or http://localhost:3080 for the local check.");
  if (origin.protocol === "https:" && origin.port) throw new Error("This HTTPS profile uses standard port 443.");
  const password = randomBytes(32).toString("hex");
  return {
    COMPOSE_PROJECT_NAME: "kontur-demo", DEPLOY_BIND: "127.0.0.1", SITE_ADDRESS: origin.hostname,
    POSTGRES_PASSWORD: password, DATABASE_URL: `postgresql://kontur:${password}@postgres:5432/kontur`,
    BETTER_AUTH_SECRET: randomBytes(48).toString("hex"), APP_ORIGIN: address, BETTER_AUTH_URL: address,
    DEMO_MODE: "true", DEMO_PASSWORD: randomBytes(24).toString("base64url"),
    DOCUMENT_EXTRACTION_ENABLED: "false", OPENAI_API_KEY: "", OPENAI_EXTRACTION_MODEL: "",
    WEB_PUSH_ENABLED: "false", ALLOW_DEMO_WEB_PUSH: "false", WEB_PUSH_PUBLIC_KEY: "", WEB_PUSH_PRIVATE_KEY: "", WEB_PUSH_SUBJECT: "",
    ALERT_EMAIL_ENABLED: "false", ALLOW_DEMO_ALERT_EMAIL: "false", SMTP_HOST: "", SMTP_PORT: "587", SMTP_USER: "", SMTP_PASSWORD: "", SMTP_FROM: ""
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const values = deploymentValues(process.argv[2] ?? "http://localhost:3080");
  const directory = new URL("../.local/deploy/", import.meta.url);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try { await writeFile(new URL(".env", directory), Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""), { flag: "wx", mode: 0o600 }); }
  catch (e) { if (e.code === "EEXIST") throw new Error(".local/deploy/.env already exists; it was not changed."); throw e; }
  console.info("Created .local/deploy/.env with independent secrets. Values are not printed. No services started.");
}
