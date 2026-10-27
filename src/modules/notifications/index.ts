import { db } from "@/server/db";
import { AppError, requireDoctor, type Actor } from "@/server/access";
import type { NotificationDelivery, Prisma } from "@/generated/prisma/client";
import { sendAlertEmail } from "./email";
// Questionnaire results remain in the cabinet; external notifications require a contact request.
export async function enqueueReviewEmail(tx: Prisma.TransactionClient, event: { id: string; mode: "DEMO" | "CLINICAL" }) { void tx; void event; return null; }
export function deliveryData(row: NotificationDelivery | null, mode: "DEMO" | "CLINICAL") {
  const enabled = false; void mode; if (!row) return { delivery: null, emailEnabled: enabled };
  const stale = row.status === "SENDING" && row.updatedAt.getTime() < Date.now() - 180000;
  return { emailEnabled: enabled, delivery: { id: row.id, status: stale ? "UNCERTAIN" : row.status, revision: row.revision, attempts: row.attempts, errorCode: stale ? "WORKER_INTERRUPTED" : row.lastErrorCode, nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null, acceptedAt: row.acceptedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() } };
}

export async function retryReviewEmail(actor: Actor, data: { eventId: string; revision: number; requestKey: string; duplicateRisk: boolean }) {
  requireDoctor(actor);
  const event = await db.reviewEvent.findFirst({ where: { id: data.eventId, recipientId: actor.id, patient: { doctorId: actor.id } }, select: { id: true } });
  if (!event) throw new AppError(404, "Событие недоступно.");
  throw new AppError(409, "Результаты анкет доступны в кабинете. Уведомления отправляются только по просьбе пациента связаться.");
}
export async function processReviewEmail(id: string, send: typeof sendAlertEmail = sendAlertEmail) {
  void send;
  await db.notificationDelivery.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELLED", lastErrorCode: "CONTACT_REQUESTS_ONLY", revision: { increment: 1 } } });
}
