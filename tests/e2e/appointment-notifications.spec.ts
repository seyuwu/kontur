import "dotenv/config";
import {randomUUID,createECDH,randomBytes} from "node:crypto";
import {test,expect,request,type APIRequestContext} from "@playwright/test";
import {db} from "../../src/server/db";
import {authPost} from "./auth-request";
import {schedulePatientReminders,reminderEligible} from "../../src/modules/web-push/reminders";
import {processPush} from "../../src/modules/web-push";
test("appointment time reaches patient and push; stale and repeated appointments do not notify",async({browser})=>{
 const origin="http://localhost:3000",clients:APIRequestContext[]=[],users:string[]=[];let patientId="";
 async function account(role:"DOCTOR"|"PATIENT"){
  const api=await request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});clients.push(api);
  const r=await authPost(api,"/api/auth/sign-up/email",{name:"Учебный участник приёма",email:`time-${randomUUID()}@synthetic.kontur.demo`,password:randomUUID()});expect(r.status()).toBe(200);
  const id=(await r.json()).user.id;users.push(id);if(role==="DOCTOR")await db.user.update({where:{id},data:{role}});return{api,id};
 }
 try{
  const doctor=await account("DOCTOR"),patient=await account("PATIENT");
  patientId=(await db.patient.create({data:{doctorId:doctor.id,userId:patient.id,name:"Учебный пациент времени",publicId:`TIME-${randomUUID()}`,birthDate:new Date("1990-01-01")}})).id;
  const curve=createECDH("prime256v1");curve.generateKeys();
  expect((await patient.api.post("/api/push",{data:{action:"connect",label:"Тест приёма",subscription:{endpoint:`https://fcm.googleapis.com/fcm/send/synthetic-${randomUUID()}`,keys:{p256dh:curve.getPublicKey().toString("base64url"),auth:randomBytes(16).toString("base64url")}}}})).status()).toBe(200);
  const first={action:"schedule-visit",patientId,date:"2026-11-05",time:"15:30",expectedPlanId:null,expectedNextVisit:null,requestKey:randomUUID()};
  expect((await doctor.api.post("/api/care",{data:first})).status()).toBe(200);
  expect((await doctor.api.post("/api/care",{data:first})).status()).toBe(200);
  let saved=await db.patient.findUniqueOrThrow({where:{id:patientId}});expect(saved.nextVisit!.toISOString()).toBe("2026-11-05T12:30:00.000Z");expect(saved.nextVisitHasTime).toBe(true);
  let reminders=await db.patientReminder.findMany({where:{patientId},include:{deliveries:true},orderBy:{createdAt:"asc"}});expect(reminders).toHaveLength(1);expect(reminders[0].deliveries).toHaveLength(1);
  let sent=0;await processPush(reminders[0].deliveries[0].id,async(_sub,payload)=>{sent++;expect(payload.type).toBe("kontur-appointment");expect(payload.appointmentAt).toBe("2026-11-05T12:30:00.000Z");expect(payload.appointmentHasTime).toBe(true);expect(payload.url).toBe("/patient");});expect(sent).toBe(1);
  for(const time of ["16:00","17:00"]){expect((await doctor.api.post("/api/care",{data:{...first,time,expectedNextVisit:saved.nextVisit!.toISOString(),requestKey:randomUUID()}})).status()).toBe(200);saved=await db.patient.findUniqueOrThrow({where:{id:patientId}});}
  reminders=await db.patientReminder.findMany({where:{patientId},include:{deliveries:true},orderBy:{createdAt:"asc"}});
  await processPush(reminders[1].deliveries[0].id,async()=>{throw Error("stale appointment must not send");});expect((await db.pushDelivery.findUniqueOrThrow({where:{id:reminders[1].deliveries[0].id}})).status).toBe("CANCELLED");
  await processPush(reminders[2].deliveries[0].id,async(_sub,payload)=>{expect(payload.appointmentAt).toBe("2026-11-05T14:00:00.000Z");});
  const context=await browser.newContext({storageState:await patient.api.storageState(),viewport:{width:390,height:844}}),page=await context.newPage();await page.goto("/patient");await expect(page.locator(".patient-appointment-strip")).toContainText("17:00");await page.screenshot({path:".impeccable/review/patient-appointment-time-390.png",fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await schedulePatientReminders(new Date("2026-11-05T11:59:59Z"),patientId);
  expect(await db.patientReminder.count({where:{patientId,kind:"APPOINTMENT_REMINDER"}})).toBe(0);
  const twoHoursBefore=new Date("2026-11-05T12:00:00Z");
  await schedulePatientReminders(twoHoursBefore,patientId);await schedulePatientReminders(twoHoursBefore,patientId);
  const soon=await db.patientReminder.findFirstOrThrow({where:{patientId,kind:"APPOINTMENT_REMINDER"},include:{deliveries:true}});
  expect(await db.patientReminder.count({where:{patientId,kind:"APPOINTMENT_REMINDER"}})).toBe(1);expect(soon.deliveries).toHaveLength(1);
  expect(await reminderEligible(soon,patient.id,twoHoursBefore)).toBe(true);
  await processPush(soon.deliveries[0].id,async(_sub,payload)=>{expect(payload.type).toBe("kontur-appointment-reminder");expect(payload.appointmentAt).toBe("2026-11-05T14:00:00.000Z");},twoHoursBefore);
  expect((await doctor.api.post("/api/care",{data:{...first,date:null,time:null,expectedNextVisit:saved.nextVisit!.toISOString(),requestKey:randomUUID()}})).status()).toBe(200);
  expect(await reminderEligible(soon,patient.id,twoHoursBefore)).toBe(false);
  const cancelled=await db.patientReminder.findFirstOrThrow({where:{patientId,kind:"APPOINTMENT_CANCELLED"},include:{deliveries:true}});await processPush(cancelled.deliveries[0].id,async(_sub,payload)=>{expect(payload.type).toBe("kontur-appointment-cancelled");});
  await expect(page.locator(".patient-appointment-strip")).toHaveCount(0);await context.close();
 }finally{if(patientId)await db.patient.deleteMany({where:{id:patientId}});await db.auditEvent.deleteMany({where:{actorId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await Promise.all(clients.map(c=>c.dispose()));await db.$disconnect();}
});
