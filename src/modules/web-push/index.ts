import {reminderEligible} from "./reminders";
import { requirePushActor } from "./access";
import { moscowDate } from "@/lib/assessment-deadline";
import { createHash } from "node:crypto";
import webpush from "web-push";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { AppError, requireDoctor, type Actor } from "@/server/access";
import { pushConfiguration, subscriptionSchema } from "./config";
import { readiness } from "@/modules/operations";
import { kindFromPriority, type AssessmentNotificationKind } from "@/lib/assessment-notifications";

type Context = { actor: Actor; sessionId: string };
export const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const mode = () => process.env.DEMO_MODE === "true" ? "DEMO" : "CLINICAL";
export function deliveryStatus(row: { status: string; updatedAt: Date }) {
  return row.status === "SENDING" && row.updatedAt.getTime() < Date.now() - 120000 ? "UNCERTAIN" : row.status;
}
async function queue(tx: Prisma.TransactionClient, id: string, attempt = 1, at = new Date()) {
  await tx.$queryRaw`SELECT graphile_worker.add_job('notification_push', ${JSON.stringify({ deliveryId: id })}::json, run_at := ${at}, priority := -20, max_attempts := 1, job_key := ${`push:${id}:${attempt}`})`;
}
export async function pushSettings({ actor, sessionId }: Context) {
  await requirePushActor(actor); const config = pushConfiguration(mode());
  const state = await readiness();
  const rows = await db.pushDevice.findMany({ where: { userId: actor.id, active: true }, orderBy: { updatedAt: "desc" }, take: 5, include: { session: { select: { expiresAt: true } }, deliveries: { take: 1, orderBy: { createdAt: "desc" } } } });
  return { enabled: config.enabled, publicKey: config.publicKey, workerReady: state.worker, devices: rows.map(d => ({ id: d.id, endpointHash: d.endpointHash, label: d.label, currentSession: d.sessionId === sessionId, sessionActive: !!d.session && d.session.expiresAt > new Date(), keyCurrent: d.keyFingerprint === digest(config.publicKey), lastDelivery: d.deliveries[0] ? { status: deliveryStatus(d.deliveries[0]), at: d.deliveries[0].updatedAt.toISOString(), test: d.deliveries[0].purpose === "TEST" && !d.deliveries[0].eventId && !d.deliveries[0].observationId && !d.deliveries[0].assignmentId } : null })) };
}
export async function registerDevice({ actor, sessionId }: Context, input: { label: string; subscription: unknown }) {
  await requirePushActor(actor); const config = pushConfiguration(mode()); if (!config.enabled) throw new AppError(503, "Push-канал отключён или не настроен. События остаются в кабинете.");
  const parsed = subscriptionSchema.safeParse(input.subscription); if (!parsed.success) throw new AppError(400, "Браузер передал неподдерживаемую подписку. Переподключите уведомления.");
  const s = parsed.data; const hash = digest(s.endpoint);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR UPDATE`;
    const session = await tx.session.findFirst({ where: { id: sessionId, userId: actor.id, expiresAt: { gt: new Date() } } }); if (!session) throw new AppError(401, "Войдите в аккаунт снова.");
    const existing = await tx.pushDevice.findUnique({ where: { endpointHash: hash } });
    if (existing && existing.userId !== actor.id) throw new AppError(409, "Уведомления браузера связаны с другим аккаунтом. Отключите их в настройках браузера и подключите заново.");
    const count = await tx.pushDevice.count({ where: { userId: actor.id, active: true, session: { expiresAt: { gt: new Date() } }, ...(existing ? { id: { not: existing.id } } : {}) } });
    if (count >= 5) throw new AppError(409, "Уже подключено пять устройств. Отключите одно из них и повторите.");
    // Retire expired registrations without deleting the delivery journal.
    await tx.pushDevice.updateMany({ where: { userId: actor.id, active: true, OR: [{ sessionId: null }, { session: { expiresAt: { lte: new Date() } } }] }, data: { active: false } });
    const data = { userId: actor.id, sessionId, endpointHash: hash, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, keyFingerprint: digest(config.publicKey), label: input.label, active: true };
    const device = await tx.pushDevice.upsert({ where: { endpointHash: hash }, create: data, update: data });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "push.connected", targetId: device.id } });
    return { id: device.id };
  });
}
export async function disableDevice({ actor }: Context, id: string) {
  await requirePushActor(actor);
  return db.$transaction(async tx => {
    const row = await tx.pushDevice.findFirst({ where: { id, userId: actor.id } }); if (!row) throw new AppError(404, "Устройство недоступно.");
    await tx.pushDevice.update({ where: { id }, data: { active: false } });
    await tx.pushDelivery.updateMany({ where: { deviceId: id, status: "PENDING" }, data: { status: "CANCELLED", errorCode: "DEVICE_DISABLED", revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "push.disconnected", targetId: id } }); return { saved: true };
  });
}
export async function testPush({ actor, sessionId }: Context, deviceId: string, requestKey: string) {
  await requirePushActor(actor); if (!pushConfiguration(mode()).enabled) throw new AppError(503, "Push-канал не настроен.");
  return db.$transaction(async tx => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "PushDevice" WHERE id = ${deviceId} AND "userId" = ${actor.id} FOR UPDATE`;
    if (!locked.length) throw new AppError(404, "Устройство недоступно.");
    const old = await tx.pushDelivery.findUnique({ where: { requestKey } }); if (old) { if (old.deviceId !== deviceId || old.sessionId !== sessionId) throw new AppError(409, "Ключ проверки уже использован."); return { id: old.id }; }
    const device = await tx.pushDevice.findUniqueOrThrow({ where: { id: deviceId }, include: { session: true } });
    if (!device.active || device.sessionId !== sessionId || !device.session || device.session.expiresAt <= new Date() || device.keyFingerprint !== digest(pushConfiguration(mode()).publicKey)) throw new AppError(409, "Подключите это устройство в текущей сессии заново.");
    if (await tx.pushDelivery.count({ where: { deviceId, eventId: null, observationId: null, assignmentId: null, purpose: "TEST", createdAt: { gt: new Date(Date.now() - 60000) } } }) >= 3) throw new AppError(429, "Не больше трёх проверок в минуту. Подождите и повторите.");
    const row = await tx.pushDelivery.create({ data: { deviceId, sessionId, requestKey } }); await queue(tx, row.id); return { id: row.id };
  });
}
export async function acknowledgePush({ actor, sessionId }: Context, id: string) {
  await requirePushActor(actor);
  const changed = await db.pushDelivery.updateMany({ where: { id, sessionId, device: { userId: actor.id, sessionId, active: true }, status: { in: ["SENDING", "ACCEPTED", "UNCERTAIN", "SHOWN"] } }, data: { status: "SHOWN", shownAt: new Date() } });
  if (!changed.count) throw new AppError(404, "Передача недоступна."); return { saved: true };
}
export async function enqueueAssessmentPush(tx: Prisma.TransactionClient, input: { assignmentId: string; recipientId: string; purpose: "ASSIGNED" | "COMPLETED"; eventId?: string; mode: "DEMO" | "CLINICAL" }) {
  const config = pushConfiguration(input.mode); if (!config.enabled) return;
  const devices = await tx.pushDevice.findMany({ where: { userId: input.recipientId, active: true, keyFingerprint: digest(config.publicKey), session: { expiresAt: { gt: new Date() } } }, take: 5 });
  for (const device of devices) {
    const row = await tx.pushDelivery.create({ data: { assignmentId: input.assignmentId, eventId: input.eventId, purpose: input.purpose, deviceId: device.id, sessionId: device.sessionId! } });
    await queue(tx, row.id);
  }
}
export async function enqueueContactPush(tx: Prisma.TransactionClient, request: { id: string; recipientId: string }) {
  const config = pushConfiguration(mode()); if (!config.enabled) return;
  const devices = await tx.pushDevice.findMany({ where: { userId: request.recipientId, active: true, keyFingerprint: digest(config.publicKey), session: { expiresAt: { gt: new Date() } } }, take: 5 });
  for (const device of devices) { const row = await tx.pushDelivery.create({ data: { observationId: request.id, purpose: "CONTACT", deviceId: device.id, sessionId: device.sessionId! } }); await queue(tx, row.id); }
}
export async function eventPushData(eventId: string) {
  const rows = await db.pushDelivery.findMany({ where: { eventId }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, status: true, updatedAt: true, attempts: true, device: { select: { label: true } } } });
  return rows.map(r => ({ id: r.id, device: r.device.label, status: deliveryStatus(r), attempts: r.attempts }));
}

