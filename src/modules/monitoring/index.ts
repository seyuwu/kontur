import { enqueueContactPush } from "@/modules/web-push";
import { db } from "@/server/db";
import { AppError, requireDoctor, requirePatientAccess, type Actor } from "@/server/access";

export { viewAssessmentResult, listReviewEvents, getReviewEvent, claimReviewEvent, resolveReviewEvent, refreshReviewContext, sendReviewMessage, getReviewBasis, getReviewBasisHistory } from "./review-events";

export async function saveObservation(actor: Actor, data: { patientId: string; score?: number | null; note: string; needsContact: boolean; requestKey: string }) {
  if (actor.role !== "PATIENT") throw new AppError(403, "Самоотчёт заполняет пациент.");
  const patient = await requirePatientAccess(actor, data.patientId);
  if (data.score == null && !data.note.trim() && !data.needsContact) throw new AppError(400, "Добавьте текст или отметьте просьбу связаться.");
  const existing = await db.observation.findUnique({ where: { requestKey: data.requestKey } });
  if (existing) {
    if (existing.patientId !== data.patientId) throw new AppError(409, "Запрос уже использован.");
    return { saved: true };
  }
  try { await db.$transaction(async tx => {
    const observation = await tx.observation.create({ data: { patientId: data.patientId, score: data.score ?? null, note: data.note, needsContact: data.needsContact, requestKey: data.requestKey } });
    if (data.needsContact) await enqueueContactPush(tx, { id: observation.id, recipientId: patient.doctorId });
    const event = await tx.patientEvent.create({ data: { patientId: data.patientId, kind: "checkin", title: data.needsContact ? "Пациент просит связаться" : "Новый самоотчёт", detail: data.note } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "observation.create", targetId: observation.id } });
    await tx.$queryRaw`SELECT graphile_worker.add_job('workspace_event', ${JSON.stringify({ eventId: event.id })}::json)`;
    await tx.patient.update({ where: { id: data.patientId }, data: { updatedAt: new Date(), clinicalDataVersion: { increment: 1 } } });
  }); } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    const duplicate = await db.observation.findUnique({ where: { requestKey: data.requestKey } });
    if (duplicate?.patientId !== data.patientId) throw error;
  }
  return { saved: true };
}
export async function acknowledgeRequest(actor: Actor, data: { patientId: string; observationId: string }) {
  requireDoctor(actor); await requirePatientAccess(actor, data.patientId);
  await db.$transaction(async tx => {
    const result = await tx.observation.updateMany({ where: { id: data.observationId, patientId: data.patientId, needsContact: true, acknowledgedAt: null }, data: { acknowledgedAt: new Date() } });
    if (result.count) {
      await tx.pushDelivery.updateMany({ where: { observationId: data.observationId, status: "PENDING" }, data: { status: "CANCELLED", errorCode: "REQUEST_ACKNOWLEDGED", revision: { increment: 1 } } });
      await tx.auditEvent.create({ data: { actorId: actor.id, action: "contact-request.acknowledge", targetId: data.observationId } });
      await tx.patient.update({ where: { id: data.patientId }, data: { updatedAt: new Date() } });
    }
  });
  return { saved: true };
}
