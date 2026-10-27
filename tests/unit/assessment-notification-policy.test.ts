import { describe, expect, it } from "vitest";
import { evaluateAssessment } from "../../src/modules/clinical";
import { f40Definitions } from "../../src/modules/clinical/f40-definitions";
import { f40NotificationDefinitions } from "../../src/modules/clinical/f40-notification-definitions";
import { guidanceSources, notificationPriority } from "../../src/lib/assessment-notifications";
const form = (code: string) => f40NotificationDefinitions.find(d => d.code === `guideline-f40-${code}-demo`)!;
function answersFor(code: string, total: number) {
  let rest = total;
  return Object.fromEntries(form(code).questions.map(q => { const min = Math.min(...q.options.map(o => o.points)); const max = Math.max(...q.options.map(o => o.points)); const p = min + Math.min(max - min, rest); rest -= p - min; return [q.id, q.options.find(o => o.points === p)!.id]; }));
}
function answersAt(code: string, points: number) { return Object.fromEntries(form(code).questions.map(q => [q.id, q.options.find(o => o.points === points)!.id])); }
describe("result-specific notifications", () => {
  it("publishes new immutable versions instead of changing existing assignments", () => {
    expect(f40NotificationDefinitions).toHaveLength(8);
    for(const old of f40Definitions) { const next=f40NotificationDefinitions.find(d=>d.code===old.code)!; expect(next.version).toBe(old.version+1); expect(next.questions).toEqual(old.questions); expect(next.scoring).toEqual(old.scoring); }
    const bai=f40Definitions.find(d=>d.code==="guideline-f40-bai-demo")!;
    expect(evaluateAssessment(bai,answersFor("bai",0)).findings).toHaveLength(0);
  });
  it("covers every BAI score exactly once with different low/middle/high recommendations", () => {
    for(let total=0;total<=63;total++) {
      const r=evaluateAssessment(form("bai"),answersFor("bai",total)); expect(r.metric.value).toBe(total); expect(r.findings).toHaveLength(1);
      expect(r.findings[0].notification?.kind).toBe(total<10?"ROUTINE":total<36?"REVIEW":"HIGH");
      expect(r.findings[0].notification?.sourceIds.length).toBeGreaterThan(0);
    }
    const low=evaluateAssessment(form("bai"),answersFor("bai",0)).findings[0];
    const high=evaluateAssessment(form("bai"),answersFor("bai",63)).findings[0];
    expect(low.notification?.recommendation).not.toBe(high.notification?.recommendation);
    expect(low.actions).toHaveLength(1); expect(high.actions.some(a=>a.kind==="CONTACT_PATIENT")).toBe(true);
  });
  it("preserves the supplied HAM-A, SPRAS and BFNE boundaries", () => {
    for(const [code, min, max, routineEnd, highStart] of [["ham",0,56,7,25],["spras",0,140,29,80],["bfne",12,60,23,47]] as const) {
      for(let total=min;total<=max;total++) {
        const r=evaluateAssessment(form(code),answersFor(code,total-min)); expect(r.metric.value).toBe(total); expect(r.findings).toHaveLength(1);
        expect(r.findings[0].notification?.kind).toBe(total<=routineEnd?"ROUTINE":total<highStart?"REVIEW":"HIGH");
      }
    }
  });
  it("does not invent normal/abnormal cutoffs for unclassified instruments", () => {
    for(const [code, min,max] of [["scl",0,4],["itt-state",0,3],["itt-trait",0,3],["gelo",1,4]] as const) {
      for(const n of [min,max]) {
        const answers=answersAt(code,n); if(code==="scl") answers.scl_15="answer_0";
        const r=evaluateAssessment(form(code),answers); expect(r.findings).toHaveLength(1); expect(r.findings[0].notification?.kind).toBe("REVIEW"); expect(r.findings[0].title).toContain("без категории");
      }
    }
  });
  it("sends one safety-related event regardless of the SCL total, and never infers this from BAI fear of death", () => {
    for(const baseline of [0,4]) for(const points of [1,2,3,4]) {
      const a=answersAt("scl",baseline); a.scl_15=`answer_${points}`; const r=evaluateAssessment(form("scl"),a);
      expect(r.findings).toHaveLength(1); expect(r.findings[0].ruleId).toBe("scl_safety_answer"); expect(r.findings[0].notification?.kind).toBe("SAFETY");
      expect(r.findings[0].notification?.sourceIds).toContain("nice-safety");
    }
    const a=answersFor("bai",0); a.bai_16="severe"; expect(evaluateAssessment(form("bai"),a).findings[0].notification?.kind).toBe("ROUTINE");
  });
  it("has only known source references and never creates a result from an incomplete form", () => {
    for(const d of f40NotificationDefinitions) for(const r of d.rules) {
      for(const id of r.notification?.sourceIds??[]) expect(guidanceSources[id].url).toMatch(/^(\/api\/clinical-source\?|https:\/\/www.nice.org.uk\/)/);
    }
    expect(()=>evaluateAssessment(form("scl"),{})).toThrow();
    expect(notificationPriority.SAFETY).toBeGreaterThan(notificationPriority.ROUTINE);
  });
});
