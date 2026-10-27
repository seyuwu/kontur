import {chooseMedicationTimes,reportMedicationIntake} from "@/modules/care/medications";
import {medicationTime} from "@/lib/medication-regimen";
import { z } from "zod";
import { AppError, checkOrigin, errorResponse, requireActor } from "@/server/access";
import { careContentSchema, careReportSchema, careDateSchema } from "@/modules/care/contract";
import { getCareWorkspace, getCareHistory, getCareVersion, saveCareDraft, discardCareDraft, confirmCarePlan, reportCareTask, scheduleCareVisit } from "@/modules/care";
const id = z.string().min(1).max(100); const revision = z.number().int().nonnegative();
const draft = { patientId: id, revision, content: careContentSchema, basisToken: z.string().regex(/^[a-f0-9]{64}$/) };
const medicationBase={patientId:id,planVersionId:id,taskId:z.string().uuid(),revision,requestKey:z.string().uuid()};
const commands = z.discriminatedUnion("action", [
  z.strictObject({action:z.literal("medication-schedule"),...medicationBase,times:z.array(medicationTime).min(1).max(12)}),
  z.strictObject({action:z.literal("medication-report"),...medicationBase,date:careDateSchema,time:medicationTime,state:z.enum(["DONE","NOT_DONE","PARTIAL","UNSURE"]),note:z.string().max(2000)}),
  z.strictObject({ action: z.literal("schedule-visit"), patientId: id, date: careDateSchema.nullable(), time:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().optional(), expectedPlanId: id.nullable(), expectedNextVisit: z.string().datetime().nullable(), requestKey: z.string().uuid() }),
  z.strictObject({ action: z.literal("save-draft"), ...draft }),
  z.strictObject({ action: z.literal("rebase"), ...draft, reviewed: z.literal(true) }),
  z.strictObject({ action: z.literal("discard"), patientId: id, revision }),
  z.strictObject({ action: z.literal("confirm"), patientId: id, draftId: id, revision, requestKey: z.string().uuid(), reviewed: z.literal(true) }),
  z.strictObject({ action: z.literal("report"), patientId: id, planVersionId: id, taskId: z.string().uuid(), revision, requestKey: z.string().uuid(), ...careReportSchema.shape })
]);
export async function GET(request: Request) {
  try { const actor = await requireActor(); const params = new URL(request.url).searchParams;
    const query = z.object({ patientId: id, view: z.enum(["history"]).optional(), versionId: id.optional(), cursor: id.optional() }).safeParse(Object.fromEntries(params));
    if (!query.success || (query.data.view && query.data.versionId) || (query.data.cursor && !query.data.view)) throw new AppError(400, "Проверьте адрес плана.");
    const { patientId, view, versionId, cursor } = query.data;
    const data = view ? await getCareHistory(actor, patientId, cursor) : versionId ? await getCareVersion(actor, patientId, versionId) : await getCareWorkspace(actor, patientId);
    return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try { checkOrigin(request); const actor = await requireActor(); const body = await request.text(); if (body.length > 40000) throw new AppError(413, "Слишком большой план.");
    let json: unknown; try { json = JSON.parse(body); } catch { throw new AppError(400, "Проверьте отправленные данные."); }
    const input = commands.safeParse(json); if (!input.success) throw new AppError(400, input.error.issues[0]?.message ?? "Проверьте поля плана."); const data = input.data;
    switch (data.action) {
      case "medication-schedule": return Response.json(await chooseMedicationTimes(actor,data));
      case "medication-report": return Response.json(await reportMedicationIntake(actor,data));
      case "schedule-visit": return Response.json(await scheduleCareVisit(actor, data));
      case "save-draft": case "rebase": return Response.json(await saveCareDraft(actor, data));
      case "discard": return Response.json(await discardCareDraft(actor, data));
      case "confirm": return Response.json(await confirmCarePlan(actor, data));
      case "report": if (!careReportSchema.safeParse({ state: data.state, note: data.note }).success) throw new AppError(400, "Опишите вопрос врачу."); return Response.json(await reportCareTask(actor, data));
    }
  } catch (error) { return errorResponse(error); }
}
