import {medicationTaskState} from "./medications";
import { readAppointment, visitDate, visitDateValue, visitTimeValue } from "@/lib/appointment";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { AppError, requireDoctor, requirePatientAccess, type Actor } from "@/server/access";
import type { Prisma, Patient } from "@/generated/prisma/client";
import type { CareWorkspace, CarePlanData, CareHistory } from "@/lib/care";
import { fingerprint, readDefinition } from "@/modules/assessments/definitions";
import { careContentSchema, careReportSchema, medicationSchema, type CareContent, type CareTaskInput } from "./contract";
import { enqueuePatientReminder } from "@/modules/web-push/reminders";
import {moscowDate} from "@/lib/assessment-deadline";

type Tx = Prisma.TransactionClient;
const owner = (actor: Actor) => actor.role === "DOCTOR" ? { doctorId: actor.id } : { userId: actor.id };
const contextToken = (patient: Patient) => fingerprint([patient.id, patient.doctorId, patient.clinicalDataVersion, patient.currentPlanId, patient.nextVisit, patient.nextVisitHasTime, patient.nextVisitRevision]);
const taskHash = ({ id: _id, ...content }: CareTaskInput) => fingerprint(content);
async function lock(tx: Tx, actor: Actor, patientId: string) {
  const rows = actor.role === "DOCTOR"
    ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Patient" WHERE id = ${patientId} AND "doctorId" = ${actor.id} FOR UPDATE`
    : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Patient" WHERE id = ${patientId} AND "userId" = ${actor.id} FOR UPDATE`;
  if (!rows.length) throw new AppError(404, "Карточка недоступна.");
  return tx.patient.findUniqueOrThrow({ where: { id: patientId } });
}
async function planData(actor: Actor, patientId: string, versionId: string, currentId: string | null): Promise<CarePlanData> {
  const plan = await db.carePlanVersion.findFirst({ where: { id: versionId, patientId, patient: owner(actor) }, include: { patient:{select:{userId:true}}, tasks: { orderBy: { position: "asc" }, include: { task: { include: { assignment: { include: { definition: true } } } } } } } });
  if (!plan) throw new AppError(404, "Версия плана недоступна.");
  const reports = await Promise.all(plan.tasks.map(t => db.careTaskReport.findFirst({ where: { taskId: t.taskId, planVersion: { patientId, version: { lte: plan.version } } }, orderBy: { revision: "desc" }, include: { planVersion: { select: { version: true } } } })));
  const medicationStates=await Promise.all(plan.tasks.map(async ({task})=>task.medication && medicationSchema.parse(task.medication).regimen ? medicationTaskState(task.id,plan.patient.userId,plan.version) : null));
  return { id: plan.id, version: plan.version, goal: plan.goal, instructions: plan.instructions, nextContactDate: visitDate(plan), appointment: readAppointment(plan.appointment), confirmedAt: plan.confirmedAt.toISOString(), confirmedBy: plan.confirmedByName, isCurrent: plan.id === currentId, ...(actor.role === "DOCTOR" ? { clinicalProfileVersionId: plan.clinicalProfileVersionId } : {}),
    tasks: plan.tasks.map(({ task },index) => { const report = reports.find(r => r?.taskId === task.id); const a = task.assignment; if (a) readDefinition(a.definition);
      return { ...medicationStates[index], id: task.id, kind: task.kind, title: task.title, details: task.details, dueDate: task.dueDate, assignmentId: task.assignmentId, ...(task.repeat === "DAILY" ? { repeat: "DAILY" as const } : {}), ...(task.startDate ? {startDate:task.startDate} : {}), ...(task.time ? {time:task.time} : {}), ...(task.medication ? {medication:medicationSchema.parse(task.medication)} : {}),
        assignment: a ? { title: a.definition.title, mode: a.definition.mode, version: a.definition.version, status: a.status } : null,
        report: report ? { id: report.id, revision: report.revision, state: report.state, note: report.note, createdAt: report.createdAt.toISOString(), planVersion: report.planVersion.version } : null }; }) };
}
export async function getCareWorkspace(actor: Actor, patientId: string): Promise<CareWorkspace> {
  const patient = await requirePatientAccess(actor, patientId);
  const current = patient.currentPlanId ? await planData(actor, patientId, patient.currentPlanId, patient.currentPlanId) : null;
  if (actor.role !== "DOCTOR") return { current };
  const draft = await db.carePlanDraft.findUnique({ where: { patientId } });
  const content = draft?.status === "DRAFT" ? careContentSchema.parse(draft.content) : null;
  const selected = [...(content?.tasks ?? []), ...(current?.tasks ?? [])].flatMap(t => t.assignmentId ? [t.assignmentId] : []);
  const [recent, linked] = await Promise.all([
    db.assessmentAssignment.findMany({ where: { patientId, status: { in: ["ASSIGNED", "IN_PROGRESS"] } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, include: { definition: true } }),
    db.assessmentAssignment.findMany({ where: { patientId, id: { in: selected } }, take: 16, include: { definition: true } })
  ]);
  const assignments = [...new Map([...recent, ...linked].map(a => [a.id, a])).values()];
  const token = contextToken(patient);
  return { current, nextAppointment:patient.nextVisit && patient.nextVisitHasTime ? {at:`${visitDateValue(patient.nextVisit.toISOString())}T${visitTimeValue(patient.nextVisit.toISOString())}`,format:"UNSPECIFIED" as const,location:"",timezone:"Europe/Moscow" as const}:null, nextVisitDate: visitDateValue(patient.nextVisit?.toISOString()??null)||null, context: { token, clinicalDataVersion: patient.clinicalDataVersion, changesSincePlan: !!current && (await db.carePlanVersion.findUniqueOrThrow({ where: { id: current.id }, select: { clinicalDataVersion: true } })).clinicalDataVersion !== patient.clinicalDataVersion },
    draftRevision: draft?.revision ?? 0, draft: content && draft ? { id: draft.id, revision: draft.revision, content, basisToken: draft.basisToken, updatedAt: draft.updatedAt.toISOString(), stale: draft.basisToken !== token } : null,
    availableAssignments: assignments.map(a => { readDefinition(a.definition); return { id: a.id, title: a.definition.title, version: a.definition.version, mode: a.definition.mode, status: a.status }; }) };
}
/** Appointment update: preserves medication tasks, reports and any doctor's draft. */
export async function scheduleCareVisit(actor: Actor, data: { patientId: string; date: string | null; time?:string|null; expectedPlanId: string | null; expectedNextVisit: string | null; requestKey: string }) {
  requireDoctor(actor);
  return db.$transaction(async tx => {
    const patient = await lock(tx, actor, data.patientId);
    const hash = fingerprint(["schedule-visit", actor.id, data]);
    const existing = await tx.carePlanVersion.findUnique({ where: { confirmationKey: data.requestKey } });
    if (existing) {
      if (existing.patientId !== patient.id || existing.confirmationHash !== hash) throw new AppError(409, "Ключ сохранения уже использован.");
      return { saved: true };
    }
    const nextVisit = data.date ? new Date(`${data.date}T${data.time ?? "12:00"}:00+03:00`) : null;
    if ((patient.nextVisit?.toISOString() ?? null) === (nextVisit?.toISOString() ?? null) && patient.nextVisitHasTime === !!(data.date && data.time)) return { saved: true };
    if (patient.currentPlanId !== data.expectedPlanId || (patient.nextVisit?.toISOString() ?? null) !== data.expectedNextVisit) throw new AppError(409, "Приём или план уже изменён. Откройте окно заново.");
    let planId = patient.currentPlanId;
    if (planId) {
      const previous = await tx.carePlanVersion.findFirstOrThrow({ where: { id: planId, patientId: patient.id }, include: { tasks: true } });
      const existingAppointment=readAppointment(previous.appointment);
      const latest = await tx.carePlanVersion.findFirst({ where: { patientId: patient.id }, orderBy: { version: "desc" }, select: { version: true } });
      const plan = await tx.carePlanVersion.create({ data: {
        patientId: patient.id, version: (latest?.version ?? 0) + 1, goal: previous.goal, instructions: previous.instructions,
        nextContactDate: data.date, ...(data.date && data.time ? {appointment:{...(existingAppointment??{format:"UNSPECIFIED",location:"",timezone:"Europe/Moscow"}),at:`${data.date}T${data.time}`}} : {}), basisToken: previous.basisToken, clinicalDataVersion: previous.clinicalDataVersion,
        previousPlanId: previous.id, clinicalProfileVersionId: previous.clinicalProfileVersionId,
        confirmedById: actor.id, confirmedByName: actor.name, confirmationKey: data.requestKey, confirmationHash: hash,
        tasks: { create: previous.tasks.map(task => ({ taskId: task.taskId, position: task.position })) }
      } });
      planId = plan.id;
    }
    await tx.patient.update({ where: { id: patient.id }, data: { nextVisit, nextVisitHasTime:!!(data.date && data.time),nextVisitRevision:{increment:1},currentPlanId: planId } });
    if (patient.userId) await enqueuePatientReminder(tx,{key:`visit:${patient.id}:${patient.nextVisitRevision+1}:${patient.userId}`,patientId:patient.id,recipientId:patient.userId,kind:nextVisit?"APPOINTMENT":"APPOINTMENT_CANCELLED",dueAt:nextVisit??new Date()});
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "care.appointment.schedule", targetId: patient.id } });
    const event = await tx.patientEvent.create({ data: { patientId: patient.id, kind: "care", title: data.date ? "Назначен следующий приём" : "Дата приёма отменена", detail: data.date ? `${data.date}${data.time ? ` ${data.time} МСК` : ""}` : "Приём отменён" } });
    await tx.$queryRaw`SELECT graphile_worker.add_job('workspace_event', ${JSON.stringify({ eventId: event.id })}::json)`;
    return { saved: true };
  });
}
export async function getCareVersion(actor: Actor, patientId: string, versionId: string) { const patient = await requirePatientAccess(actor, patientId); return planData(actor, patientId, versionId, patient.currentPlanId); }
export async function getCareHistory(actor: Actor, patientId: string, cursor?: string): Promise<CareHistory> {
  await requirePatientAccess(actor, patientId);
  if (cursor && !await db.carePlanVersion.findFirst({ where: { id: cursor, patientId, patient: owner(actor) }, select: { id: true } })) throw new AppError(400, "Обновите историю плана.");
  const records = await db.carePlanVersion.findMany({ where: { patientId, patient: owner(actor) }, orderBy: { version: "desc" }, take: 21, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, version: true, goal: true, nextContactDate: true, confirmedAt: true, confirmedByName: true } });
  return { versions: records.slice(0, 20).map(p => ({ id: p.id, version: p.version, goal: p.goal, nextContactDate: p.nextContactDate, confirmedAt: p.confirmedAt.toISOString(), confirmedBy: p.confirmedByName })), nextCursor: records.length > 20 ? records[19].id : null };
}
async function normalizeTasks(tx: Tx, patientId: string, content: CareContent) {
  const tasks = await tx.careTask.findMany({ where: { id: { in: content.tasks.map(t => t.id) } } });
  return { ...content, tasks: content.tasks.map(task => { const stored = tasks.find(t => t.id === task.id); if (!stored) return task;
    if (stored.patientId !== patientId) throw new AppError(404, "Задача недоступна.");
    return stored.contentHash === taskHash(task) ? task : { ...task, id: randomUUID() }; }) };
}
export async function saveCareDraft(actor: Actor, data: { patientId: string; revision: number; content: CareContent; basisToken: string; reviewed?: true }) {
  requireDoctor(actor);
  return db.$transaction(async tx => {
    const patient = await lock(tx, actor, data.patientId); const previous = await tx.carePlanDraft.findUnique({ where: { patientId: patient.id } });
    if ((previous?.revision ?? 0) !== data.revision) throw new AppError(409, "Черновик изменён в другой вкладке. Ваш текст остаётся здесь; откройте сохранённую версию перед продолжением.");
    if (data.reviewed && data.basisToken !== contextToken(patient)) throw new AppError(409, "Данные снова изменились. Просмотрите новые ответы и повторите проверку.");
    const content = await normalizeTasks(tx, patient.id, careContentSchema.parse(data.content));
    const basisToken = previous?.status === "DRAFT" && !data.reviewed ? previous.basisToken : data.basisToken;
    const draft = await tx.carePlanDraft.upsert({ where: { patientId: patient.id }, create: { patientId: patient.id, content, basisToken, updatedById: actor.id }, update: { content, basisToken, status: "DRAFT", revision: { increment: 1 }, updatedById: actor.id } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: data.reviewed ? "care.draft.rebase" : "care.draft.save", targetId: draft.id } });
    return { id: draft.id, revision: draft.revision, content, basisToken };
  });
}
export async function discardCareDraft(actor: Actor, data: { patientId: string; revision: number }) {
  requireDoctor(actor);
  return db.$transaction(async tx => { await lock(tx, actor, data.patientId); const changed = await tx.carePlanDraft.updateMany({ where: { patientId: data.patientId, status: "DRAFT", revision: data.revision }, data: { status: "DISCARDED", revision: { increment: 1 } } });
    if (!changed.count) throw new AppError(409, "Черновик уже изменён. Обновите данные.");
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "care.draft.discard", targetId: data.patientId } }); return { saved: true }; });
}
export async function confirmCarePlan(actor: Actor, data: { patientId: string; draftId: string; revision: number; requestKey: string; reviewed: true }) {
  requireDoctor(actor);
  return db.$transaction(async tx => {
    const patient = await lock(tx, actor, data.patientId); const hash = fingerprint([actor.id, data.patientId, data.draftId, data.revision]);
    const existing = await tx.carePlanVersion.findUnique({ where: { confirmationKey: data.requestKey } });
    if (existing) { if (existing.confirmationHash !== hash) throw new AppError(409, "Ключ подтверждения уже использован."); return { id: existing.id, version: existing.version }; }
    const draft = await tx.carePlanDraft.findUnique({ where: { patientId: patient.id } });
    if (!draft || draft.id !== data.draftId || draft.status !== "DRAFT" || draft.revision !== data.revision) throw new AppError(409, "Черновик изменён. Сохраните и проверьте актуальную версию.");
    if (draft.basisToken !== contextToken(patient)) throw new AppError(409, "Появились новые данные пациента или изменился план. Просмотрите изменения и подтвердите их проверку.");
    const content = careContentSchema.parse(draft.content);
    for (const task of content.tasks) if (task.assignmentId) {
      const assignment = await tx.assessmentAssignment.findFirst({ where: { id: task.assignmentId, patientId: patient.id }, include: { definition: true } });
      if (!assignment || !["ASSIGNED", "IN_PROGRESS"].includes(assignment.status)) throw new AppError(409, "Анкета в плане уже закрыта или недоступна. Обновите задачи.");
      readDefinition(assignment.definition);
    }
    const previous = await tx.carePlanVersion.findFirst({ where: { patientId: patient.id }, orderBy: { version: "desc" }, select: { version: true } });
    const plan = await tx.carePlanVersion.create({ data: { patientId: patient.id, version: (previous?.version ?? 0) + 1, goal: content.goal, instructions: content.instructions, nextContactDate: content.nextContactDate, ...(content.appointment ? { appointment: content.appointment } : {}), basisToken: draft.basisToken, clinicalDataVersion: patient.clinicalDataVersion, previousPlanId: patient.currentPlanId, confirmedById: actor.id, confirmedByName: actor.name, clinicalProfileVersionId: patient.currentClinicalProfileId, confirmationKey: data.requestKey, confirmationHash: hash } });
    for (const [position, task] of content.tasks.entries()) {
      const stored = await tx.careTask.findUnique({ where: { id: task.id } });
      if (stored && (stored.patientId !== patient.id || stored.contentHash !== taskHash(task))) throw new AppError(409, "Содержание задачи изменилось. Сохраните черновик ещё раз.");
      if (!stored) await tx.careTask.create({ data: { ...task, patientId: patient.id, contentHash: taskHash(task) } });
      await tx.carePlanTask.create({ data: { planId: plan.id, taskId: task.id, position } });
    }
    await tx.carePlanDraft.update({ where: { id: draft.id }, data: { status: "PUBLISHED", revision: { increment: 1 } } });
    const nextVisit = content.appointment ? new Date(`${content.appointment.at}:00+03:00`) : content.nextContactDate ? (patient.nextVisit && visitDateValue(patient.nextVisit.toISOString())===content.nextContactDate ? patient.nextVisit : new Date(`${content.nextContactDate}T12:00:00+03:00`)) : null;
    const hasTime = !!content.appointment || (!!nextVisit && nextVisit.getTime()===patient.nextVisit?.getTime() && patient.nextVisitHasTime);
    const visitChanged = (nextVisit?.getTime()??null)!==(patient.nextVisit?.getTime()??null) || hasTime!==patient.nextVisitHasTime;
    await tx.patient.update({ where: { id: patient.id }, data: { currentPlanId: plan.id, nextVisit, nextVisitHasTime:hasTime,...(visitChanged?{nextVisitRevision:{increment:1}}:{}) } });
    if(visitChanged && patient.userId)await enqueuePatientReminder(tx,{key:`visit:${patient.id}:${patient.nextVisitRevision+1}:${patient.userId}`,patientId:patient.id,recipientId:patient.userId,kind:nextVisit?"APPOINTMENT":"APPOINTMENT_CANCELLED",dueAt:nextVisit??new Date()});
    if(patient.userId && !visitChanged)await enqueuePatientReminder(tx,{key:`plan:${plan.id}`,patientId:patient.id,recipientId:patient.userId,kind:"PLAN",planId:plan.id,dueAt:new Date()});
    const event = await tx.patientEvent.create({ data: { patientId: patient.id, kind: "care", title: `Подтверждён план наблюдения · версия ${plan.version}`, detail: content.goal } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "care.confirm", targetId: plan.id } });
    await tx.$queryRaw`SELECT graphile_worker.add_job('workspace_event', ${JSON.stringify({ eventId: event.id })}::json)`;
    return { id: plan.id, version: plan.version };
  });
}
export async function reportCareTask(actor: Actor, data: { patientId: string; planVersionId: string; taskId: string; revision: number; requestKey: string; state: "DONE" | "NOT_DONE" | "NEEDS_HELP"; note: string }) {
  if (actor.role !== "PATIENT") throw new AppError(403, "Отметку оставляет пациент.");
  const report = careReportSchema.parse({ state: data.state, note: data.note });
  return db.$transaction(async tx => {
    const patient = await lock(tx, actor, data.patientId); const hash = fingerprint([actor.id, data.patientId, data.planVersionId, data.taskId, data.revision, report]);
    const existing = await tx.careTaskReport.findUnique({ where: { requestKey: data.requestKey } });
    if (existing) { if (existing.payloadHash !== hash) throw new AppError(409, "Ключ отметки уже использован."); return { saved: true }; }
    if (patient.currentPlanId !== data.planVersionId) throw new AppError(409, "Врач обновил план. Откройте действующую версию перед отправкой отметки.");
    const link = await tx.carePlanTask.findUnique({ where: { planId_taskId: { planId: data.planVersionId, taskId: data.taskId } }, include: { task: true, plan: true } });
    if (!link || link.task.patientId !== patient.id) throw new AppError(404, "Задача недоступна.");
    if(link.task.medication&&medicationSchema.parse(link.task.medication).regimen)throw new AppError(400,"Отметьте конкретный приём лекарства.");
    if (link.task.repeat) throw new AppError(400, "Для ежедневной задачи используйте отметку за конкретный день.");
    if(link.task.kind==="MEDICATION"&&link.task.startDate&&link.task.startDate>moscowDate())throw new AppError(409,"Приём запланирован на будущую дату.");
    if (link.task.kind === "ASSESSMENT" && report.state !== "NEEDS_HELP") throw new AppError(400, "Выполнение анкеты определяется отправкой ответов.");
    const last = await tx.careTaskReport.findFirst({ where: { taskId: data.taskId }, orderBy: { revision: "desc" } });
    if ((last?.revision ?? 0) !== data.revision) throw new AppError(409, "Отметка уже изменилась. Обновите план и проверьте сохранённый ответ.");
    const stored = await tx.careTaskReport.create({ data: { taskId: data.taskId, planVersionId: data.planVersionId, actorId: actor.id, revision: data.revision + 1, ...report, requestKey: data.requestKey, payloadHash: hash } });
    if (report.state === "NEEDS_HELP") await tx.message.create({ data: { patientId: patient.id, senderId: actor.id, requestKey: `care-report:${stored.id}`, text: `Вопрос по плану наблюдения, версия ${link.plan.version}.\nЗадача: ${link.task.title}\n\n${report.note}` } });
    await tx.patient.update({ where: { id: patient.id }, data: { clinicalDataVersion: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "care.task.report", targetId: stored.id } });
    const event = await tx.patientEvent.create({ data: { patientId: patient.id, kind: "care-report", title: report.state === "NEEDS_HELP" ? "Вопрос пациента по плану" : "Самоотчёт по задаче плана", detail: link.task.title } });
    await tx.$queryRaw`SELECT graphile_worker.add_job('workspace_event', ${JSON.stringify({ eventId: event.id })}::json)`;
    return { saved: true };
  });
}
