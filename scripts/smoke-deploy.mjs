import { readFile } from "node:fs/promises";
import { parse } from "dotenv";
import { request } from "@playwright/test";

const settings = parse(await readFile(new URL("../.local/deploy/.env", import.meta.url), "utf8"));
const origin = settings.APP_ORIGIN;
if (settings.DEMO_MODE !== "true" || !settings.DEMO_PASSWORD || !origin) throw new Error("This check requires the separate synthetic deployment configuration.");
const client = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin }, timeout: 10000 });
const demand = (condition, message) => { if (!condition) throw new Error(message); };
try {
  const ready = await client.get("/api/ready"); demand(ready.status() === 200 && (await ready.json()).status === "ok", "Deployment is not ready.");
  const closed = await client.get("/api/patients"); demand(closed.status() === 401, "Patient list must require a session.");
  const loginPage = await client.get("/login"); demand(loginPage.status() === 200, "Login page unavailable.");
  const script = (await loginPage.text()).match(/<script[^>]+src="([^"]+)"/);
  demand(!!script, "Standalone page has no script reference.");
  const asset = await client.get(script[1].replaceAll("&amp;", "&"));
  demand(asset.status() === 200 && /javascript/.test(asset.headers()["content-type"] ?? ""), "Standalone static assets unavailable.");
  const login = await client.post("/api/auth/sign-in/email", { data: { email: "doctor@kontur.demo", password: settings.DEMO_PASSWORD } });
  demand(login.status() === 200, "Synthetic account login failed; explicitly run the deployment seed first.");
  const patients = await client.get("/api/patients?filter=all");
  demand(patients.status() === 200, "Authenticated directory unavailable.");
  const body = await patients.json(); demand(body.actor?.role === "DOCTOR" && Array.isArray(body.patients) && body.patients.length > 0, "Synthetic doctor directory is empty.");
  const hostile = await client.post("/api/workspace", { headers: { Origin: "https://untrusted.invalid" }, data: { action: "message", patientId: "not-a-patient", text: "synthetic" } });
  demand(hostile.status() === 403, "Cross-origin mutation was not rejected.");
  await client.post("/api/auth/sign-out", { data: {} });
  console.info("Deployment smoke passed: worker/DB readiness, private access, static assets, session login, directory, origin guard.");
} finally { await client.dispose(); }
