import { createECDH } from "node:crypto";
import { z } from "zod";

// Endpoints are capabilities. Never accept arbitrary URLs as server-side fetch targets.
export function validEndpoint(value: string) {
  try {
    const u = new URL(value);
    return value.length <= 2048 && u.protocol === "https:" && !u.username && !u.password && !u.hash && (!u.port || u.port === "443") &&
      (u.hostname === "fcm.googleapis.com" || u.hostname === "updates.push.services.mozilla.com" ||
        /^[a-z0-9-]+\.push\.apple\.com$/.test(u.hostname) || /^(?:[a-z0-9-]+\.)*notify\.windows\.com$/.test(u.hostname));
  } catch { return false; }
}
function publicPoint(value: string) {
  try {
    if (!/^[A-Za-z0-9_-]{87}$/.test(value)) return false;
    const point = Buffer.from(value, "base64url");
    const curve = createECDH("prime256v1"); curve.generateKeys(); curve.computeSecret(point); return point.length === 65;
  } catch { return false; }
}
export const subscriptionSchema = z.strictObject({
  endpoint: z.string().refine(validEndpoint),
  expirationTime: z.number().finite().nonnegative().nullable().optional(),
  keys: z.strictObject({ p256dh: z.string().refine(publicPoint), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) })
});
export function pushConfiguration(mode: "DEMO" | "CLINICAL" = "CLINICAL") {
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY ?? "", privateKey = process.env.WEB_PUSH_PRIVATE_KEY ?? "";
  const subject = process.env.WEB_PUSH_SUBJECT ?? "", origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
  let valid = false;
  try {
    const url = new URL(origin); const contact = new URL(subject);
    const curve = createECDH("prime256v1"); curve.setPrivateKey(Buffer.from(privateKey, "base64url"));
    valid = curve.getPublicKey().toString("base64url") === publicKey && publicPoint(publicKey) &&
      (contact.protocol === "mailto:" || contact.protocol === "https:") &&
      (url.protocol === "https:" || (process.env.DEMO_MODE === "true" && url.origin === "http://localhost:3000")) && url.origin === origin;
  } catch { /* invalid or incomplete configuration is disabled, never a request error */ }
  const enabled = process.env.WEB_PUSH_ENABLED === "true" && valid && (mode !== "DEMO" || process.env.ALLOW_DEMO_WEB_PUSH === "true");
  return { enabled, publicKey: enabled ? publicKey : "", privateKey, subject, origin };
}
