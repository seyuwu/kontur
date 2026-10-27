import {it,expect} from "vitest";
import {medicationRegimenSchema,medicationActiveDay,nextMedicationDay,medicationTimes} from "../../src/lib/medication-regimen";
it("supports two intakes every three days across month boundaries",()=>{
 for(const [date,active] of [["2026-10-29",true],["2026-10-30",false],["2026-10-31",false],["2026-11-01",true]] as const)expect(medicationActiveDay("2026-10-29",3,date)).toBe(active);
 expect(nextMedicationDay("2026-10-29",3,"2026-10-30")).toBe("2026-11-01");
 expect(nextMedicationDay("2026-10-29",0,"2026-10-30")).toBeNull();
});
it("patient may choose only the prescribed number of distinct valid times",()=>{
 const r=medicationRegimenSchema.parse({everyDays:3,timesPerDay:2,timeMode:"PATIENT",times:[]});
 expect(medicationTimes(r,["20:00","08:00"])).toEqual(["08:00","20:00"]);
 for(const times of [["08:00"],["08:00","08:00"],["25:00","08:00"]])expect(medicationTimes(r,times)).toEqual([]);
 expect(medicationRegimenSchema.safeParse({...r,everyDays:-1}).success).toBe(false);
 expect(medicationRegimenSchema.safeParse({...r,timeMode:"FIXED",times:["08:00"]}).success).toBe(false);
});
it("fixed prescriptions ignore patient-provided clock times",()=>{
 const r=medicationRegimenSchema.parse({everyDays:1,timesPerDay:2,timeMode:"FIXED",times:["09:00","21:00"]});
 expect(medicationTimes(r,["08:00","20:00"])).toEqual(["09:00","21:00"]);
});
