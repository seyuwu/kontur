import {afterEach,it,expect,vi} from "vitest";
import {registrationFields} from "../../src/server/registration";
afterEach(()=>vi.unstubAllEnvs());
it("only creates doctors in an explicit synthetic demo with consent",()=>{
 const body={accountType:"DOCTOR",doctorSpecialty:" Терапевт ",syntheticData:true};
 vi.stubEnv("DEMO_MODE","false");expect(()=>registrationFields(body)).toThrow();
 vi.stubEnv("DEMO_MODE","true");expect(()=>registrationFields({...body,syntheticData:false})).toThrow();
 expect(registrationFields(body)).toEqual({role:"DOCTOR",specialty:"Терапевт"});
});
it("keeps patient defaults and rejects unknown roles",()=>{
 expect(registrationFields({})).toEqual({role:"PATIENT",specialty:null});
 expect(registrationFields({accountType:"PATIENT",doctorSpecialty:"Не сохранять"})).toEqual({role:"PATIENT",specialty:null});
 expect(()=>registrationFields({accountType:"ADMIN",syntheticData:true})).toThrow();
});
