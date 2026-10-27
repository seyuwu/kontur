import nodemailer from "nodemailer";
import { z } from "zod";
export class EmailDeliveryError extends Error { constructor(public code: string, public safeRetry: boolean) { super(code); } }
export function emailConfiguration(mode: "DEMO" | "CLINICAL") {
  const enabled = process.env.ALERT_EMAIL_ENABLED === "true";
  const host = process.env.SMTP_HOST ?? "", port = Number(process.env.SMTP_PORT ?? "587"), from = process.env.SMTP_FROM ?? "";
  const user = process.env.SMTP_USER ?? "", password = process.env.SMTP_PASSWORD ?? "";
  let origin = ""; try { const parsed = new URL(process.env.APP_ORIGIN ?? "http://localhost:3000"); if (parsed.protocol === "https:" && !parsed.username && !parsed.password && parsed.pathname === "/") origin = parsed.origin; } catch { /* not configured */ }
  const reason = mode === "DEMO" && (process.env.DEMO_MODE !== "true" || process.env.ALLOW_DEMO_ALERT_EMAIL !== "true") ? "DEMO_DISABLED" : !enabled || !/^[a-zA-Z0-9.-]{1,253}$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !z.email().safeParse(from).success || !user || !password || !origin ? "NOT_CONFIGURED" : null;
  return { enabled: !reason, reason, host, port, from, user, password, origin };
}
export async function sendAlertEmail(input: { id: string; eventId: string; patientId: string; recipient: string; mode: "DEMO" | "CLINICAL" }): Promise<{ messageId: string }> {
  const config = emailConfiguration(input.mode); if (!config.enabled) throw new EmailDeliveryError(config.reason!, false);
  const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.port === 465, requireTLS: config.port !== 465, auth: { user: config.user, pass: config.password }, tls: { minVersion: "TLSv1.2", rejectUnauthorized: true }, connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 20000, dnsTimeout: 10000, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { const link = `${config.origin}/doctor?patient=${encodeURIComponent(input.patientId)}&event=${encodeURIComponent(input.eventId)}`;
    const mail = transport.sendMail({ from: { name: "Контур", address: config.from }, to: input.recipient, subject: "Контур: новое событие для разбора", text: `В вашем кабинете есть новое событие. Откройте его, чтобы проверить основание и доступные действия.\n\n${link}\n\nПисьмо не содержит медицинских сведений. Для доступа требуется вход в аккаунт врача.`, messageId: `<${input.id}@${config.from.split("@")[1]}>` });
    const info = await Promise.race([mail, new Promise<never>((_, reject) => { timer = setTimeout(() => { transport.close(); reject(new EmailDeliveryError("UNCERTAIN", false)); }, 60000); })]);
    if (!info.accepted?.some((a: string | { address: string }) => (typeof a === "string" ? a : a.address).toLowerCase() === input.recipient.toLowerCase())) throw new EmailDeliveryError("RECIPIENT_REJECTED", false);
    return { messageId: info.messageId };
  } catch (error) {
    if (error instanceof EmailDeliveryError) throw error;
    const e = error as { code?: string; command?: string; responseCode?: number };
    if (e.code === "EAUTH" || (e.responseCode && e.responseCode >= 500)) throw new EmailDeliveryError("SMTP_REJECTED", false);
    if ((e.responseCode && e.responseCode >= 400 && e.responseCode < 500) || ["CONN", "EHLO", "HELO", "STARTTLS"].includes(e.command ?? "")) throw new EmailDeliveryError("SMTP_UNAVAILABLE", true);
    throw new EmailDeliveryError("UNCERTAIN", false);
  } finally { if (timer) clearTimeout(timer); transport.close(); }
}
