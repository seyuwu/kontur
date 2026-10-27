import { z } from "zod";
import { kindFromPriority } from "@/lib/assessment-notifications";
import { eventPushData } from "@/modules/web-push";
import { deliveryData } from "@/modules/notifications";
import { db } from "@/server/db";
import { AppError, requireDoctor, requirePatientAccess, type Actor } from "@/server/access";
import { fingerprint, publicForm, readDefinition } from "@/modules/assessments/definitions";
import { evaluateAssessment, proposedActionsSchema } from "@/modules/clinical";
import type { ReviewEventData, ReviewWorkspaceData } from "@/lib/assessments";
import type { ReviewBasisHistory } from "@/lib/review";
import type { Prisma } from "@/generated/prisma/client";
import { basisData, createBasis, currentReviewContext, lockReviewPatient, reviewContext } from "./review-basis";
import { permitsMethod, type ResolutionMethod } from "./action-catalogue";

const resultSchema = z.object({ metric: z.object({ label: z.string(), value: z.number(), minimum: z.number(), maximum: z.number(), interpretation: z.string() }) });
function scope(actor: Actor, patientId?: string): Prisma.ReviewEventWhereInput {
  requireDoctor(actor);
  return { recipientId: actor.id, patient: { doctorId: actor.id }, ...(patientId ? { patientId } : {}), ...(process.env.DEMO_MODE === "true" ? {} : { mode: "CLINICAL" }) };
}
export async function listReviewEvents(actor: Actor, options: { patientId?: string; cursor?: string; status?: "ACTIVE" | "RESOLVED" | "ALL" | "UNREAD" }): Promise<ReviewWorkspaceData> {
  const base = scope(actor, options.patientId);
  if (options.patientId) await requirePatientAccess(actor, options.patientId);
  if (options.cursor && !await db.reviewEvent.findFirst({ where: { ...base, id: options.cursor }, select: { id: true } })) throw new AppError(400, "Страница событий недоступна. Обновите список.");
  const [records, counts] = await Promise.all([
    db.reviewEvent.findMany({ where: { ...base, ...(options.status === "UNREAD" ? { viewedAt: null } : {}), ...(options.status === "ALL" ? {} : { status: options.status === "RESOLVED" ? "RESOLVED" as const : { in: ["OPEN", "IN_PROGRESS"] as ("OPEN" | "IN_PROGRESS")[] } }) }, orderBy: [{ priority: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: 21, ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      select: { id: true, patientId: true, title: true, reason: true, mode: true, status: true, revision: true, ownerId: true, createdAt: true, resolvedAt: true, viewedAt: true, priority: true, patient: { select: { name: true, publicId: true } } } }),
    db.reviewEvent.groupBy({ by: ["status"], where: base, _count: { _all: true } })
  ]);
  const rows = records.slice(0, 20);
  return { events: rows.map(row => ({ id: row.id, patientId: row.patientId, patientName: row.patient.name, publicId: row.patient.publicId, title: row.title, viewedAt: row.viewedAt?.toISOString() ?? null, reason: row.reason, mode: row.mode, status: row.status, revision: row.revision, ownerId: row.ownerId, createdAt: row.createdAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null, notificationKind: kindFromPriority(row.priority) })), nextCursor: records.length > 20 ? rows.at(-1)!.id : null,
    openCount: counts.find(c => c.status === "OPEN")?._count._all ?? 0, inProgressCount: counts.find(c => c.status === "IN_PROGRESS")?._count._all ?? 0, resolvedCount: counts.find(c => c.status === "RESOLVED")?._count._all ?? 0 };
}

export async function viewAssessmentResult(actor: Actor, eventId: string) {
  requireDoctor(actor);
  return db.$transaction(async tx => {
    const event = await tx.reviewEvent.findFirst({ where: { ...scope(actor), id: eventId }, select: { patientId: true } });
    if (!event) throw new AppError(404, "Результат недоступен.");
    await lockReviewPatient(tx, actor, event.patientId);
    const changed = await tx.reviewEvent.updateMany({ where: { ...scope(actor), id: eventId, viewedAt: null }, data: { viewedAt: new Date() } });
    if (changed.count) await tx.auditEvent.create({ data: { actorId: actor.id, action: "assessment.result.view", targetId: eventId } });
    return { saved: true };
  });
}

async function ownedEvent(actor: Actor, eventId: string) {
  const record = await db.reviewEvent.findFirst({ where: { ...scope(actor), id: eventId }, include: { emailDelivery: true, currentBasis: true, patient: { select: { name: true, publicId: true } }, submission: { include: { assignment: { include: { definition: true } } } } } });
  if (!record) throw new AppError(404, "Событие не найдено или недоступно.");
  return record;
}
function checkedEvent(record: Awaited<ReturnType<typeof ownedEvent>>) {
  const definition = readDefinition(record.submission.assignment.definition);
  if (record.definitionChecksum !== record.submission.assignment.definition.checksum || record.submission.definitionChecksum !== record.definitionChecksum) throw new AppError(409, "Основание события изменилось. Требуется проверка администратора.");
  const answers = z.record(z.string(), z.string()).parse(record.submission.answers);
  const finding = evaluateAssessment(definition, answers).findings.find(f => f.ruleId === record.ruleId);
  const actions = proposedActionsSchema.parse(record.actions);
  if (!finding || fingerprint(actions) !== fingerprint(finding.actions)) throw new AppError(409, "Предложения не соответствуют исходному правилу. Требуется проверка администратора.");
  return { definition, answers, actions, notification: finding.notification };
}
export async function getReviewEvent(actor: Actor, eventId: string): Promise<ReviewEventData> {
  const record = await ownedEvent(actor, eventId);
  const { definition, answers, actions, notification } = checkedEvent(record);
  const [context, executions, receiptCount, basisCount] = await Promise.all([
    record.status === "RESOLVED" ? null : currentReviewContext(record.patientId, actor, record.definitionChecksum),
    db.reviewMessageExecution.findMany({ where: { eventId: record.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10, include: { basis: { select: { version: true } } } }),
    db.reviewMessageExecution.count({ where: { eventId: record.id } }), db.reviewBasisVersion.count({ where: { eventId: record.id } })
  ]);
  const messages = executions.length ? await db.message.findMany({ where: { patientId: record.patientId, id: { in: executions.map(e => e.messageId) } }, select: { id: true, text: true } }) : [];
  const basis = record.currentBasis ? basisData(record.currentBasis) : null;
  return { pushDeliveries: await eventPushData(record.id), ...deliveryData(record.emailDelivery, record.mode), id: record.id, patientId: record.patientId, patientName: record.patient.name, publicId: record.patient.publicId, title: record.title, reason: record.reason, mode: record.mode, status: record.status, revision: record.revision, ownerId: record.ownerId, createdAt: record.createdAt.toISOString(), claimedAt: record.claimedAt?.toISOString() ?? null, resolvedAt: record.resolvedAt?.toISOString() ?? null, resolution: record.resolution, resolutionActionId: record.resolutionActionId, ruleId: record.ruleId, checksum: record.definitionChecksum, actions: proposedActionsSchema.parse(record.actions),
    notification, notificationKind: notification?.kind, viewedAt: record.viewedAt?.toISOString() ?? null,
    basis, currentContext: context, stale: !!basis && !!context && basis.context.token !== context.token, receiptCount, basisCount, resolutionMethod: record.resolutionMethod as ResolutionMethod | null,
    receipts: executions.map(e => ({ id: e.id, actionId: e.actionId, basisVersion: e.basis.version, messageId: e.messageId, requestKey: e.requestKey, createdAt: e.createdAt.toISOString(), text: messages.find(m => m.id === e.messageId)?.text ?? "Текст сообщения недоступен" })),
    source: { assignmentId: record.submission.assignmentId, form: publicForm(definition), answers, note: record.submission.note, metric: resultSchema.parse(record.submission.result).metric, createdAt: record.submission.createdAt.toISOString() } };
}
export async function claimReviewEvent(actor: Actor, data: { eventId: string; revision: number }) {
  const record = await ownedEvent(actor, data.eventId); const { actions } = checkedEvent(record);
  return db.$transaction(async tx => {
    const patient = await lockReviewPatient(tx, actor, record.patientId);
    const current = await tx.reviewEvent.findFirstOrThrow({ where: { ...scope(actor), id: record.id } });
    if (current.status === "IN_PROGRESS" && current.ownerId === actor.id && current.currentBasisId) return { revision: current.revision, basisId: current.currentBasisId };
    if (current.status !== "OPEN" || current.revision !== data.revision) throw new AppError(409, "Событие уже изменилось. Обновите данные.");
    const context = await reviewContext(tx, patient, record.definitionChecksum);
    const basis = await createBasis(tx, actor, record.id, context, actions, record.definitionChecksum);
    const claimed = await tx.reviewEvent.updateMany({ where: { ...scope(actor), id: record.id, status: "OPEN", revision: data.revision }, data: { status: "IN_PROGRESS", ownerId: actor.id, claimedAt: new Date(), revision: { increment: 1 } } });
    if (!claimed.count) throw new AppError(409, "Событие уже изменилось. Обновите данные.");
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "review-event.claim", targetId: record.id } });
    await tx.reviewEvent.update({ where: { id: record.id }, data: { currentBasisId: basis.id } });
    return { revision: data.revision + 1, basisId: basis.id };
  });
}
export async function refreshReviewContext(actor: Actor, data: { eventId: string; revision: number; contextToken: string; reviewed: true }) {
  const record = await ownedEvent(actor, data.eventId); const { actions } = checkedEvent(record);
  return db.$transaction(async tx => {
    const patient = await lockReviewPatient(tx, actor, record.patientId);
    const current = await tx.reviewEvent.findFirstOrThrow({ where: { ...scope(actor), id: record.id } });
    if (current.status !== "IN_PROGRESS" || current.ownerId !== actor.id) throw new AppError(409, "Сначала возьмите событие в работу.");
    const context = await reviewContext(tx, patient, record.definitionChecksum);
    if (context.token !== data.contextToken) throw new AppError(409, "Данные снова изменились. Проверьте актуальные сведения.");
    const existing = current.currentBasisId ? await tx.reviewBasisVersion.findUniqueOrThrow({ where: { id: current.currentBasisId } }) : null;
    if (existing?.contextToken === context.token) return { revision: current.revision, basisId: existing.id };
    if (current.revision !== data.revision) throw new AppError(409, "Событие изменилось в другой вкладке. Ваш ввод остаётся здесь.");
    const basis = await createBasis(tx, actor, record.id, context, actions, record.definitionChecksum);
    await tx.reviewEvent.update({ where: { id: record.id }, data: { currentBasisId: basis.id, revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "review-event.context.refresh", targetId: basis.id } });
    return { revision: current.revision + 1, basisId: basis.id };
  });
}
async function freshBasis(tx: Prisma.TransactionClient, actor: Actor, record: { id: string; patientId: string; definitionChecksum: string }, basisId: string) {
  const current = await tx.reviewEvent.findFirstOrThrow({ where: { ...scope(actor), id: record.id }, include: { currentBasis: true } });
  if (current.status !== "IN_PROGRESS" || current.ownerId !== actor.id || !current.currentBasis || current.currentBasisId !== basisId) throw new AppError(409, "Сначала возьмите актуальное событие в работу и проверьте основание.");
  const basis = basisData(current.currentBasis);
  const patient = await tx.patient.findUniqueOrThrow({ where: { id: current.patientId } });
  const context = await reviewContext(tx, patient, record.definitionChecksum);
  if (basis.context.token !== context.token) throw new AppError(409, "Появились новые данные пациента. Проверьте их и обновите основание перед действием.");
  return { current, basis, patient };
}
export async function sendReviewMessage(actor: Actor, data: { eventId: string; revision: number; basisId: string; actionId: string; text: string; requestKey: string; reviewed: true }) {
  const record = await ownedEvent(actor, data.eventId); checkedEvent(record);
  const hash = fingerprint([actor.id, data.eventId, data.basisId, data.actionId, data.text]);
  return db.$transaction(async tx => {
    await lockReviewPatient(tx, actor, record.patientId);
    const repeat = await tx.reviewMessageExecution.findUnique({ where: { requestKey: data.requestKey } });
    if (repeat) { if (repeat.payloadHash !== hash) throw new AppError(409, "Ключ отправки уже использован для другого сообщения."); return { saved: true, executionId: repeat.id }; }
    const { current, basis, patient } = await freshBasis(tx, actor, record, data.basisId);
    if (current.revision !== data.revision) throw new AppError(409, "Событие изменилось в другой вкладке. Обновите его перед отправкой.");
    const action = basis.actions.find(a => a.id === data.actionId);
    if (!action || action.kind !== "CONTACT_PATIENT") throw new AppError(400, "Это предложение не поддерживает отправку сообщения.");
    if (!patient.userId) throw new AppError(409, "Пациент ещё не подключён. Используйте согласованный канал и внесите фактический результат.");
    const message = await tx.message.create({ data: { patientId: patient.id, senderId: actor.id, text: data.text, requestKey: `review-message:${data.requestKey}` } });
    const execution = await tx.reviewMessageExecution.create({ data: { eventId: record.id, basisId: basis.id, actorId: actor.id, actionId: action.id, messageId: message.id, requestKey: data.requestKey, payloadHash: hash } });
    await tx.reviewEvent.update({ where: { id: current.id }, data: { revision: { increment: 1 } } });
    await tx.patient.update({ where: { id: patient.id }, data: { updatedAt: new Date() } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "review-event.message", targetId: execution.id } });
    return { saved: true, executionId: execution.id };
  });
}
export async function resolveReviewEvent(actor: Actor, data: { eventId: string; revision: number; basisId: string; actionId: string; outcome: string; method: ResolutionMethod; requestKey: string; reviewed: true }) {
  const record = await ownedEvent(actor, data.eventId); checkedEvent(record);
  const hash = fingerprint([actor.id, data.eventId, data.basisId, data.actionId, data.method, data.outcome]);
  return db.$transaction(async tx => {
    await lockReviewPatient(tx, actor, record.patientId);
    const stored = await tx.reviewEvent.findFirstOrThrow({ where: { ...scope(actor), id: record.id } });
    if (stored.status === "RESOLVED") {
      if (stored.resolvedById === actor.id && stored.resolutionRequestKey === data.requestKey && stored.resolutionPayloadHash === hash) return { saved: true };
      throw new AppError(409, "Результат уже зафиксирован. Его нельзя незаметно перезаписать.");
    }
    const { current, basis } = await freshBasis(tx, actor, record, data.basisId);
    const action = basis.actions.find(a => a.id === data.actionId);
    if (data.actionId === "declined" ? data.method !== "DECLINED" : !action || !permitsMethod(action.kind, data.method)) throw new AppError(400, "Выберите допустимое действие и способ фиксации результата.");
    if (data.method === "IN_APP_MESSAGE" && !await tx.reviewMessageExecution.count({ where: { eventId: current.id, actionId: data.actionId, actorId: actor.id } })) throw new AppError(409, "Сообщение из этого события ещё не сохранено в переписке. Отправьте его или выберите другой способ результата.");
    const closed = await tx.reviewEvent.updateMany({ where: { ...scope(actor), id: record.id, status: "IN_PROGRESS", ownerId: actor.id, revision: data.revision }, data: { status: "RESOLVED", resolutionActionId: data.actionId, resolution: data.outcome, resolvedAt: new Date(), resolvedById: actor.id, resolutionMethod: data.method, resolutionRequestKey: data.requestKey, resolutionPayloadHash: hash, revision: { increment: 1 } } });
    if (!closed.count) throw new AppError(409, "Сначала возьмите актуальное событие в работу. Результат не сохранён поверх чужого изменения.");
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "review-event.resolve", targetId: record.id } });
    await tx.patientEvent.create({ data: { patientId: record.patientId, kind: "review", title: "Врач зафиксировал результат разбора", detail: record.title } });
    await tx.patient.update({ where: { id: record.patientId }, data: { updatedAt: new Date() } });
    return { saved: true };
  });
}

export async function getReviewBasis(actor: Actor, eventId: string, basisId: string) {
  await ownedEvent(actor, eventId);
  const basis = await db.reviewBasisVersion.findFirst({ where: { id: basisId, eventId } });
  if (!basis) throw new AppError(404, "Версия основания недоступна."); return basisData(basis);
}
export async function getReviewBasisHistory(actor: Actor, eventId: string, cursor?: string): Promise<ReviewBasisHistory> {
  await ownedEvent(actor, eventId);
  if (cursor && !await db.reviewBasisVersion.findFirst({ where: { eventId, id: cursor }, select: { id: true } })) throw new AppError(400, "Обновите историю оснований.");
  const rows = await db.reviewBasisVersion.findMany({ where: { eventId }, orderBy: { version: "desc" }, take: 21, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, version: true, createdAt: true, createdByName: true } });
  return { versions: rows.slice(0, 20).map(r => ({ id: r.id, version: r.version, createdAt: r.createdAt.toISOString(), createdBy: r.createdByName })), nextCursor: rows.length > 20 ? rows[19].id : null };
}
