import { enqueueAssessmentPush } from "@/modules/web-push";
import { z } from "zod";
import { notificationPriority } from "@/lib/assessment-notifications";


import { db } from "@/server/db";
import { AppError, requireDoctor, requirePatientAccess, type Actor } from "@/server/access";
import { AssessmentInputError, assessmentApplies, evaluateAssessment, validateAnswers, type AssessmentAnswers, type AssessmentEvaluation } from "@/modules/clinical";
import type { AssessmentWorkspaceData, FormDefinition } from "@/lib/assessments";
import { fingerprint, permittedDefinition, publicForm, readDefinition } from "./definitions";

export { publishDefinition } from "./definitions";
const answersSchema = z.record(z.string(), z.string());
const evaluationSchema = z.object({ metric: z.object({ label: z.string(), value: z.number(), minimum: z.number(), maximum: z.number(), interpretation: z.string() }) });
const active = ["ASSIGNED", "IN_PROGRESS"] as const;

export async function getAssessmentWorkspace(actor: Actor, patientId: string, cursor?: string, assignmentId?: string, activeOnly=false): Promise<AssessmentWorkspaceData> {
  const patient = await requirePatientAccess(actor, patientId);
  const where = { patientId, ...(assignmentId ? { id: assignmentId } : activeOnly ? {status:{in:[...active]}} : {}) };
  if (cursor && !await db.assessmentAssignment.findFirst({ where: { ...where, id: cursor }, select: { id: true } })) throw new AppError(400, "Страница анкет недоступна. Обновите список.");
  const [records, available] = await Promise.all([
    db.assessmentAssignment.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { definition: true, submission: true } }),
    actor.role === "DOCTOR" ? db.assessmentDefinition.findMany({ where: permittedDefinition(), orderBy: [{ code: "asc" }, { version: "desc" }] }) : Promise.resolve([])
  ]);
  const rows = records.slice(0, 20);
  if (assignmentId && !rows.length) throw new AppError(404, "Назначение недоступно.");
  const definitions = new Map<string, FormDefinition>();
  const register = (record: typeof records[number]["definition"]) => { if (!definitions.has(record.id)) definitions.set(record.id, { id: record.id, checksum: record.checksum, form: publicForm(readDefinition(record)) }); };
  available.forEach(register); rows.forEach(row => register(row.definition));
  // Only the latest published version of each instrument can be newly assigned.
  const latestCodes = new Set<string>(); const assignableDefinitionIds = available.filter(record => { if (latestCodes.has(record.code)) return false; latestCodes.add(record.code); return assessmentApplies(readDefinition(record), patient.birthDate); }).map(record => record.id);
  return {
    definitions: [...definitions.values()], assignableDefinitionIds,
    assignments: rows.map(row => {
      const definition = readDefinition(row.definition);
      const draftVisible = actor.role === (definition.schemaVersion === 3 ? definition.respondent : "PATIENT");
      return { id: row.id, patientId: row.patientId, definitionId: row.definitionId, status: row.status, dueAt: row.dueAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null, cancellationReason: row.cancellationReason,
      answers: draftVisible ? answersSchema.parse(row.draftAnswers) : {}, note: draftVisible ? row.draftNote : "", revision: row.revision,
      submission: row.submission ? { id: row.submission.id, answers: answersSchema.parse(row.submission.answers), note: row.submission.note, metric: evaluationSchema.parse(row.submission.result).metric, createdAt: row.submission.createdAt.toISOString(), ...(actor.role === "DOCTOR" ? { notification: evaluateAssessment(definition, answersSchema.parse(row.submission.answers)).findings.filter(f => f.notification).sort((a, b) => notificationPriority[b.notification!.kind] - notificationPriority[a.notification!.kind])[0]?.notification } : {}) } : null }; }),
    nextCursor: records.length > 20 ? rows.at(-1)!.id : null
  };
}

