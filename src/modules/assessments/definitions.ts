import { createHash } from "node:crypto";
import { db } from "@/server/db";
import { AppError } from "@/server/access";
import { assessmentDefinitionSchema, type AssessmentDefinition } from "@/modules/clinical";
import type { AssessmentDefinition as DefinitionRecord, Prisma } from "@/generated/prisma/client";
import type { AssessmentFormDefinition } from "@/lib/assessments";

export const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const permittedDefinition = (): Prisma.AssessmentDefinitionWhereInput => ({ OR: [
  { mode: "CLINICAL", review: "APPROVED" },
  ...(process.env.DEMO_MODE === "true" ? [{ mode: "DEMO" as const, review: "DEMO" as const }] : [])
] });
export function readDefinition(record: DefinitionRecord): AssessmentDefinition {
  const parsed = assessmentDefinitionSchema.parse(record.content);
  if (fingerprint(parsed) !== record.checksum || parsed.code !== record.code || parsed.version !== record.version || parsed.mode !== record.mode || parsed.review !== record.review) throw new AppError(409, "Определение анкеты изменилось. Обратитесь к администратору.");
  if (parsed.mode === "DEMO" && process.env.DEMO_MODE !== "true") throw new AppError(403, "Учебная анкета недоступна в этом режиме.");
  if (parsed.mode === "CLINICAL" && parsed.review !== "APPROVED") throw new AppError(409, "Клиническое определение ещё не проверено.");
  return parsed;
}
export function publicForm(definition: AssessmentDefinition): AssessmentFormDefinition {
  const { code, version, title, description, instructions, period, mode, source, questions } = definition;
  return { ...(definition.schemaVersion === 3 ? { respondent: definition.respondent } : {}), code, version, title, description, instructions, period, mode, source, questions, ...(definition.schemaVersion !== 1 ? { provenance: definition.provenance } : {}) };
}

/** Trusted publication only; existing versions cannot be edited in place. */
export async function publishDefinition(input: unknown) {
  const definition = assessmentDefinitionSchema.parse(input);
  if (definition.mode === "CLINICAL" && definition.review !== "APPROVED") throw new Error("Publish only reviewed definitions.");
  if (definition.mode === "DEMO" && process.env.DEMO_MODE !== "true") throw new Error("Demo publication is disabled.");
  const checksum = fingerprint(definition);
  const record = await db.assessmentDefinition.upsert({
    where: { code_version: { code: definition.code, version: definition.version } }, update: {},
    create: { code: definition.code, version: definition.version, mode: definition.mode, review: definition.review, title: definition.title, content: definition, checksum }
  });
  if (record.checksum !== checksum) throw new Error("Published definition differs. Create a new version.");
  return record;
}
