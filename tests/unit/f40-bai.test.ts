import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { assessmentApplies, assessmentDefinitionSchema, evaluateAssessment } from "../../src/modules/clinical";
import { f40BaiDefinition as form, f40Source } from "../../src/modules/clinical/f40-bai-definition";
import { demoDefinition } from "../../src/modules/clinical/demo-definition";
function answersFor(total: number) { let rest = total; return Object.fromEntries(form.questions.map(q => { const value = Math.min(3, rest); rest -= value; return [q.id, q.options.find(o => o.points === value)!.id]; })); }
describe("Traceable F40 BAI transcription", () => {
  it("is tied to the supplied PDF bytes and is not silently approved for clinical use", () => {
    const bytes = readFileSync("resources/clinical/f40-455-2024.pdf"); expect(createHash("sha256").update(bytes).digest("hex")).toBe(f40Source.sha256);
    expect(form).toMatchObject({ schemaVersion: 2, mode: "DEMO", review: "DEMO", source: { reviewedBy: "", reviewedAt: "" } });
    expect(form.questions).toHaveLength(21); expect(form.questions.every(q => q.required && q.options.map(o => o.points).join() === "0,1,2,3")).toBe(true);
    expect(form.source.validation).toContain("1961"); expect(form.source.validation).toContain("1988");
    expect(assessmentDefinitionSchema.safeParse({ ...form, mode: "CLINICAL", review: "APPROVED" }).success).toBe(false);
  });
  it.each([[0, "0–9"], [9, "0–9"], [10, "10–21"], [21, "10–21"], [22, "22–35"], [35, "22–35"], [36, "36–63"], [63, "36–63"]])("scores PDF boundary %s without gaps or invented thresholds", (value, label) => {
    const result = evaluateAssessment(form, answersFor(Number(value)));
    expect(result.metric).toMatchObject({ value, minimum: 0, maximum: 63 }); expect(result.metric.interpretation).toContain(label);
    expect(result.findings).toHaveLength(Number(value) >= 36 ? 1 : 0); expect(result.mode).toBe("DEMO"); expect(result.schemaVersion).toBe(2);
  });
  it("never treats incomplete responses as zero, or fear of death as suicidality", () => {
    const answers = answersFor(0); answers.bai_16 = "severe"; const result = evaluateAssessment(form, answers); expect(result.metric.value).toBe(3); expect(result.findings).toEqual([]);
    delete answers.bai_1; expect(() => evaluateAssessment(form, answers)).toThrow(/обязательные/);
    expect(() => evaluateAssessment(form, { ...answersFor(0), bai_1: "3" })).toThrow();
    expect(result.metric.interpretation).toContain("не исключает");
  });
  it("rejects overlapping, missing or out-of-order bands and impossible event conditions", () => {
    for (const edit of ["gap", "overlap", "reverse", "outside", "duplicate"] as const) {
      const d = structuredClone(form); if (d.schemaVersion !== 2) throw new Error("v2 expected");
      if (edit === "gap") d.scoring.bands[1].minimum = 11;
      if (edit === "overlap") d.scoring.bands[1].minimum = 9;
      if (edit === "reverse") d.scoring.bands.reverse();
      if (edit === "outside") d.scoring.bands[3].maximum = 64;
      if (edit === "duplicate") d.scoring.bands[1].id = d.scoring.bands[0].id;
      expect(assessmentDefinitionSchema.safeParse(d).success, edit).toBe(false);
    }
    const d = structuredClone(form); d.rules[0].when = { metric: "TOTAL", minimum: 64, maximum: 63 }; expect(assessmentDefinitionSchema.safeParse(d).success).toBe(false);
  });
  it("restricts this guideline transfer to adults, including the birthday boundary", () => {
    expect(assessmentApplies(form, new Date("2008-10-18"), new Date("2026-10-18"))).toBe(true);
    expect(assessmentApplies(form, new Date("2008-10-19"), new Date("2026-10-18"))).toBe(false);
    expect(assessmentApplies(form, new Date("2022-03-01"), new Date("2040-02-29"))).toBe(false);
  });
  it("keeps legacy schema and original evaluation unchanged", () => {
    expect(evaluateAssessment(demoDefinition, { clarity: "unclear", contact: "no" })).toMatchObject({ schemaVersion: 1, metric: { value: 2, minimum: 0, maximum: 2 } });
    expect(assessmentDefinitionSchema.parse(demoDefinition)).toEqual(demoDefinition);
  });
});
