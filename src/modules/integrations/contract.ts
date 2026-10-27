import {z} from "zod";
import {profileContentSchema} from "@/modules/clinical-profile/contract";
import {medicationSchema} from "@/modules/care/contract";
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const exchangeSchema=z.strictObject({
  contractVersion:z.literal("1.0"),generatedAt:z.string().datetime(),
  patient:z.strictObject({id:z.string(),externalReference:z.string(),name:z.string(),birthDate:date}),
  clinical:z.strictObject({version:z.number().int(),content:profileContentSchema}).nullable(),
  plan:z.strictObject({id:z.string(),version:z.number().int(),goal:z.string(),instructions:z.string(),nextVisitDate:date.nullable(),tasks:z.array(z.strictObject({id:z.string(),kind:z.enum(["ACTION","ASSESSMENT","MEDICATION"]),title:z.string(),details:z.string(),startDate:date.nullable(),dueDate:date.nullable(),time:z.string().nullable(),timeZone:z.literal("Europe/Moscow"),repeat:z.enum(["DAILY"]).nullable(),medication:medicationSchema.nullable(),assignmentId:z.string().nullable()})).max(8)}).nullable(),
  assessments:z.strictObject({items:z.array(z.strictObject({id:z.string(),code:z.string(),version:z.number().int(),title:z.string(),status:z.enum(["ASSIGNED","IN_PROGRESS","COMPLETED","CANCELLED"]),dueAt:z.string().datetime().nullable(),completedAt:z.string().datetime().nullable(),result:z.strictObject({label:z.string(),value:z.number(),minimum:z.number(),maximum:z.number(),interpretation:z.string()}).nullable(),answers:z.record(z.string(),z.string()).nullable()})).max(20),nextCursor:z.string().nullable()}),
  scope:z.literal("current-clinical-profile-current-plan-paged-assessments")
});
export type PatientExchange=z.infer<typeof exchangeSchema>;
