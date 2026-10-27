import {medicationSchema} from "@/modules/care/contract";
import { z } from "zod";
import { AppError, requirePatientAccess, type Actor } from "@/server/access";
import { fingerprint } from "@/modules/assessments/definitions";
import { calendarDay, shiftDay, dailyInput, dailyStates } from "./contract";
import { db, lockFollowUp, followUpEvent } from "./shared";
import type { DailyJournal } from "@/lib/follow-up";
export async function dailyJournal(actor: Actor, patientId: string, planVersionId?: string): Promise<DailyJournal> {
  const patient = await requirePatientAccess(actor, patientId); const id = planVersionId ?? patient.currentPlanId; const today = calendarDay();
  if (!id) return { today, planVersionId: null, isCurrent: false, tasks: [] };
  const plan = await db.carePlanVersion.findFirst({ where: { id, patientId }, include: { tasks: { where: { task: { repeat: "DAILY" } }, orderBy: { position: "asc" }, include: { task: true } } } });
  if (!plan) throw new AppError(404, "План недоступен.");
  plan.tasks=plan.tasks.filter(t=>!t.task.medication||!medicationSchema.parse(t.task.medication).regimen);
  const next = await db.carePlanVersion.findFirst({ where: { patientId, version: { gt: plan.version } }, orderBy: { version: "asc" }, select: { confirmedAt: true } });
  const until = next ? [today, calendarDay(next.confirmedAt)].sort()[0] : today; const from = shiftDay(until, -13); const ids = plan.tasks.map(t => t.taskId);
  type Row = { id: string; taskId: string; date: string; revision: number; state: string; note: string; needsContact: boolean; planVersion: number };
  const rows = ids.length ? await db.$queryRaw<Row[]>`SELECT DISTINCT ON (r."taskId", r.date) r.id, r."taskId", r.date, r.revision, r.state, r.note, r."needsContact", p.version AS "planVersion" FROM "CareDailyReport" r JOIN "CarePlanVersion" p ON p.id = r."planVersionId" WHERE r."taskId" = ANY(${ids}::text[]) AND r.date >= ${from} AND r.date <= ${until} AND p."patientId" = ${patientId} AND p.version <= ${plan.version} ORDER BY r."taskId", r.date, r.revision DESC` : [];
  const first = await Promise.all(ids.map(taskId => db.carePlanTask.findFirst({ where: { taskId }, orderBy: { plan: { version: "asc" } }, select: { taskId: true, plan: { select: { confirmedAt: true } } } })));
  return { today, planVersionId: plan.id, isCurrent: plan.id === patient.currentPlanId, tasks: plan.tasks.map(({ task }) => {
    const started = [calendarDay(first.find(f => f?.taskId === task.id)!.plan.confirmedAt),task.startDate ?? ""].sort().at(-1)!; const start = [started, from].sort().at(-1)!; const end = task.dueDate ? [until, task.dueDate].sort()[0] : until;
    const days = []; for (let day = start; day <= end; day = shiftDay(day, 1)) { const row = rows.find(r => r.taskId === task.id && r.date === day); days.push({ date: day, report: row ? { id: row.id, revision: row.revision, state: z.enum(dailyStates).parse(row.state), note: row.note, needsContact: row.needsContact, planVersion: row.planVersion } : null }); }
    return { id: task.id, title: task.title, details: task.details, canReport: plan.id === patient.currentPlanId && today >= started && (!task.dueDate || today <= task.dueDate), days };
  }) };
}
export async function reportDaily(actor: Actor, data: z.infer<typeof dailyInput>) {
  if (actor.role !== "PATIENT") throw new AppError(403, "Самоотчёт заполняет пациент.");
  return db.$transaction(async tx => {
    const patient = await lockFollowUp(tx, actor, data.patientId); const hash = fingerprint([actor.id, data]);
    const repeat = await tx.careDailyReport.findUnique({ where: { requestKey: data.requestKey } });
    if (repeat) { if (repeat.payloadHash !== hash) throw new AppError(409, "Ключ отметки уже использован."); return { saved: true }; }
    if (data.date !== calendarDay()) throw new AppError(409, "День изменился. Откройте сегодняшние задачи; прошлые отчёты сохранены в истории.");
    if (patient.currentPlanId !== data.planVersionId) throw new AppError(409, "Врач изменил план. Проверьте действующую версию.");
    const link = await tx.carePlanTask.findUnique({ where: { planId_taskId: { planId: data.planVersionId, taskId: data.taskId } }, include: { task: true, plan: true } });
    if (!link || link.task.patientId !== patient.id || link.task.repeat !== "DAILY") throw new AppError(404, "Ежедневная задача недоступна.");
    if(link.task.medication&&medicationSchema.parse(link.task.medication).regimen)throw new AppError(400,"Отметьте конкретный приём в назначении лекарства.");
    if ((link.task.dueDate && data.date > link.task.dueDate) || (link.task.startDate && data.date<link.task.startDate) || data.date < calendarDay(link.plan.confirmedAt)) throw new AppError(409, "Эта задача не действует в выбранный день.");
    const previous = await tx.careDailyReport.findFirst({ where: { taskId: data.taskId, date: data.date }, orderBy: { revision: "desc" } });
    if ((previous?.revision ?? 0) !== data.revision) throw new AppError(409, "Отметка уже изменилась в другой вкладке. Обновите журнал перед исправлением.");
    const row = await tx.careDailyReport.create({ data: { taskId: data.taskId, planVersionId: data.planVersionId, date: data.date, revision: data.revision + 1, state: data.state, note: data.note, needsContact: data.needsContact, actorId: actor.id, requestKey: data.requestKey, payloadHash: hash } });
    if (data.needsContact) await tx.message.create({ data: { patientId: patient.id, senderId: actor.id, requestKey: `daily:${row.id}`, text: `Вопрос по ежедневной задаче, план v${link.plan.version}.\n${link.task.title}\n\n${data.note}` } });
    await followUpEvent(tx, actor, patient.id, "daily.report", "Ежедневная отметка по плану", link.task.title, row.id); return { saved: true };
  });
}
