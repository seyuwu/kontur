import {describe,it,expect} from "vitest";
import {assessmentDateAfter,assessmentDueAt,moscowDate} from "../../src/lib/assessment-deadline";
describe("Questionnaire deadlines",()=>{
  it("uses Moscow calendar days even when UTC is still the previous day",()=>{
    const now=new Date("2026-10-24T22:30:00Z");expect(moscowDate(now)).toBe("2026-10-25");expect(assessmentDateAfter(3,now)).toBe("2026-10-28");expect(assessmentDueAt("2026-10-28")).toBe("2026-10-28T20:59:59.000Z");
  });
  it("handles month and leap-year boundaries",()=>{
    expect(assessmentDateAfter(3,new Date("2028-02-27T12:00:00Z"))).toBe("2028-03-01");expect(assessmentDateAfter(1,new Date("2026-12-31T12:00:00Z"))).toBe("2027-01-01");
  });
});
