import { describe, expect, it } from "vitest";
import { f40Definitions } from "../../src/modules/clinical/f40-definitions";
import { canRetainPublishedDefinition } from "../../src/modules/assessments/seed-definitions";

describe("published questionnaire definitions", () => {
  const updated = f40Definitions.find(form => form.code === "guideline-f40-ham-demo")!;
  it("keeps a stored version if only its explanatory warning differs", () => {
    const stored = structuredClone(updated);
    stored.description = "Прежнее описание источника.";
    if (stored.schemaVersion !== 1) stored.provenance.limitations = "Прежнее описание ограничений.";
    expect(canRetainPublishedDefinition(stored, updated)).toBe(true);
  });
  it("does not accept a change in scoring or an unqualified replacement warning", () => {
    const changed = structuredClone(updated);
    changed.questions[0].options[0].points += 1;
    expect(canRetainPublishedDefinition(changed, updated)).toBe(false);
    const unqualified = structuredClone(updated);
    unqualified.description = "Ограничение не указано.";
    expect(canRetainPublishedDefinition(updated, unqualified)).toBe(false);
  });
});
