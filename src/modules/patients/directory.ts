import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { AppError, requireDoctor, type Actor } from "@/server/access";
import type { Prisma } from "@/generated/prisma/client";
import type { DirectoryData, DirectoryQuery } from "@/lib/patients";

export const directoryQuerySchema = z.object({ q: z.string().trim().max(120).default(""), filter: z.enum(["all", "attention", "pending", "messages"]).default("all"), cursor: z.string().min(1).max(800).optional() });
const cursorSchema = z.strictObject({ scope: z.string().length(64), id: z.string().min(1).max(100), at: z.string().datetime(), attention: z.boolean(), direction: z.enum(["before", "after"]), page: z.number().int().min(1).max(1000000) });
const orderBy = [{ updatedAt: "desc" }, { id: "desc" }] as const;
export const readEtag = (value: unknown) => `W/"${createHash("sha256").update(JSON.stringify(value)).digest("hex")}"`;

export async function getPatientDirectory(actor: Actor, input: DirectoryQuery): Promise<DirectoryData> {
  requireDoctor(actor); const query = directoryQuerySchema.parse(input);
  const scope = createHash("sha256").update(JSON.stringify([actor.id, query.q.toLocaleLowerCase("ru"), query.filter, process.env.DEMO_MODE])).digest("hex");
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (query.cursor) {
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"))); }
    catch { throw new AppError(400, "Страница списка недоступна. Вернитесь к началу списка."); }
    if (cursor.scope !== scope) throw new AppError(400, "Поиск или фильтр изменился. Вернитесь к началу списка.");
  }
  const unread = { senderId: { not: actor.id }, readAt: null };
  const contact = { needsContact: true, acknowledgedAt: null };
  const reviews: Prisma.ReviewEventWhereInput = { recipientId: actor.id, viewedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] }, ...(process.env.DEMO_MODE === "true" ? {} : { mode: "CLINICAL" }) };
  const attention: Prisma.PatientWhereInput = { OR: [{ observations: { some: contact } }, { reviewEvents: { some: reviews } }] };
  const owner: Prisma.PatientWhereInput = { doctorId: actor.id };
  // Escape LIKE metacharacters: the search field searches literal text.
  const text = query.q.replace(/[\\%_]/g, "\\$&");
  const search: Prisma.PatientWhereInput = text ? { OR: [{ name: { contains: text, mode: "insensitive" } }, { publicId: { contains: text, mode: "insensitive" } }] } : {};
  const filter: Prisma.PatientWhereInput = query.filter === "attention" ? attention : query.filter === "pending" ? { userId: null } : query.filter === "messages" ? { messages: { some: unread } } : {};
  const base: Prisma.PatientWhereInput = { AND: [owner, search, filter] };
  const backwards = cursor?.direction === "before";
  const page = cursor?.page ?? 1;
  const boundary: Prisma.PatientWhereInput = cursor ? { OR: [{ updatedAt: backwards ? { gt: new Date(cursor.at) } : { lt: new Date(cursor.at) } }, { updatedAt: new Date(cursor.at), id: backwards ? { gt: cursor.id } : { lt: cursor.id } }] } : {};
  const select = {
    id: true, publicId: true, name: true, birthDate: true, userId: true, nextVisit: true, nextVisitHasTime:true, updatedAt: true,
    observations: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { createdAt: true } },
    _count: { select: { observations: { where: contact }, messages: { where: unread }, reviewEvents: { where: reviews } } }
  } satisfies Prisma.PatientSelect;
  // Two ordered groups preserve attention-first ordering without loading all patient cards.
  const getRows = async () => {
    const records: Prisma.PatientGetPayload<{ select: typeof select }>[] = [];
    for (const group of backwards ? [false, true] : [true, false]) {
      if (cursor && (backwards ? cursor.attention && !group : !cursor.attention && group)) continue;
      const rows = await db.patient.findMany({ where: { AND: [base, group ? attention : { NOT: attention }, cursor && group === cursor.attention ? boundary : {}] }, select, orderBy: backwards ? [{ updatedAt: "asc" }, { id: "asc" }] : [...orderBy], take: 21 - records.length });
      records.push(...rows); if (records.length >= 21) break;
    }
    return records;
  };
  const [records, matchedTotal, all, attentionCount, pending, unreadMessages, contactRequests, upcoming, linkRequests] = await Promise.all([
    getRows(), db.patient.count({ where: base }), db.patient.count({ where: owner }),
    db.patient.count({ where: { AND: [owner, attention] } }), db.patient.count({ where: { ...owner, userId: null } }),
    db.message.count({ where: { ...unread, patient: owner } }), db.patient.count({ where: { ...owner, observations: { some: contact } } }),
    db.patient.findMany({ where: { ...owner, nextVisit: { not: null } }, orderBy: [{ nextVisit: "asc" }, { id: "asc" }], take: 4, select: { id: true, name: true, nextVisit: true,nextVisitHasTime:true } }),
    db.linkRequest.findMany({ where: { status: "PENDING", invitation: { patient: owner, consumedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 20,
      select: { id: true, createdAt: true, user: { select: { name: true, email: true } }, invitation: { select: { patient: { select: { id: true, name: true, publicId: true } } } } } })
  ]);
  const rows = records.slice(0, 20); if (backwards) rows.reverse();
  const encode = (row: typeof rows[number], direction: "before" | "after", targetPage: number) => Buffer.from(JSON.stringify({ scope, id: row.id, at: row.updatedAt.toISOString(), attention: row._count.observations + row._count.reviewEvents > 0, direction, page: targetPage })).toString("base64url");
  const first = rows[0], last = rows.at(-1);
  return {
    actor, demo: process.env.DEMO_MODE === "true", page, matchedTotal, counts: { all, attention: attentionCount, pending, unreadMessages, contactRequests },
    patients: rows.map(row => ({ id: row.id, publicId: row.publicId, name: row.name, birthDate: row.birthDate.toISOString(), userId: row.userId, nextVisit: row.nextVisit?.toISOString() ?? null,nextVisitHasTime:row.nextVisitHasTime, updatedAt: row.updatedAt.toISOString(), lastObservationAt: row.observations[0]?.createdAt.toISOString() ?? null, contactRequests: row._count.observations, unreadMessages: row._count.messages, reviewEvents: row._count.reviewEvents })),
    nextCursor: last && (backwards || records.length > 20) ? encode(last, "after", page + 1) : null,
    previousCursor: first && page > 1 && (!backwards || records.length > 20) ? encode(first, "before", page - 1) : null,
    upcoming: upcoming.map(row => ({ ...row, nextVisit: row.nextVisit!.toISOString() })),
    linkRequests: linkRequests.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }))
  };
}
