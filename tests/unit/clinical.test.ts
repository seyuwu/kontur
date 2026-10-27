import { describe, expect, it } from "vitest";
import { assessmentDefinitionSchema, evaluateAssessment, validateAnswers } from "../../src/modules/clinical";
import { demoDefinition } from "../../src/modules/clinical/demo-definition";

describe("Versioned, deterministic questionnaire evaluation", () => {
  it("calculates the declared range without inferring a diagnosis", () => {
    const result = evaluateAssessment(demoDefinition, { clarity: "clear", contact: "no" });
    expect(result.metric).toMatchObject({ value: 0, minimum: 0, maximum: 2 });
    expect(result.findings).toEqual([]); expect(result.mode).toBe("DEMO");
    expect(evaluateAssessment(demoDefinition, { clarity: "unclear", contact: "no" }).metric.value).toBe(2);
  });
  it("allows partial drafts but never treats a missing required answer as zero", () => {
    expect(() => validateAnswers(demoDefinition, { clarity: "clear" }, false)).not.toThrow();
    expect(() => evaluateAssessment(demoDefinition, { clarity: "clear" })).toThrow(/обязательные/);
    expect(() => evaluateAssessment(demoDefinition, {})).toThrow();
  });
  it("rejects answers outside the published version", () => {
    expect(() => validateAnswers(demoDefinition, { invented: "yes" }, false)).toThrow();
    expect(() => validateAnswers(demoDefinition, { clarity: "invented" }, false)).toThrow();
  });
  it("preserves separate explanations and proposed actions for two distinct triggers", () => {
    const result = evaluateAssessment(demoDefinition, { clarity: "unclear", contact: "yes" });
    expect(result.findings.map(f => f.ruleId)).toEqual(["contact_requested", "clarification_requested"]);
    expect(result.findings.every(f => f.reason && f.actions.some(a => a.kind === "CONTACT_PATIENT" && a.source))).toBe(true);
    expect(evaluateAssessment(demoDefinition, { contact: "yes", clarity: "unclear" })).toEqual(result);
  });
  it("accepts a new instrument version without changing engine code or the original", () => {
    const definition = structuredClone(demoDefinition); definition.version = 2; definition.questions[0].options[2].points = 7;
    const next = assessmentDefinitionSchema.parse(definition);
    expect(evaluateAssessment(next, { clarity: "unclear", contact: "no" }).metric.value).toBe(7);
    expect(demoDefinition.questions[0].options[2].points).toBe(2);
  });
  it("rejects broken references, duplicate identifiers and unverified clinical publication", () => {
    const broken = structuredClone(demoDefinition); broken.rules[0].actionIds = ["missing"];
    expect(assessmentDefinitionSchema.safeParse(broken).success).toBe(false);
    const duplicate = structuredClone(demoDefinition); duplicate.questions[1].id = duplicate.questions[0].id;
    expect(assessmentDefinitionSchema.safeParse(duplicate).success).toBe(false);
    const optional = structuredClone(demoDefinition); optional.questions[0].required = false;
    expect(assessmentDefinitionSchema.safeParse(optional).success).toBe(false);
    const unreviewed = { ...demoDefinition, mode: "CLINICAL", review: "APPROVED" };
    expect(assessmentDefinitionSchema.safeParse(unreviewed).success).toBe(false);
  });
});
