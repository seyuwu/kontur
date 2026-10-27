import {expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import {careContentSchema} from "../../src/modules/care/contract";
import {patientTaskSchedule} from "../../src/lib/patient-tasks";
import {medicationOccurrence,assignmentReminderOccurrence} from "../../src/modules/web-push/reminders";
const task={id:randomUUID(),kind:"MEDICATION" as const,title:"Учебное лекарство",details:"Учебное назначение",assignmentId:null,dueDate:"2026-10-30",startDate:"2026-10-26",time:"09:30",medication:{name:"Учебное лекарство",dose:"Учебная доза"},repeat:"DAILY" as const,report:null,assignment:null};
it("requires physician-entered medication, dose, start date and time, rejecting reversed dates",()=>{
  const content={goal:"Учебный план",instructions:"Учебная памятка",nextContactDate:null,tasks:[task]};
  const {report:_,assignment:__,...input}=task;
  expect(careContentSchema.safeParse({...content,tasks:[input]}).success).toBe(true);
  for(const patch of [{medication:undefined},{time:undefined},{startDate:undefined},{time:"25:01"},{dueDate:"2026-10-25"}])expect(careContentSchema.safeParse({...content,tasks:[{...input,...patch}]}).success).toBe(false);
});
it("shows upcoming, today's and next daily intake and hides completed single tasks",()=>{
  expect(patientTaskSchedule(task,"2026-10-24T06:00:00Z",false,new Date("2026-10-24T07:00:00Z"))).toMatchObject({label:"Через 2 дн.",upcoming:true,canReport:false});
  expect(patientTaskSchedule(task,"2026-10-24T06:00:00Z",false,new Date("2026-10-26T07:00:00Z"))).toMatchObject({label:"Сегодня",canReport:true});
  expect(patientTaskSchedule(task,"2026-10-24T06:00:00Z",true,new Date("2026-10-26T07:00:00Z"))).toMatchObject({label:"Завтра",canReport:false});
  expect(patientTaskSchedule(task,"2026-10-24T06:00:00Z",true,new Date("2026-10-30T07:00:00Z"))).toBeNull();
  expect(patientTaskSchedule({...task,repeat:undefined,report:{id:"r",state:"DONE",revision:1,note:"",createdAt:"2026-10-26",planVersion:1}},"2026-10-24T06:00:00Z",false,new Date("2026-10-26T07:00:00Z"))).toBeNull();
});
it("schedules medication only when due in Moscow, with a two-hour grace and no catch-up before confirmation",()=>{
  const confirmed=new Date("2026-10-24T06:00:00Z");
  expect(medicationOccurrence(task,confirmed,new Date("2026-10-26T06:29:00Z"))).toBeNull();
  expect(medicationOccurrence(task,confirmed,new Date("2026-10-26T06:30:00Z"))?.toISOString()).toBe("2026-10-26T06:30:00.000Z");
  expect(medicationOccurrence(task,confirmed,new Date("2026-10-26T08:31:00Z"))).toBeNull();
  expect(medicationOccurrence(task,confirmed,new Date("2026-10-31T06:30:00Z"))).toBeNull();
  expect(medicationOccurrence(task,new Date("2026-10-26T06:31:00Z"),new Date("2026-10-26T06:32:00Z"))).toBeNull();
  expect(medicationOccurrence({...task,repeat:null},confirmed,new Date("2026-10-27T06:30:00Z"))).toBeNull();
});
it("reminds about questionnaires from the next day at 9 Moscow and stops after their deadline",()=>{
  const created=new Date("2026-10-24T06:00:00Z"),due=new Date("2026-10-27T20:59:59Z");
  expect(assignmentReminderOccurrence(created,due,new Date("2026-10-24T09:00:00Z"))).toBeNull();
  expect(assignmentReminderOccurrence(created,due,new Date("2026-10-25T05:59:00Z"))).toBeNull();
  expect(assignmentReminderOccurrence(created,due,new Date("2026-10-25T06:00:00Z"))?.toISOString()).toBe("2026-10-25T06:00:00.000Z");
  expect(assignmentReminderOccurrence(created,due,new Date("2026-10-28T06:00:00Z"))).toBeNull();
});