export async function assignAssessment(actor: Actor, data: { patientId: string; definitionId: string; dueAt?: string | null }) {
  requireDoctor(actor); await requirePatientAccess(actor, data.patientId);
  return db.$transaction(async tx => {
    // Serialize duplicate assignments per patient without a global lock or a queue.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Patient" WHERE id = ${data.patientId} AND "doctorId" = ${actor.id} FOR UPDATE`;
    if (!locked.length) throw new AppError(404, "Пациент недоступен.");
    const record = await tx.assessmentDefinition.findFirst({ where: { id: data.definitionId, ...permittedDefinition() } });
    if (!record) throw new AppError(404, "Проверенное определение анкеты не найдено.");
    const definition = readDefinition(record);
    const patient = await tx.patient.findUniqueOrThrow({ where: { id: data.patientId }, select: { birthDate: true, userId: true } });
    if (!assessmentApplies(definition, patient.birthDate)) throw new AppError(422, "Этот перенос рекомендаций предназначен только для взрослых пациентов от 18 лет.");
    const newer = await tx.assessmentDefinition.count({ where: { code: record.code, version: { gt: record.version }, ...permittedDefinition() } });
    if (newer) throw new AppError(409, "Появилась новая версия анкеты. Обновите список.");
    if (await tx.assessmentAssignment.count({ where: { patientId: data.patientId, definitionCode: record.code, status: { in: [...active] } } })) throw new AppError(409, "Эта анкета уже назначена и ещё не завершена.");
    const assignment = await tx.assessmentAssignment.create({ data: { patientId: data.patientId, definitionId: record.id, definitionCode: record.code, assignedById: actor.id, dueAt: data.dueAt ? new Date(data.dueAt) : null } });
    if (patient.userId && !(definition.schemaVersion === 3 && definition.respondent === "DOCTOR")) await enqueueAssessmentPush(tx, { assignmentId: assignment.id, recipientId: patient.userId, purpose: "ASSIGNED", mode: definition.mode });
    await tx.patient.update({ where: { id: data.patientId }, data: { updatedAt: new Date() } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "assessment.assign", targetId: assignment.id } });
    return { id: assignment.id };
  });
}

async function assignmentFor(actor: Actor, assignmentId: string, patientOnly: boolean) {
  const assignment = await db.assessmentAssignment.findFirst({ where: { id: assignmentId, patient: actor.role === "DOCTOR" ? { doctorId: actor.id } : { userId: actor.id } }, include: { definition: true, patient: { select: { doctorId: true, birthDate: true } }, submission: true } });
  if (!assignment) throw new AppError(404, "Назначение не найдено или недоступно.");
  if (patientOnly) {
    const definition = readDefinition(assignment.definition);
    const respondent = definition.schemaVersion === 3 ? definition.respondent : "PATIENT";
    if (actor.role !== respondent) throw new AppError(403, respondent === "DOCTOR" ? "Эту шкалу заполняет врач после клинической оценки." : "Ответы заполняет пациент.");
  }
  return assignment;
}
function checkedAnswers(definition: ReturnType<typeof readDefinition>, answers: AssessmentAnswers, complete: boolean) {
  try { validateAnswers(definition, answers, complete); }
  catch (error) { if (error instanceof AssessmentInputError) throw new AppError(400, error.message); throw error; }
}

export async function saveAssessmentDraft(actor: Actor, data: { assignmentId: string; revision: number; answers: AssessmentAnswers; note: string }) {
  const assignment = await assignmentFor(actor, data.assignmentId, true);
  const definition = readDefinition(assignment.definition);
  if (!assessmentApplies(definition, assignment.patient.birthDate)) throw new AppError(422, "Инструмент не соответствует возрастной области рекомендаций.");
  checkedAnswers(definition, data.answers, false);
  const result = await db.assessmentAssignment.updateMany({ where: { id: assignment.id, patient: actor.role === "PATIENT" ? { userId: actor.id } : { doctorId: actor.id }, revision: data.revision, status: { in: [...active] } }, data: { draftAnswers: data.answers, draftNote: data.note, status: "IN_PROGRESS", revision: { increment: 1 } } });
  if (!result.count) throw new AppError(409, "Черновик изменён в другой вкладке или анкета закрыта. Сохраните свой текст и обновите данные.");
  return { revision: data.revision + 1 };
}

