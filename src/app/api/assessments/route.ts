import { z } from "zod";
import { requireActor, checkOrigin, errorResponse, AppError } from "@/server/access";
import { assignAssessment, getAssessmentWorkspace, saveAssessmentDraft, submitAssessment, cancelAssessment } from "@/modules/assessments";

const id = z.string().min(1).max(100);
const answers = z.record(z.string().max(64), z.string().max(64)).refine(value => Object.keys(value).length <= 120);
const draft = { assignmentId: id, revision: z.number().int().nonnegative(), answers, note: z.string().max(2000) };
const commands = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("assign"), patientId: id, definitionId: id, dueAt: z.string().datetime().nullable().optional() }),
  z.strictObject({ action: z.literal("save-draft"), ...draft }),
  z.strictObject({ action: z.literal("submit"), ...draft, requestKey: z.string().uuid() }),
  z.strictObject({ action: z.literal("cancel"), assignmentId: id, revision: z.number().int().nonnegative(), reason: z.string().trim().min(3).max(1000) })
]);
export async function GET(request: Request) {
  try {
    const actor = await requireActor(); const params = new URL(request.url).searchParams;
    const query = z.object({ patientId: id, cursor: id.optional(), assignmentId: id.optional(),activeOnly:z.literal("true").optional() }).safeParse(Object.fromEntries(params));
    if (!query.success || (query.data.cursor && query.data.assignmentId)) throw new AppError(400, "Укажите доступную карточку пациента.");
    return Response.json(await getAssessmentWorkspace(actor, query.data.patientId, query.data.cursor, query.data.assignmentId,query.data.activeOnly==="true"), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request); const actor = await requireActor(); const body = await request.text();
    if (body.length > 20000) throw new AppError(413, "Слишком большой объём данных.");
    let json: unknown; try { json = JSON.parse(body); } catch { throw new AppError(400, "Проверьте отправленные данные."); }
    const input = commands.safeParse(json); if (!input.success) throw new AppError(400, "Проверьте поля анкеты.");
    const data = input.data;
    switch (data.action) {
      case "assign": return Response.json(await assignAssessment(actor, data));
      case "save-draft": return Response.json(await saveAssessmentDraft(actor, data));
      case "submit": return Response.json(await submitAssessment(actor, data));
      case "cancel": return Response.json(await cancelAssessment(actor, data));
    }
  } catch (error) { return errorResponse(error); }
}
