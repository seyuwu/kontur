import webpush from "web-push";
import { appendFile } from "node:fs/promises";
if (process.env.CI !== "true" || !process.env.GITHUB_ENV) throw new Error("This helper is only for the isolated GitHub CI job.");
const keys = webpush.generateVAPIDKeys();
await appendFile(process.env.GITHUB_ENV, Object.entries({ WEB_PUSH_ENABLED: "true", ALLOW_DEMO_WEB_PUSH: "true", WEB_PUSH_SUBJECT: "mailto:push@synthetic.kontur.demo", WEB_PUSH_PUBLIC_KEY: keys.publicKey, WEB_PUSH_PRIVATE_KEY: keys.privateKey }).map(([key, value]) => `${key}=${value}\n`).join(""));
