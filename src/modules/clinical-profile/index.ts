import { db } from "@/server/db";
import { AppError, requireDoctor, requirePatientAccess, type Actor } from "@/server/access";
import { fingerprint } from "@/modules/assessments/definitions";
import { emptyProfile, profileContentSchema, type ProfileContent } from "./contract";
import type { ClinicalProfile, ProfileHistory, ProfileWorkspace } from "@/lib/clinical-profile";
import type { ClinicalProfileVersion } from "@/generated/prisma/client";
import { verifyDocumentEvidence } from "@/modules/documents";

const dto = (row: ClinicalProfileVersion, currentId: string | null): ClinicalProfile => ({ id: row.id, version: row.version, content: profileContentSchema.parse(row.content), savedBy: row.savedByName, createdAt: row.createdAt.toISOString(), isCurrent: row.id === currentId });
export async function clinicalProfileStamp(actor: Actor, patientId: string) {
  requireDoctor(actor);
  const patient = await db.patient.findFirst({ where: { id: patientId, doctorId: actor.id }, select: { currentClinicalProfileId: true } });
  if (!patient) throw new AppError(404, "Карточка недоступна.");
  return `W/"${fingerprint([actor.id, patientId, patient.currentClinicalProfileId])}"`;
}
export async function getClinicalProfile(actor: Actor, patientId: string, versionId?: string): Promise<ProfileWorkspace> {
  requireDoctor(actor); const patient = await requirePatientAccess(actor, patientId);
  const id = versionId ?? patient.currentClinicalProfileId;
  const row = id ? await db.clinicalProfileVersion.findFirst({ where: { id, patientId, patient: { doctorId: actor.id } } }) : null;
  if (id && !row) throw new AppError(404, "Версия сведений недоступна.");
  return { current: row ? dto(row, patient.currentClinicalProfileId) : null, version: row?.version ?? 0 };
}
export async function getClinicalProfileHistory(actor: Actor, patientId: string, cursor?: string): Promise<ProfileHistory> {
  requireDoctor(actor); await requirePatientAccess(actor, patientId);
  const where = { patientId, patient: { doctorId: actor.id } };
  if (cursor && !await db.clinicalProfileVersion.findFirst({ where: { ...where, id: cursor }, select: { id: true } })) throw new AppError(400, "Обновите историю сведений.");
  const rows = await db.clinicalProfileVersion.findMany({ where, orderBy: { version: "desc" }, take: 21, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, version: true, savedByName: true, createdAt: true } });
  return { versions: rows.slice(0, 20).map(row => ({ id: row.id, version: row.version, savedBy: row.savedByName, createdAt: row.createdAt.toISOString() })), nextCursor: rows.length > 20 ? rows[19].id : null };
}
export async function saveClinicalProfile(actor: Actor, data: { patientId: string; expectedVersion: number; content: ProfileContent; requestKey: string; reviewed: true }) {
  requireDoctor(actor); const content = profileContentSchema.parse(data.content); const contentHash = fingerprint(content);
  const payloadHash = fingerprint([actor.id, data.patientId, data.expectedVersion, content]);
  return db.$transaction(async tx => {
    const locked = await tx.$queryRaw<{ currentClinicalProfileId: string | null }[]>`SELECT "currentClinicalProfileId" FROM "Patient" WHERE id = ${data.patientId} AND "doctorId" = ${actor.id} FOR UPDATE`;
    if (!locked.length) throw new AppError(404, "Карточка недоступна.");
    const repeat = await tx.clinicalProfileVersion.findUnique({ where: { requestKey: data.requestKey } });
    if (repeat) { if (repeat.payloadHash !== payloadHash) throw new AppError(409, "Ключ сохранения уже использован для других данных."); return { id: repeat.id, version: repeat.version }; }
    const previous = locked[0].currentClinicalProfileId ? await tx.clinicalProfileVersion.findUniqueOrThrow({ where: { id: locked[0].currentClinicalProfileId } }) : null;
    if ((previous?.version ?? 0) !== data.expectedVersion) throw new AppError(409, "Сведения изменены в другой вкладке. Ваш ввод сохранён здесь; сравните его с актуальной версией перед новой записью.");
    await verifyDocumentEvidence(tx, data.patientId, content);
    if (contentHash === (previous?.contentHash ?? fingerprint(emptyProfile()))) throw new AppError(400, "Сведения не изменились. Новая версия не создана.");
    const version = await tx.clinicalProfileVersion.create({ data: { patientId: data.patientId, version: (previous?.version ?? 0) + 1, content, contentHash, previousVersionId: previous?.id, savedById: actor.id, savedByName: actor.name, requestKey: data.requestKey, payloadHash } });
    await tx.patient.update({ where: { id: data.patientId }, data: { currentClinicalProfileId: version.id, clinicalDataVersion: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "clinical-profile.save", targetId: version.id } });
    const event = await tx.patientEvent.create({ data: { patientId: data.patientId, kind: "profile", title: "Врач уточнил сведения для наблюдения", detail: `Версия ${version.version}` } });
    await tx.$queryRaw`SELECT graphile_worker.add_job('workspace_event', ${JSON.stringify({ eventId: event.id })}::json)`;
    return { id: version.id, version: version.version };
  });
}
