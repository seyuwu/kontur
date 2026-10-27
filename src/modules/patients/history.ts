import { z } from "zod";
import { db } from "@/server/db";
import { AppError, requirePatientAccess, type Actor } from "@/server/access";
import { readDefinition } from "@/modules/assessments/definitions";
import type { HistoryEntry, HistoryPage, HistoryPeriod } from "@/lib/history";
const cursorSchema = z.strictObject({ patientId: z.string(), period: z.enum(["7", "30", "90", "ALL"]), through: z.string().datetime(), createdAt: z.string().datetime(), id: z.string().min(1).max(100), kind: z.enum(["observation", "event", "assessment"]) });
const rank = { observation: 3, assessment: 2, event: 1 };
const metricSchema = z.object({ metric: z.object({ label: z.string(), value: z.number().finite(), minimum: z.number().finite(), maximum: z.number().finite(), interpretation: z.string() }) });
export async function getPatientHistory(actor: Actor, patientId: string, period: HistoryPeriod = "30", encoded?: string): Promise<HistoryPage> {
  await requirePatientAccess(actor, patientId);
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (encoded) { try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))); } catch { throw new AppError(400, "Граница истории недоступна. Вернитесь к последним записям."); }
    if (cursor.patientId !== patientId || cursor.period !== period) throw new AppError(400, "Обновите историю выбранного пациента и периода.");
    const row = cursor.kind === "observation" ? await db.observation.findFirst({ where: { id: cursor.id, patientId }, select: { createdAt: true } }) : cursor.kind === "event" ? await db.patientEvent.findFirst({ where: { id: cursor.id, patientId }, select: { createdAt: true } }) : await db.assessmentSubmission.findFirst({ where: { id: cursor.id, assignment: { patientId } }, select: { createdAt: true } });
    if (!row || row.createdAt.toISOString() !== cursor.createdAt) throw new AppError(400, "Запись на границе истории недоступна. Вернитесь к последним записям.");
  }
  const through = cursor?.through ?? new Date().toISOString();
  const from = period === "ALL" ? undefined : new Date(new Date(through).getTime() - Number(period) * 86400000);
  const window = { lte: new Date(through), ...(from ? { gte: from } : {}) };
  const boundary = (kind: HistoryEntry["kind"]) => !cursor ? {} : { OR: [{ createdAt: { lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }, ...(rank[kind] < rank[cursor.kind] ? [{ createdAt: new Date(cursor.createdAt), id: cursor.id }] : [])] };
  const owner = actor.role === "DOCTOR" ? { doctorId: actor.id } : { userId: actor.id };
  const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];
  const [observations, events, submissions] = await Promise.all([
    db.observation.findMany({ where: { patientId, patient: owner, createdAt: window, ...boundary("observation") }, orderBy, take: 31 }),
    db.patientEvent.findMany({ where: { patientId, patient: owner, kind: { notIn: ["checkin", "assessment"] }, createdAt: window, ...boundary("event") }, orderBy, take: 31 }),
    db.assessmentSubmission.findMany({ where: { assignment: { patientId, patient: owner }, createdAt: window, ...boundary("assessment") }, include: { assignment: { include: { definition: true } } }, orderBy, take: 31 })
  ]);
  const merged: HistoryEntry[] = [
    ...observations.map(o => ({ id: o.id, kind: "observation" as const, createdAt: o.createdAt.toISOString(), title: "Самоотчёт пациента", detail: o.note, observation: { id: o.id, score: o.score, note: o.note, needsContact: o.needsContact, acknowledgedAt: o.acknowledgedAt?.toISOString() ?? null, createdAt: o.createdAt.toISOString() } })),
    ...events.map(e => ({ id: e.id, kind: "event" as const, createdAt: e.createdAt.toISOString(), title: e.title, detail: e.detail })),
    ...submissions.map(s => { const def = readDefinition(s.assignment.definition); return { id: s.id, kind: "assessment" as const, createdAt: s.createdAt.toISOString(), title: def.title, detail: s.note, assessment: { code: def.code, version: def.version, checksum: s.definitionChecksum, mode: def.mode, metric: metricSchema.parse(s.result).metric } }; })
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (a.id === b.id ? 0 : b.id > a.id ? 1 : -1) || rank[b.kind] - rank[a.kind]);
  const entries = merged.slice(0, 30); const last = entries.at(-1);
  return { entries, through, nextCursor: merged.length > 30 && last ? Buffer.from(JSON.stringify({ patientId, period, through, createdAt: last.createdAt, id: last.id, kind: last.kind })).toString("base64url") : null };
}
