import { z } from "zod";
import { proposedActionsSchema } from "@/modules/clinical";

/** Workflow capabilities only. Medical actions require a separately reviewed definition and implementation. */
export const workflowCatalogue = {
  id: "review-workflow", version: 1,
  source: "Процесс сопровождения проекта «Контур», версия 1. Организационные действия; не клинический протокол.",
  capabilities: [
    { kind: "REVIEW_ANSWERS", methods: ["NOTE"], effect: "Фиксация внесённого врачом результата разбора исходных ответов." },
    { kind: "CONTACT_PATIENT", methods: ["IN_APP_MESSAGE", "OTHER_CHANNEL"], effect: "Сохранение сообщения в переписке или результата по другому каналу, внесённого врачом. Не подтверждает прочтение или ответ пациента." }
  ]
} as const;
export const resolutionMethods = ["NOTE", "IN_APP_MESSAGE", "OTHER_CHANNEL", "DECLINED"] as const;
export const methodLabels = { NOTE: "Результат разбора, внесённый врачом", IN_APP_MESSAGE: "Сообщение сохранено в переписке", OTHER_CHANNEL: "Другой канал, результат внесён врачом", DECLINED: "Мотивированное отклонение" };
export type ResolutionMethod = typeof resolutionMethods[number];
const id = z.string().min(1).max(100);
export const reviewContextSchema = z.strictObject({
  schemaVersion: z.literal(1), token: z.string().regex(/^[a-f0-9]{64}$/), clinicalDataVersion: z.number().int().nonnegative(), linked: z.boolean(),
  profile: z.strictObject({ id, version: z.number().int().positive() }).nullable(),
  plan: z.strictObject({ id, version: z.number().int().positive(), goal: z.string().max(500) }).nullable(),
  unknowns: z.array(z.string().max(300)).max(8),
  latestObservation: z.strictObject({ id, score: z.number().int().min(1).max(5).nullable(), note: z.string().max(2000), needsContact: z.boolean(), createdAt: z.string() }).nullable(),
  latestSubmission: z.strictObject({ id, title: z.string().max(200), mode: z.enum(["DEMO", "CLINICAL"]), createdAt: z.string() }).nullable(),
  latestMessage: z.strictObject({ id, text: z.string().max(4000), createdAt: z.string() }).nullable(),
  latestDailyReport: z.strictObject({ id, title: z.string().max(200), date: z.string(), state: z.enum(["DONE", "PARTIAL", "NOT_DONE", "UNSURE"]), note: z.string().max(2000), createdAt: z.string() }).nullable().optional(),
  latestConcern: z.strictObject({ id, title: z.string().max(200), description: z.string().max(3000), createdAt: z.string() }).nullable().optional()
});
export type ReviewContext = z.infer<typeof reviewContextSchema>;
export const reviewBasisSchema = z.strictObject({ schemaVersion: z.literal(1), context: reviewContextSchema, actions: proposedActionsSchema,
  catalogue: z.strictObject({ id: z.literal("review-workflow"), version: z.number().int().positive(), checksum: z.string(), source: z.string(), capabilities: z.array(z.strictObject({ kind: z.enum(["REVIEW_ANSWERS", "CONTACT_PATIENT"]), methods: z.array(z.enum(resolutionMethods)), effect: z.string() })).max(12) }),
  definitionChecksum: z.string()
});
export type ReviewBasisContent = z.infer<typeof reviewBasisSchema>;
export function permitsMethod(kind: "REVIEW_ANSWERS" | "CONTACT_PATIENT", method: ResolutionMethod) {
  return (workflowCatalogue.capabilities.find(a => a.kind === kind)?.methods as readonly string[] | undefined)?.includes(method) ?? false;
}
