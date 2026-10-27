import { AppError, requireDoctor, type Actor } from "@/server/access";
import { db } from "@/server/db";

/** Both roles receive questionnaire notifications; patients must have a confirmed link. */
export async function requirePushActor(actor: Actor) {
  if (actor.role === "DOCTOR") { requireDoctor(actor); return; }
  if (actor.role !== "PATIENT") throw new AppError(403, "Уведомления недоступны для этой роли.");
  const linked = await db.patient.findFirst({ where: { userId: actor.id, doctor: { role: "DOCTOR" } }, select: { id: true } });
  if (!linked) throw new AppError(403, "Подключение к врачу ещё не подтверждено.");
}
