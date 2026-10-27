import { z } from "zod";
import { retryReviewEmail } from "@/modules/notifications";
import { requireActor, checkOrigin, errorResponse, AppError } from "@/server/access";
import { viewAssessmentResult, listReviewEvents, getReviewEvent, claimReviewEvent, resolveReviewEvent, refreshReviewContext, sendReviewMessage, getReviewBasis, getReviewBasisHistory } from "@/modules/monitoring";
import { resolutionMethods } from "@/modules/monitoring/action-catalogue";

const id = z.string().min(1).max(100);
const commands = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("view"), eventId: id }),
  z.strictObject({ action: z.literal("retry-email"), eventId: id, revision: z.number().int().nonnegative(), requestKey: z.string().uuid(), duplicateRisk: z.boolean() }),
  z.strictObject({ action: z.literal("claim"), eventId: id, revision: z.number().int().nonnegative() }),
  z.strictObject({ action: z.literal("refresh-context"), eventId: id, revision: z.number().int().nonnegative(), contextToken: z.string().regex(/^[a-f0-9]{64}$/), reviewed: z.literal(true) }),
  z.strictObject({ action: z.literal("send-message"), eventId: id, revision: z.number().int().nonnegative(), basisId: id, actionId: id, text: z.string().trim().min(1).max(4000), requestKey: z.string().uuid(), reviewed: z.literal(true) }),
  z.strictObject({ action: z.literal("resolve"), eventId: id, revision: z.number().int().nonnegative(), basisId: id, actionId: id, outcome: z.string().trim().min(3).max(2000), method: z.enum(resolutionMethods), requestKey: z.string().uuid(), reviewed: z.literal(true) })
]);
export async function GET(request: Request) {
  try {
    const actor = await requireActor(); const params = new URL(request.url).searchParams;
    const query = z.strictObject({ patientId: id.optional(), cursor: id.optional(), eventId: id.optional(), basisId: id.optional(), view: z.literal("basis-history").optional(), status: z.enum(["ACTIVE", "RESOLVED", "ALL", "UNREAD"]).optional() }).safeParse(Object.fromEntries(params));
    if (!query.success || ((query.data.basisId || query.data.view) && !query.data.eventId) || (query.data.basisId && (query.data.view || query.data.cursor)) || (query.data.eventId && (query.data.patientId || query.data.status || (query.data.cursor && !query.data.view)))) throw new AppError(400, "Проверьте фильтр событий.");
    const { eventId, basisId, view, cursor } = query.data;
    return Response.json(eventId ? basisId ? await getReviewBasis(actor, eventId, basisId) : view ? await getReviewBasisHistory(actor, eventId, cursor) : await getReviewEvent(actor, eventId) : await listReviewEvents(actor, query.data), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request); const actor = await requireActor(); const body = await request.text();
    if (body.length > 16000) throw new AppError(413, "Слишком большой объём данных.");
    let json: unknown; try { json = JSON.parse(body); } catch { throw new AppError(400, "Проверьте отправленные данные."); }
    const input = commands.safeParse(json); if (!input.success) throw new AppError(400, "Укажите действие и результат разбора.");
    const data = input.data;
    switch (data.action) {
      case "view": return Response.json(await viewAssessmentResult(actor, data.eventId));
      case "retry-email": return Response.json(await retryReviewEmail(actor, data));
      case "claim": return Response.json(await claimReviewEvent(actor, data));
      case "refresh-context": return Response.json(await refreshReviewContext(actor, data));
      case "send-message": return Response.json(await sendReviewMessage(actor, data));
      case "resolve": return Response.json(await resolveReviewEvent(actor, data));
    }
  } catch (error) { return errorResponse((error as { code?: string }).code === "P2002" ? new AppError(409, "Ключ действия уже использован. Обновите событие и проверьте сохранённый результат.") : error); }
}