export async function submitAssessment(actor: Actor, data: { assignmentId: string; revision: number; answers: AssessmentAnswers; note: string; requestKey: string }) {
  const assignment = await assignmentFor(actor, data.assignmentId, true);
  const definition = readDefinition(assignment.definition);
  if (!assessmentApplies(definition, assignment.patient.birthDate)) throw new AppError(422, "Инструмент не соответствует возрастной области рекомендаций.");
  checkedAnswers(definition, data.answers, true);
  const canonicalAnswers = Object.fromEntries(definition.questions.filter(q => data.answers[q.id]).map(q => [q.id, data.answers[q.id]]));
  const payloadHash = fingerprint({ assignmentId: assignment.id, checksum: assignment.definition.checksum, answers: canonicalAnswers, note: data.note });
  const repeat = (stored: { id: string; payloadHash: string; requestKey: string; submittedById: string } | null) => {
    if (stored?.requestKey === data.requestKey && stored.payloadHash === payloadHash && stored.submittedById === actor.id) return { submissionId: stored.id, saved: true as const };
    throw new AppError(409, "Анкета уже отправлена, изменена или закрыта. Повтор не изменил сохранённый результат.");
  };
  if (assignment.submission) return repeat(assignment.submission);
  const result: AssessmentEvaluation = evaluateAssessment(definition, canonicalAnswers);
  try {
    return await db.$transaction(async tx => {
      const updated = await tx.assessmentAssignment.updateMany({ where: { id: assignment.id, patient: actor.role === "PATIENT" ? { userId: actor.id } : { doctorId: actor.id }, revision: data.revision, status: { in: [...active] } }, data: { status: "COMPLETED", revision: { increment: 1 }, completedAt: new Date(), draftAnswers: canonicalAnswers, draftNote: data.note } });
      if (!updated.count) return repeat(await tx.assessmentSubmission.findUnique({ where: { assignmentId: assignment.id } }));
      const submission = await tx.assessmentSubmission.create({ data: { assignmentId: assignment.id, requestKey: data.requestKey, payloadHash, definitionChecksum: assignment.definition.checksum, answers: canonicalAnswers, note: data.note, result, submittedById: actor.id } });
      let primaryEvent: { id: string; priority: number } | undefined;
      for (const finding of result.findings) { const review = await tx.reviewEvent.create({ data: { patientId: assignment.patientId, recipientId: assignment.patient.doctorId, submissionId: submission.id, ruleId: finding.ruleId, definitionChecksum: assignment.definition.checksum, title: finding.title, reason: finding.reason, mode: definition.mode, actions: finding.actions, priority: finding.notification ? notificationPriority[finding.notification.kind] : 0 } }); if (!primaryEvent || review.priority > primaryEvent.priority) primaryEvent = review; }
      if (actor.role === "PATIENT") await enqueueAssessmentPush(tx, { assignmentId: assignment.id, recipientId: assignment.patient.doctorId, purpose: "COMPLETED", eventId: primaryEvent?.id, mode: definition.mode });
      const event = await tx.patientEvent.create({ data: { patientId: assignment.patientId, kind: "assessment", title: actor.role === "DOCTOR" ? "Врач сохранил оценку по шкале" : "Пациент отправил анкету", detail: `${definition.title}, версия ${definition.version}` } });
      await tx.auditEvent.create({ data: { actorId: actor.id, action: "assessment.submit", targetId: submission.id } });
      await tx.patient.update({ where: { id: assignment.patientId }, data: { updatedAt: new Date(), clinicalDataVersion: { increment: 1 } } });
      await tx.$queryRaw`SELECT graphile_worker.add_job('workspace_event', ${JSON.stringify({ eventId: event.id })}::json)`;
      return { submissionId: submission.id, saved: true as const };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return repeat(await db.assessmentSubmission.findUnique({ where: { assignmentId: assignment.id } }));
    throw error;
  }
}

export async function cancelAssessment(actor: Actor, data: { assignmentId: string; revision: number; reason: string }) {
  requireDoctor(actor); const assignment = await assignmentFor(actor, data.assignmentId, false);
  return db.$transaction(async tx => {
    const updated = await tx.assessmentAssignment.updateMany({ where: { id: assignment.id, patient: actor.role === "PATIENT" ? { userId: actor.id } : { doctorId: actor.id }, revision: data.revision, status: { in: [...active] } }, data: { status: "CANCELLED", cancellationReason: data.reason, revision: { increment: 1 } } });
    if (!updated.count) throw new AppError(409, "Анкета уже изменена или завершена. Обновите данные.");
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "assessment.cancel", targetId: assignment.id } });
    await tx.patient.update({ where: { id: assignment.patientId }, data: { updatedAt: new Date() } });
    return { saved: true };
  });
}
