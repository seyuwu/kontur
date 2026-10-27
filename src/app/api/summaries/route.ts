import { z } from "zod";
import { AppError, checkOrigin, errorResponse, requireActor, requireDoctor } from "@/server/access";
import { createSummary, getSummaryState } from "@/modules/summaries";
import { summaryConfiguration } from "@/modules/summaries/provider";

const id = z.string().min(1).max(100);
const selection = z.strictObject({ patientId: id, eventId: id.optional(), assignmentId: id.optional() });
export async function GET(request: Request) {
  try {
    const actor = await requireActor(); requireDoctor(actor);
    const params = new URL(request.url).searchParams;
    if (!params.size) return Response.json(summaryConfiguration(), { headers: { "Cache-Control": "private, no-store" } });
    const parsed = selection.safeParse(Object.fromEntries(params));
    if (!parsed.success) throw new AppError(400,"Проверьте выбранную карточку и анкету.");
    return Response.json({...summaryConfiguration(),...await getSummaryState(actor,parsed.data)}, {headers:{"Cache-Control":"private, no-store"}});
  }
  catch (e) { return errorResponse(e); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request); const actor = await requireActor(); requireDoctor(actor);
    const body = await request.text(); if (body.length > 1000) throw new AppError(413, "Слишком большой запрос.");
    let raw: unknown; try { raw = JSON.parse(body); } catch { throw new AppError(400, "Проверьте запрос."); }
    const input = selection.extend({automatic:z.boolean().optional()}).safeParse(raw);
    if (!input.success) throw new AppError(400, "Проверьте выбранную карточку и анкету.");
    return Response.json(await createSummary(actor, input.data, input.data.automatic), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return errorResponse(e); }
}
