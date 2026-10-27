import {expect,it} from "vitest";
import {exchangeSchema,type PatientExchange} from "../../src/modules/integrations/contract";
import {csvCell,serializeExchange} from "../../src/modules/integrations/serialize";
const snapshot:PatientExchange={contractVersion:"1.0",generatedAt:"2026-10-24T12:00:00.000Z",patient:{id:"p1",externalReference:"TEST",name:"=HYPERLINK(\"https://evil.test\")",birthDate:"1990-01-01"},clinical:null,plan:null,assessments:{items:[],nextCursor:null},scope:"current-clinical-profile-current-plan-paged-assessments"};
it("keeps the versioned JSON independent from the CSV adapter",()=>{
  const json=serializeExchange(snapshot,"json");expect(exchangeSchema.parse(JSON.parse(json.body))).toEqual(snapshot);
  const csv=serializeExchange(snapshot,"csv");expect(csv.contentType).toContain("text/csv");expect(csv.body).toContain("record_type");expect(csv.body).toContain("'=HYPERLINK");expect(snapshot.patient.name.startsWith("=")).toBe(true);
  expect(()=>exchangeSchema.parse({...snapshot,contractVersion:"2.0"})).toThrow();
});
it("escapes formulas and delimiters without losing literal quotes or line breaks",()=>{
  for(const value of ["=1+1","+1+1","-1+1","@SUM(1)","  =1+1","\t=1+1"])expect(csvCell(value)).toMatch(/^"'/);
  expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');expect(csvCell(null)).toBe('""');expect(csvCell("обычный текст")).toBe('"обычный текст"');
});