export type PushMessage = { type: "kontur-test" | "kontur-event" | "kontur-contact" | "kontur-assigned" | "kontur-completed" | "kontur-medication" | "kontur-medication-upcoming" | "kontur-assessment-reminder" | "kontur-plan" | "kontur-appointment" | "kontur-appointment-cancelled" | "kontur-appointment-reminder"; appointmentAt?:string; appointmentHasTime?:boolean; dueDate?: string; deliveryId: string; url: string; tag: string; kind?: AssessmentNotificationKind };
type Sender = (subscription: webpush.PushSubscription, payload: PushMessage) => Promise<unknown>;
export const sendWebPush: Sender = async (subscription, payload) => {
  const c = pushConfiguration();
  return webpush.sendNotification(subscription, JSON.stringify(payload), { vapidDetails: { subject: c.subject, publicKey: c.publicKey, privateKey: c.privateKey }, timeout: 15000, TTL: 3600, urgency: "normal", topic: digest(payload.tag).slice(0, 32) });
};
export async function processPush(id: string, send: Sender = sendWebPush, now=new Date()) {
  const row = await db.pushDelivery.findUnique({ where: { id }, include: { reminder: {include:{patient:{select:{nextVisitHasTime:true}}}}, device: { include: { user: { select: { role: true } }, session: true } }, event: { include: { patient: { select: { doctorId: true } } } }, observation: { include: { patient: { select: { doctorId: true } } } }, assignment: { include: { patient: { select: { doctorId: true, userId: true } }, definition: true, submission: { select: { id: true } } } } } });
  if (!row || !["PENDING", "SENDING"].includes(row.status)) return;
  if (row.status === "SENDING") { if (deliveryStatus(row) === "UNCERTAIN") await db.pushDelivery.updateMany({ where: { id, revision: row.revision, status: "SENDING" }, data: { status: "UNCERTAIN", errorCode: "WORKER_INTERRUPTED", revision: { increment: 1 } } }); return; }
  if (row.nextAttemptAt && row.nextAttemptAt > new Date()) return;
  const d = row.device, e = row.event, observation = row.observation, assignment = row.assignment; const config = pushConfiguration(e?.mode ?? mode());
  const test = row.purpose === "TEST" && !row.reminderId && !row.eventId && !row.observationId && !row.assignmentId;
  const contact = row.purpose === "CONTACT" && !row.eventId && !row.assignmentId && observation?.needsContact && !observation.acknowledgedAt && observation.patient.doctorId === d.userId && d.user.role === "DOCTOR";
  const clinicianForm = assignment && (assignment.definition.content as {respondent?: string}).respondent === "DOCTOR";
  const assigned = row.purpose === "ASSIGNED" && !row.eventId && !row.observationId && assignment && !clinicianForm && ["ASSIGNED", "IN_PROGRESS"].includes(assignment.status) && assignment.patient.userId === d.userId && d.user.role === "PATIENT";
  const completed = row.purpose === "COMPLETED" && !row.observationId && assignment?.status === "COMPLETED" && assignment.patient.doctorId === d.userId && d.user.role === "DOCTOR" && (!e || (e.recipientId === d.userId && e.patientId === assignment.patientId && e.submissionId === assignment.submission?.id));
  const reminder = row.purpose === "REMINDER" && row.reminder && !row.assignmentId && !row.eventId && !row.observationId && d.user.role === "PATIENT" && await reminderEligible(row.reminder,d.userId,now);
  const eligible = (test || contact || assigned || completed || reminder) && d.active && ["DOCTOR", "PATIENT"].includes(d.user.role) && d.sessionId === row.sessionId && d.session && d.session.expiresAt > new Date() && (send !== sendWebPush || (config.enabled && d.keyFingerprint === digest(config.publicKey)));
  if (!eligible) { await db.pushDelivery.updateMany({ where: { id, revision: row.revision, status: "PENDING" }, data: { status: "CANCELLED", errorCode: "CHANNEL_OR_ACCESS_CHANGED", revision: { increment: 1 } } }); return; }
  if (!subscriptionSchema.safeParse({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }).success) { await db.pushDelivery.updateMany({ where: { id, status: "PENDING" }, data: { status: "FAILED", errorCode: "INVALID_SUBSCRIPTION" } }); return; }
  const claimed = await db.pushDelivery.updateMany({ where: { id, revision: row.revision, status: "PENDING" }, data: { status: "SENDING", attempts: { increment: 1 }, revision: { increment: 1 }, nextAttemptAt: null } }); if (!claimed.count) return;
  const attempt = row.attempts + 1;

  const kind = completed && e ? kindFromPriority(e.priority) : undefined;
  const payload: PushMessage = {
    type: reminder ? row.reminder!.kind === "APPOINTMENT_REMINDER" ? "kontur-appointment-reminder" : row.reminder!.kind === "APPOINTMENT" ? "kontur-appointment" : row.reminder!.kind === "APPOINTMENT_CANCELLED" ? "kontur-appointment-cancelled" : row.reminder!.kind === "MEDICATION" ? "kontur-medication" : row.reminder!.kind === "MEDICATION_UPCOMING" ? "kontur-medication-upcoming" : row.reminder!.kind === "PLAN" ? "kontur-plan" : "kontur-assessment-reminder" : assigned ? "kontur-assigned" : completed ? "kontur-completed" : contact ? "kontur-contact" : "kontur-test",
    deliveryId: id, tag: reminder ? `kontur-reminder:${row.reminderId}` : assignment ? `kontur-assessment:${assignment.id}:${row.purpose}` : observation ? `kontur-contact:${observation.id}` : `kontur-test:${id}`,
    url: reminder ? `/patient${row.reminder!.assignmentId ? `?assignment=${encodeURIComponent(row.reminder!.assignmentId)}` : ""}` : assigned && assignment ? `/patient?assignment=${encodeURIComponent(assignment.id)}` : completed && assignment ? `/doctor?patient=${encodeURIComponent(assignment.patientId)}${e ? `&event=${encodeURIComponent(e.id)}` : ""}` : contact && observation ? `/doctor?patient=${encodeURIComponent(observation.patientId)}` : d.user.role === "PATIENT" ? "/patient" : "/doctor",
    ...(reminder && ["APPOINTMENT","APPOINTMENT_REMINDER"].includes(row.reminder!.kind) ? {appointmentAt:row.reminder!.dueAt.toISOString(),appointmentHasTime:row.reminder!.patient.nextVisitHasTime}:{}),
    ...(assigned && assignment?.dueAt ? { dueDate: moscowDate(assignment.dueAt) } : {}), ...(kind ? { kind } : {})
  };
  try {
    await send({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload);
    // A browser receipt can arrive before the push service responds; never overwrite it.
    await db.pushDelivery.updateMany({ where: { id, revision: row.revision + 1, status: { in: ["SENDING", "SHOWN"] } }, data: { acceptedAt: new Date(), errorCode: null } });
    await db.pushDelivery.updateMany({ where: { id, revision: row.revision + 1, status: "SENDING" }, data: { status: "ACCEPTED", revision: { increment: 1 } } });
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    const gone = status === 404 || status === 410, safeRetry = status === 429 || (typeof status === "number" && status >= 500 && status < 600);
    const retry = safeRetry && attempt < 3, at = new Date(Date.now() + (attempt === 1 ? 30000 : 90000));
    await db.$transaction(async tx => {
      const changed = await tx.pushDelivery.updateMany({ where: { id, revision: row.revision + 1, status: "SENDING" }, data: { status: retry ? "PENDING" : status === undefined ? "UNCERTAIN" : "FAILED", revision: { increment: 1 }, errorCode: gone ? "SUBSCRIPTION_GONE" : status === undefined ? "OUTCOME_UNKNOWN" : "PUSH_REJECTED", nextAttemptAt: retry ? at : null } });
      if (!changed.count) return;
      if (gone) { await tx.pushDevice.update({ where: { id: d.id }, data: { active: false } }); await tx.pushDelivery.updateMany({ where: { deviceId: d.id, status: "PENDING" }, data: { status: "CANCELLED", errorCode: "SUBSCRIPTION_GONE", revision: { increment: 1 } } }); }
      if (retry) await queue(tx, id, attempt + 1, at);
    });
  }
}
