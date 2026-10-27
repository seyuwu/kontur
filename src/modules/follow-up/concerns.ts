import { z } from "zod";
import { AppError, requireDoctor, requirePatientAccess, type Actor } from "@/server/access";
import { fingerprint } from "@/modules/assessments/definitions";
import { concernInput, concernKinds, impactLabels, calendarDay } from "./contract";
import { db, lockFollowUp, followUpEvent } from "./shared";
import type { ConcernPage } from "@/lib/follow-up";
export async function concerns(actor: Actor, patientId: string, cursor?: string): Promise<ConcernPage> {
  await requirePatientAccess(actor, patientId);
  if (cursor && !await db.patientConcern.findFirst({ where: { id: cursor, patientId }, select: { id: true } })) throw new AppError(400, "Обновите список сообщений о проблеме.");
  const [rows, unreviewed] = await Promise.all([db.patientConcern.findMany({ where: { patientId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }), db.patientConcern.count({ where: { patientId, reviewedAt: null } })]);
  return { entries: rows.slice(0, 20).map(r => ({ id: r.id, patientId, kind: concernInput.shape.kind.parse(r.kind), title: r.title, description: r.description, startedOn: r.startedOn, impact: concernInput.shape.impact.parse(r.impact), planVersionId: r.planVersionId, createdAt: r.createdAt.toISOString(), reviewedAt: r.reviewedAt?.toISOString() ?? null })), unreviewed, nextCursor: rows.length > 20 ? rows[19].id : null };
}
export async function submitConcern(actor: Actor, data: z.infer<typeof concernInput>) {
  if (actor.role !== "PATIENT") throw new AppError(403, "Сообщение о самочувствии заполняет пациент.");
  if (data.startedOn && data.startedOn > calendarDay()) throw new AppError(400, "Дата начала не может быть в будущем.");
  return db.$transaction(async tx => {
    const patient = await lockFollowUp(tx, actor, data.patientId); const hash = fingerprint([actor.id, data]);
    const repeat = await tx.patientConcern.findUnique({ where: { requestKey: data.requestKey } }); if (repeat) { if (repeat.payloadHash !== hash) throw new AppError(409, "Ключ сообщения уже использован."); return { saved: true, id: repeat.id }; }
    const message = await tx.message.create({ data: { patientId: patient.id, senderId: actor.id, requestKey: `concern:${data.requestKey}`, text: `${concernKinds[data.kind]}\n${data.title}\n\n${data.description}\nНачало: ${data.startedOn ?? "не уточнено"}. Влияние со слов пациента: ${impactLabels[data.impact]}.\nСообщение не устанавливает причину симптома или срочность.` } });
    const row = await tx.patientConcern.create({ data: { patientId: patient.id, kind: data.kind, title: data.title, description: data.description, impact: data.impact, startedOn: data.startedOn, planVersionId: patient.currentPlanId, actorId: actor.id, requestKey: data.requestKey, payloadHash: hash, messageId: message.id } });
    await followUpEvent(tx, actor, patient.id, "concern.create", "Пациент сообщил об изменении самочувствия", data.title, row.id); return { saved: true, id: row.id };
  });
}
export async function reviewConcern(actor: Actor, patientId: string, id: string) {
  requireDoctor(actor);
  return db.$transaction(async tx => { await lockFollowUp(tx, actor, patientId); const row = await tx.patientConcern.findFirst({ where: { id, patientId } }); if (!row) throw new AppError(404, "Сообщение недоступно.");
    if (!row.reviewedAt) { await tx.patientConcern.update({ where: { id }, data: { reviewedAt: new Date(), reviewedById: actor.id } }); await tx.auditEvent.create({ data: { actorId: actor.id, action: "concern.review", targetId: id } }); await tx.patient.update({ where: { id: patientId }, data: { updatedAt: new Date() } }); }
    return { saved: true }; });
}
