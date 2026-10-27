import { describe, expect, it } from "vitest";
import { splitDose } from "../../src/lib/medication-dose";
describe("Medication dose editing", () => {
  it("reads amounts and explicit units without converting them", () => {
    expect(splitDose("0,5 мл")).toEqual({amount:"0,5",unit:"мл"});
    expect(splitDose("2 капс.")).toEqual({amount:"2",unit:"капс."});
    expect(splitDose("50")).toEqual({amount:"50",unit:""});
  });
  it("keeps existing complex prescriptions intact", () => {
    expect(splitDose("1–2 таблетки по назначению")).toEqual({amount:"1–2 таблетки по назначению",unit:"custom"});
    expect(splitDose("")).toEqual({amount:"",unit:""});
  });
});
