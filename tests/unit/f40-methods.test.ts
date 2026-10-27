import { describe, expect, it } from "vitest";
import { evaluateAssessment } from "../../src/modules/clinical";
import { f40Definitions } from "../../src/modules/clinical/f40-definitions";
import catalogue from "../../src/modules/clinical/f40-catalogue.json";
const form = (code: string) => f40Definitions.find(d => d.code === `guideline-f40-${code}-demo`)!;
const answer = (code: string, points: number) => Object.fromEntries(form(code).questions.map(q => [q.id, q.options.find(o => o.points === points)!.id]));
describe("F40 supplied guideline methods", () => {
  it("accounts for every appendix without inventing missing forms", () => {
    expect(catalogue.map(c => c.appendix)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    expect(catalogue.filter(c => c.status === "AVAILABLE")).toHaveLength(7);
    expect(f40Definitions).toHaveLength(8);
    expect(catalogue.filter(c => c.status === "SOURCE_CONFLICT").map(c => c.appendix)).toEqual([4,16,19]);
    for (const c of catalogue) { expect(c.pages.length).toBeGreaterThan(0); expect(c.sourceText).toContain(`Приложение Г${c.appendix}`); for (const code of c.codes) expect(f40Definitions.some(d => d.code === code)).toBe(true); }
  });
  it("keeps Hamilton clinician-rated and scores mental/somatic components", () => {
    const d = form("ham"); expect(d.schemaVersion === 3 && d.respondent).toBe("DOCTOR");
    expect(d.questions).toHaveLength(14);
    const result = evaluateAssessment(d, answer("ham",4));
    expect(result.metric.value).toBe(56); expect(result.findings).toHaveLength(1);
    expect(result.metric.interpretation).toContain("Психическая сфера: 24");
    expect(result.metric.interpretation).toContain("Соматическая сфера: 32");
  });
  it("supports all 90 SCL answers and handles the undefined PDSI at zero", () => {
    const result = evaluateAssessment(form("scl"),answer("scl",0));
    expect(form("scl").questions).toHaveLength(90); expect(result.metric.value).toBe(0);
    expect(result.metric.interpretation).toContain("PDSI: не определён");
    expect(result.findings).toHaveLength(0);
    const mixed = answer("scl",0); mixed.scl_1 = "answer_4"; mixed.scl_2 = "answer_2";
    const r = evaluateAssessment(form("scl"),mixed);
    expect(r.metric.value).toBeCloseTo(6/90); expect(r.metric.maximum).toBe(4);
    expect(r.metric.interpretation).toContain("PSI: 2"); expect(r.metric.interpretation).toContain("PDSI: 3");
  });
  it("transcribes first/last questions rather than the response legend", () => {
    expect(form("spras").questions[0].title).toContain("Затруднение на вдохе");
    expect(form("bfne").questions[0].title).toContain("Меня волнует мнение");
    expect(form("gelo").questions[0].title).toContain("Когда в моем присутствии");
    expect(form("ham").questions[1].title).toContain("Напряжение");
  });
  it("applies supplied SPRAS/BFNE total thresholds exactly", () => {
    const a = answer("spras",0); for(let i=1;i<=19;i++) a[`spras_${i}`]="answer_4"; a.spras_20="answer_3";
    expect(evaluateAssessment(form("spras"),a).findings).toHaveLength(0); a.spras_20="answer_4";
    expect(evaluateAssessment(form("spras"),a).findings).toHaveLength(1);
    expect(evaluateAssessment(form("bfne"),answer("bfne",1)).metric.value).toBe(12);
    expect(evaluateAssessment(form("bfne"),answer("bfne",5)).metric.value).toBe(60);
  });
  it("keeps separate ITT periods and GELO means without filling gaps in interpretation", () => {
    expect(form("itt-state").period).not.toBe(form("itt-trait").period);
    expect(evaluateAssessment(form("itt-state"),answer("itt-state",3)).metric.value).toBe(45);
    const r=evaluateAssessment(form("gelo"),answer("gelo",4)); expect(r.metric.value).toBe(4);
    expect(r.metric.interpretation).toContain("Социальное реагирование · среднее: 4"); expect(r.findings).toHaveLength(0);
  });
});
