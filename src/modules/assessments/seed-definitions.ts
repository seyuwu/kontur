import { assessmentDefinitionSchema, type AssessmentDefinition } from "@/modules/clinical";
import { db } from "@/server/db";
import { fingerprint, publishDefinition, readDefinition } from "./definitions";

const clinicalWarning = "Клиническая применимость не подтверждена.";

function withoutPresentationWarnings(definition: AssessmentDefinition): unknown {
  const copy = structuredClone(definition);
  const { description: _description, ...rest } = copy;
  if (rest.schemaVersion === 1) return rest;
  const { limitations: _limitations, ...provenance } = rest.provenance;
  return { ...rest, provenance };
}

/** A seed may retain an existing version when only its explanatory warning changed. */
export function canRetainPublishedDefinition(existing: AssessmentDefinition, incoming: AssessmentDefinition): boolean {
  if (existing.mode !== "DEMO" || incoming.mode !== "DEMO" || incoming.schemaVersion === 1) return false;
  if (!incoming.description.includes(clinicalWarning) || !incoming.provenance.limitations.includes(clinicalWarning)) return false;
  return fingerprint(withoutPresentationWarnings(existing)) === fingerprint(withoutPresentationWarnings(incoming));
}

export async function publishSeedDefinition(input: unknown) {
  const incoming = assessmentDefinitionSchema.parse(input);
  const existing = await db.assessmentDefinition.findUnique({ where: { code_version: { code: incoming.code, version: incoming.version } } });
  if (!existing) return publishDefinition(incoming);
  const saved = readDefinition(existing);
  if (existing.checksum === fingerprint(incoming) || canRetainPublishedDefinition(saved, incoming)) return existing;
  throw new Error("Published definition differs. Create a new version.");
}
