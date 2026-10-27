import { z } from "zod";
import { calendarDate } from "@/modules/clinical-profile/contract";
export const documentInput = z.strictObject({ patientId: z.string().min(1).max(100), title: z.string().trim().min(3).max(200), date: calendarDate.nullable(), text: z.string().trim().min(40).max(60000), requestKey: z.string().uuid() });
export const candidateSchema = z.strictObject({ section: z.enum(["conditions", "allergies", "medications"]), polarity: z.enum(["PRESENT", "ABSENT", "UNCERTAIN"]), scope: z.enum(["ITEM", "SECTION"]), title: z.string().min(2).max(200), details: z.string().max(1500), quote: z.string().min(3).max(2000), intake: z.enum(["TAKING", "STOPPED", "UNKNOWN"]), regimen: z.string().max(500), startedOn: calendarDate.nullable(), stoppedOn: calendarDate.nullable() });
export const extractionSchema = z.strictObject({ facts: z.array(candidateSchema).max(30), limitations: z.array(z.string().max(500)).max(10) });
export const locatedSchema = candidateSchema.extend({ start: z.number().int().nonnegative(), end: z.number().int().positive() });
export const locatedExtractionSchema = z.strictObject({ facts: z.array(locatedSchema).max(30), limitations: z.array(z.string().max(500)).max(10) });
export type Candidate = z.infer<typeof candidateSchema>;
export type LocatedExtraction = z.infer<typeof locatedExtractionSchema>;
/** Offsets are computed locally using JS string indices, never trusted from a model. */
export function locateExtraction(source: string, input: unknown): LocatedExtraction {
  const output = extractionSchema.parse(input);
  const facts = output.facts.map(f => { const start = source.indexOf(f.quote); if (start < 0 || source.indexOf(f.quote, start + 1) >= 0) throw new Error("UNCITED_OUTPUT");
    if (f.polarity !== "ABSENT" && f.scope !== "ITEM") throw new Error("INVALID_FACT");
    if (f.section !== "medications" && (f.regimen || f.intake !== "UNKNOWN" || f.startedOn || f.stoppedOn)) throw new Error("INVALID_FACT");
    if (f.startedOn && f.stoppedOn && f.stoppedOn < f.startedOn) throw new Error("INVALID_FACT");
    if (f.intake !== "STOPPED" && f.stoppedOn) throw new Error("INVALID_FACT");
    return { ...f, start, end: start + f.quote.length };
  });
  if (new Set(facts.map(f => JSON.stringify([f.section, f.polarity, f.start, f.end, f.title]))).size !== facts.length) throw new Error("DUPLICATE_FACT");
  return { facts, limitations: output.limitations };
}
