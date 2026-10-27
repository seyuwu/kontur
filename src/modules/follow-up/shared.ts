import { db } from "@/server/db";
import { AppError, type Actor } from "@/server/access";
import type { Prisma, Patient } from "@/generated/prisma/client";
import { fingerprint } from "@/modules/assessments/definitions";
export const followUpToken = (p: Patient) => fingerprint([p.id, p.doctorId, p.clinicalDataVersion, p.currentPlanId, p.currentClinicalProfileId]);
export async function lockFollowUp(tx: Prisma.TransactionClient, actor: Actor, patientId: string) {
  const rows = actor.role === "DOCTOR" ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Patient" WHERE id = ${patientId} AND "doctorId" = ${actor.id} FOR UPDATE` : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Patient" WHERE id = ${patientId} AND "userId" = ${actor.id} FOR UPDATE`;
  if (!rows.length) throw new AppError(404, "Карточка недоступна."); return tx.patient.findUniqueOrThrow({ where: { id: patientId } });
}
export async function followUpEvent(tx: Prisma.TransactionClient, actor: Actor, patientId: string, kind: string, title: string, detail: string, targetId: string, changed = true) {
  await tx.patient.update({ where: { id: patientId }, data: { updatedAt: new Date(), ...(changed ? { clinicalDataVersion: { increment: 1 } } : {}) } });
  await tx.auditEvent.create({ data: { actorId: actor.id, action: kind, targetId } });
  const event = await tx.patientEvent.create({ data: { patientId, kind, title, detail } });
  await tx.$queryRaw`SELECT graphile_worker.add_job('workspace_event', ${JSON.stringify({ eventId: event.id })}::json)`;
}
export { db };
