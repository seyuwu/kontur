import {appointmentReminderDue} from "../../src/modules/web-push/reminders";
import { describe, it, expect } from "vitest";
import { appointmentSchema, appointmentLabel, visitLabel, visitDateValue, visitTimeValue } from "../../src/lib/appointment";
import { careContentSchema } from "../../src/modules/care/contract";
import { careDocumentText } from "../../src/modules/care/document";
import type { CarePlanData } from "../../src/lib/care";
const appointment = { at: "2026-11-03T15:30", format: "IN_PERSON" as const, location: "Учебный кабинет", timezone: "Europe/Moscow" as const };
describe("Appointment and contact deadline", () => {
  it("keeps contact deadline separate and accepts older plans without an appointment", () => {
    const content={goal:"Учебный план",instructions:"Согласованные шаги",nextContactDate:"2026-11-01",tasks:[]};
    expect(careContentSchema.parse(content).appointment).toBeUndefined();
    const result=careContentSchema.parse({...content,appointment});
    expect(result.nextContactDate).toBe("2026-11-01"); expect(result.appointment?.at).toBe("2026-11-03T15:30");
  });
  it("requires a real date, exact time, known format and place or connection instructions", () => {
    for(const at of ["2026-02-30T15:30","2026-11-03","2026-11-03T25:00","2026-11-03T15:30Z"]) expect(appointmentSchema.safeParse({...appointment,at}).success).toBe(false);
    expect(appointmentSchema.safeParse({...appointment,location:""}).success).toBe(false);
    expect(appointmentSchema.safeParse({...appointment,format:"VIDEO",location:""}).success).toBe(false);
    expect(appointmentSchema.safeParse({...appointment,format:"PHONE",location:""}).success).toBe(true);
  });
  it("renders Moscow time consistently in the shared display and exported plan", () => {
    expect(appointmentLabel(appointment)).toContain("15:30"); expect(appointmentLabel(appointment)).toContain("МСК");
    const plan:CarePlanData={id:"demo",version:1,goal:"Цель",instructions:"Памятка",nextContactDate:"2026-11-01",appointment,confirmedAt:"2026-10-24T09:00:00Z",confirmedBy:"Учебный врач",tasks:[],isCurrent:true};
    const text=careDocumentText(plan,{name:"Учебный пациент",publicId:"TEST",birthDate:"1990-01-01"},"patient",true);
    expect(text).toContain("Дата следующего приёма:");expect(text).toContain("15:30");expect(text).not.toContain("Связаться до");
  });
});

it("keeps Moscow midnight on the same local date and never invents a legacy time",()=>{
 expect(visitDateValue("2026-11-04T21:30:00Z")).toBe("2026-11-05");
 expect(visitTimeValue("2026-11-04T21:30:00Z")).toBe("00:30");
 expect(visitLabel("2026-11-04T21:30:00Z",true)).toContain("00:30");
 expect(visitLabel("2026-11-05T09:00:00Z",false)).not.toContain("12:00");
 expect(appointmentSchema.safeParse({...appointment,format:"UNSPECIFIED",location:""}).success).toBe(true);
});

it("schedules appointment reminders only in the two-hour window with a known time",()=>{
 const at=new Date("2026-11-05T12:30:00Z");
 expect(appointmentReminderDue(at,true,new Date("2026-11-05T10:29:59Z"))).toBe(false);
 expect(appointmentReminderDue(at,true,new Date("2026-11-05T10:30:00Z"))).toBe(true);
 expect(appointmentReminderDue(at,true,new Date("2026-11-05T12:30:00Z"))).toBe(false);
 expect(appointmentReminderDue(at,false,new Date("2026-11-05T10:30:00Z"))).toBe(false);
});
