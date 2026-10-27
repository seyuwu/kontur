import { z } from "zod";
import { db } from "@/server/db";
import { AppError, requireDoctor, requirePatientAccess, type Actor } from "@/server/access";
import { getReviewEvent } from "@/modules/monitoring";
import { summarySchema, validateSummary } from "./provider";
export type SummarySelection = {patientId:string;assignmentId?:string;eventId?:string};
export const savedSummarySchema = summarySchema.extend({
  actions:z.array(z.object({id:z.string(),label:z.string(),description:z.string()})),
  sources:z.array(z.object({id:z.string(),label:z.string(),text:z.string(),role:z.enum(["PRIMARY","PREVIOUS","RELATED","CONTEXT"]).optional()})),
  generation:z.enum(["MODEL","RULES"]).optional(),retryAfter:z.string().datetime().optional(),
  sourceFingerprint:z.string().optional(),
  generatedAt:z.string().datetime(),clinicalDataVersion:z.number(),model:z.string(),scope:z.string()
});
export type SavedSummaryResult = z.infer<typeof savedSummarySchema>;
export function summaryScopeKey(input:SummarySelection){
  if(input.assignmentId && input.eventId)throw new AppError(400,"Выберите анкету или событие для обобщения.");
  return input.assignmentId ? `assignment:${input.assignmentId}` : input.eventId ? `event:${input.eventId}` : "patient";
}
export async function getSavedSummary(actor:Actor,input:SummarySelection){
  requireDoctor(actor);await requirePatientAccess(actor,input.patientId);
  const scopeKey=summaryScopeKey(input);
  if(input.assignmentId && !await db.assessmentSubmission.findFirst({where:{assignment:{id:input.assignmentId,patientId:input.patientId}},select:{id:true}}))throw new AppError(404,"Отправленная анкета недоступна.");
  if(input.eventId && (await getReviewEvent(actor,input.eventId)).patientId!==input.patientId)throw new AppError(404,"Событие недоступно для этой карточки.");
  const row=await db.savedSummary.findUnique({where:{patientId_doctorId_scopeKey:{patientId:input.patientId,doctorId:actor.id,scopeKey}}});
  if(!row)return null;
  const parsed=savedSummarySchema.parse(row.payload);
  validateSummary({facts:parsed.facts,actionIds:parsed.actionIds,limitations:parsed.limitations},parsed.sources,parsed.actions);
  return parsed;
}
