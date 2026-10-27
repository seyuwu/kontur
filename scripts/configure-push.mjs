import { readFile, writeFile } from "node:fs/promises";
import webpush from "web-push";
// Local demo setup only. Keys persist across builds and worker restarts.
const path = new URL("../.env", import.meta.url);
let source = await readFile(path, "utf8");
if (!/^DEMO_MODE=true\s*$/m.test(source) || !/^APP_ORIGIN=http:\/\/localhost:3000\s*$/m.test(source)) throw new Error("This helper is only for the localhost demo. Configure production Web Push explicitly.");
const hasPublic = /^WEB_PUSH_PUBLIC_KEY=\S+/m.test(source), hasPrivate = /^WEB_PUSH_PRIVATE_KEY=\S+/m.test(source);
if (hasPublic !== hasPrivate) throw new Error("Incomplete Web Push key pair. Repair configuration without rotating existing keys.");
const keys = hasPublic ? null : webpush.generateVAPIDKeys();
const values = { WEB_PUSH_ENABLED: "true", ALLOW_DEMO_WEB_PUSH: "true", WEB_PUSH_SUBJECT: "mailto:push@kontur.demo", ...(keys ? { WEB_PUSH_PUBLIC_KEY: keys.publicKey, WEB_PUSH_PRIVATE_KEY: keys.privateKey } : {}) };
for (const [key, value] of Object.entries(values)) {
  const regex = new RegExp(`^${key}=.*$`, "m"); source = regex.test(source) ? source.replace(regex, `${key}=${value}`) : `${source.trimEnd()}\n${key}=${value}\n`;
}
await writeFile(path, source, { mode: 0o600 });
console.info("Local demo Web Push enabled. Keys retained in the ignored .env; no device is subscribed automatically.");
