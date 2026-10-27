import { z } from "zod";
import { AppError, requireDoctor, requirePatientAccess, type Actor } from "@/server/access";
import { fingerprint } from "@/modules/assessments/definitions";
import { referralContent, referralProgress, referralCategories, referralUrgencies, referralStatuses, calendarDay } from "./contract";
import { db, lockFollowUp, followUpEvent, followUpToken } from "./shared";
import type { Patient, Prisma } from "@/generated/prisma/client";
import type { ReferralPage, ReferralData, ReferralStatus } from "@/lib/follow-up";
async function token(reader: Pick<Prisma.TransactionClient, "message">, patient: Patient) { const m = await reader.message.findFirst({ where: { patientId: patient.id, sender: { role: "PATIENT" } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } }); return fingerprint([followUpToken(patient), m?.id ?? null]); }
export async function referrals(actor: Actor, patientId: string, cursor?: string, status = "ACTIVE"): Promise<ReferralPage> {
  const patient = await requirePatientAccess(actor, patientId);
  if (cursor && !await db.referral.findFirst({ where: { id: cursor, patientId }, select: { id: true } })) throw new AppError(400, "Обновите список направлений.");
  const active = { patientId, status: { in: ["CONFIRMED", "SCHEDULED"] } };
  if (cursor && status === "ACTIVE" && !await db.referral.findFirst({ where: { id: cursor, ...active }, select: { id: true } })) throw new AppError(400, "Обновите список действующих направлений.");
  const [totalCount, activeCount] = await Promise.all([db.referral.count({ where: { patientId } }), db.referral.count({ where: active })]);
  const rows = await db.referral.findMany({ where: status === "ACTIVE" ? active : { patientId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
  return { totalCount, activeCount, entries: rows.slice(0, 20).map(r => ({ id: r.id, revision: r.revision, status: r.status as ReferralStatus, content: referralContent.parse(r.content), confirmedBy: r.confirmedByName, createdAt: r.createdAt.toISOString() })), nextCursor: rows.length > 20 ? rows[19].id : null, ...(actor.role === "DOCTOR" ? { basisToken: await token(db, patient) } : {}) };
}
export async function referral(actor: Actor, patientId: string, id: string, cursor?: number): Promise<ReferralData & { nextRevision: number | null }> {
  await requirePatientAccess(actor, patientId); const row = await db.referral.findFirst({ where: { id, patientId } }); if (!row) throw new AppError(404, "Направление недоступно.");
  const records = await db.referralUpdate.findMany({ where: { referralId: id, ...(cursor ? { revision: { lt: cursor } } : {}) }, orderBy: { revision: "desc" }, take: 21 });
  return { id, revision: row.revision, status: row.status as ReferralStatus, content: referralContent.parse(row.content), confirmedBy: row.confirmedByName, createdAt: row.createdAt.toISOString(), history: records.slice(0, 20).map(r => ({ revision: r.revision, status: r.status as ReferralStatus, date: r.date, note: r.note, actorName: r.actorName, createdAt: r.createdAt.toISOString() })), nextRevision: records.length > 20 ? records[19].revision : null };
}
type Confirm = { patientId: string; content: z.infer<typeof referralContent>; basisToken: string; requestKey: string; reviewed: true };
export async function confirmReferral(actor: Actor, data: Confirm) {
  requireDoctor(actor);
  return db.$transaction(async tx => {
    const patient = await lockFollowUp(tx, actor, data.patientId); const hash = fingerprint([actor.id, data]);
    const repeat = await tx.referralUpdate.findUnique({ where: { requestKey: data.requestKey }, include: { referral: { select: { patientId: true } } } }); if (repeat) { if (repeat.payloadHash !== hash || repeat.referral.patientId !== patient.id) throw new AppError(409, "Ключ решения уже использован."); return { saved: true, id: repeat.referralId }; }
    if (data.basisToken !== await token(tx, patient)) throw new AppError(409, "Данные изменились. Проверьте актуальные сведения перед подтверждением направления.");
    const row = await tx.referral.create({ data: { patientId: patient.id, content: data.content, basisToken: data.basisToken, clinicalProfileVersionId: patient.currentClinicalProfileId, planVersionId: patient.currentPlanId, confirmedById: actor.id, confirmedByName: actor.name } });
    await tx.referralUpdate.create({ data: { referralId: row.id, revision: 1, status: "CONFIRMED", note: data.content.reason, actorId: actor.id, actorName: actor.name, requestKey: data.requestKey, payloadHash: hash } });
    await followUpEvent(tx, actor, patient.id, "referral.confirm", "Врач подтвердил направление к психиатру", `${referralCategories[data.content.category]}. ${referralUrgencies[data.content.urgency]}.`, row.id); return { saved: true, id: row.id };
  });
}
export async function progressReferral(actor: Actor, data: { patientId: string; id: string; revision: number; progress: z.infer<typeof referralProgress>; basisToken: string; requestKey: string; reviewed: true }) {
  requireDoctor(actor);
  if (data.progress.status === "COMPLETED" && data.progress.date! > calendarDay()) throw new AppError(400, "Состоявшаяся консультация не может иметь будущую дату.");
  return db.$transaction(async tx => {
    const patient = await lockFollowUp(tx, actor, data.patientId); const hash = fingerprint([actor.id, data]);
    const repeat = await tx.referralUpdate.findUnique({ where: { requestKey: data.requestKey } }); if (repeat) { if (repeat.payloadHash !== hash) throw new AppError(409, "Ключ результата уже использован."); return { saved: true }; }
    const row = await tx.referral.findFirst({ where: { id: data.id, patientId: patient.id } }); if (!row) throw new AppError(404, "Направление недоступно.");
    if (data.basisToken !== await token(tx, patient) || row.revision !== data.revision) throw new AppError(409, "Основание или направление изменилось. Проверьте сохранённые данные.");
    if (["COMPLETED", "CANCELLED"].includes(row.status)) throw new AppError(409, "Завершённое решение нельзя перезаписать. Для нового решения создайте новое направление.");
    await tx.referral.update({ where: { id: row.id }, data: { status: data.progress.status, revision: { increment: 1 } } });
    await tx.referralUpdate.create({ data: { referralId: row.id, revision: row.revision + 1, ...data.progress, actorId: actor.id, actorName: actor.name, requestKey: data.requestKey, payloadHash: hash } });
    await followUpEvent(tx, actor, patient.id, "referral.progress", "Врач обновил состояние направления", referralStatuses[data.progress.status], row.id); return { saved: true };
  });
}
