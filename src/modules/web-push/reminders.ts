import {z} from "zod";
import {medicationSchema} from "@/modules/care/contract";
import {medicationActiveDay,medicationTimes,medicationTime} from "@/lib/medication-regimen";
import {createHash} from "node:crypto";
import type {Prisma,PatientReminder,CareTask} from "@/generated/prisma/client";
import {db} from "@/server/db";
import {pushConfiguration} from "./config";
import {moscowDate} from "@/lib/assessment-deadline";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const config=()=>pushConfiguration(process.env.DEMO_MODE==="true"?"DEMO":"CLINICAL");
export function medicationOccurrence(task:Pick<CareTask,"startDate"|"time"|"dueDate"|"repeat">,confirmedAt:Date,now:Date){
  const day=moscowDate(now);
  if(!task.startDate||!task.time||day<task.startDate||(task.dueDate&&day>task.dueDate)||(!task.repeat&&day!==task.startDate))return null;
  const at=new Date(`${day}T${task.time}:00+03:00`);
  if(at<confirmedAt||now<at||now.getTime()-at.getTime()>2*3600000)return null;
  return at;
}
export function assignmentReminderOccurrence(createdAt:Date,dueAt:Date|null,now:Date){
  const day=moscowDate(now),at=new Date(`${day}T09:00:00+03:00`);
  if(day<=moscowDate(createdAt)||(dueAt&&day>moscowDate(dueAt))||now<at||now.getTime()-at.getTime()>12*3600000)return null;
  return at;
}
export function appointmentReminderDue(at:Date|null,hasTime:boolean,now:Date){
  if(!at||!hasTime)return false;
  const remaining=at.getTime()-now.getTime();return remaining>0&&remaining<=2*3600000;
}
type Input={key:string;patientId:string;recipientId:string;kind:"APPOINTMENT_REMINDER"|"APPOINTMENT"|"APPOINTMENT_CANCELLED"|"PLAN"|"MEDICATION"|"MEDICATION_UPCOMING"|"ASSESSMENT_REMINDER";planId?:string;taskId?:string;assignmentId?:string;dueAt:Date};
export async function enqueuePatientReminder(tx:Prisma.TransactionClient,input:Input){
  const c=config();if(!c.enabled)return;
  const reminder=await tx.patientReminder.upsert({where:{key:input.key},create:input,update:{}});
  if(reminder.recipientId!==input.recipientId)return;
  const devices=await tx.pushDevice.findMany({where:{userId:input.recipientId,active:true,keyFingerprint:hash(c.publicKey),session:{expiresAt:{gt:new Date()}}},take:5});
  const rows=await tx.pushDelivery.createManyAndReturn({data:devices.map(device=>({reminderId:reminder.id,deviceId:device.id,sessionId:device.sessionId!,purpose:"REMINDER"})),skipDuplicates:true});
  for(const row of rows)await tx.$queryRaw`SELECT graphile_worker.add_job('notification_push', ${JSON.stringify({deliveryId:row.id})}::json, priority := -20, max_attempts := 1, job_key := ${`push:${row.id}:1`})`;
}
export async function reminderEligible(reminder:PatientReminder,userId:string,now=new Date()){
  const patient=await db.patient.findFirst({where:{id:reminder.patientId,userId}});
  if(!patient||reminder.recipientId!==userId)return false;
  if(reminder.kind==="ASSESSMENT_REMINDER"){
    const assignment=await db.assessmentAssignment.findFirst({where:{id:reminder.assignmentId??"",patientId:patient.id,status:{in:["ASSIGNED","IN_PROGRESS"]}},include:{definition:true}});
    return !!assignment && (assignment.definition.content as {respondent?:string}).respondent!=="DOCTOR" && moscowDate(reminder.dueAt)===moscowDate(now) && (!assignment.dueAt||now<=assignment.dueAt);
  }
  if(reminder.kind==="APPOINTMENT_REMINDER")return reminder.key===`visit-reminder:${patient.id}:${patient.nextVisitRevision}:${userId}` && patient.nextVisit?.getTime()===reminder.dueAt.getTime() && appointmentReminderDue(patient.nextVisit,patient.nextVisitHasTime,now);
  if(reminder.kind==="APPOINTMENT"||reminder.kind==="APPOINTMENT_CANCELLED")return reminder.key===`visit:${patient.id}:${patient.nextVisitRevision}:${userId}` && now.getTime()-reminder.createdAt.getTime()<86400000 && (reminder.kind==="APPOINTMENT_CANCELLED" ? !patient.nextVisit : patient.nextVisit?.getTime()===reminder.dueAt.getTime());
  if(!patient.currentPlanId)return false;
  if(reminder.kind==="PLAN")return patient.currentPlanId===reminder.planId && now.getTime()-reminder.createdAt.getTime()<86400000;
  const upcoming=reminder.kind==="MEDICATION_UPCOMING";
  if(!upcoming&&(reminder.kind!=="MEDICATION"||reminder.dueAt>now||now.getTime()-reminder.dueAt.getTime()>2*3600000))return false;
  const link=await db.carePlanTask.findUnique({where:{planId_taskId:{planId:patient.currentPlanId,taskId:reminder.taskId!}},include:{task:true,plan:true}});
  if(!link||link.task.kind!=="MEDICATION")return false;
  if(upcoming)return !!link.task.startDate&&new Date(`${link.task.startDate}T12:00:00Z`).getTime()-new Date(`${moscowDate(now)}T12:00:00Z`).getTime()===2*86400000;
  const regimen=medicationSchema.parse(link.task.medication).regimen;
  if(regimen){
    const selected=regimen.timeMode==="PATIENT"?await db.medicationSchedule.findFirst({where:{taskId:link.taskId,userId},orderBy:{revision:"desc"}}):null;
    const times=medicationTimes(regimen,selected?z.array(medicationTime).parse(selected.times):[]);
    const time=new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",hourCycle:"h23",timeZone:"Europe/Moscow"}).format(reminder.dueAt);
    if(reminder.key!==`med:${link.taskId}:${moscowDate(reminder.dueAt)}:${time}:${userId}:r${selected?.revision??0}`)return false;
    if(!link.task.startDate||!times.includes(time)||!medicationActiveDay(link.task.startDate,regimen.everyDays,moscowDate(now))||(link.task.dueDate&&moscowDate(now)>link.task.dueDate)||moscowDate(reminder.dueAt)!==moscowDate(now))return false;
    const done=await db.careDailyReport.findFirst({where:{taskId:link.taskId,date:moscowDate(now),time,planVersion:{patientId:patient.id,version:{lte:link.plan.version}}},orderBy:{revision:"desc"}});
    return done?.state!=="DONE";
  }
  const first=await db.carePlanTask.findFirst({where:{taskId:link.taskId,plan:{patientId:patient.id}},orderBy:{plan:{version:"asc"}},select:{plan:{select:{confirmedAt:true}}}});
  if(!medicationOccurrence(link.task,first!.plan.confirmedAt,now))return false;
  const done=link.task.repeat ? await db.careDailyReport.findFirst({where:{taskId:link.taskId,date:moscowDate(now),planVersion:{patientId:patient.id,version:{lte:link.plan.version}}},orderBy:{revision:"desc"}}) : await db.careTaskReport.findFirst({where:{taskId:link.taskId,planVersion:{patientId:patient.id,version:{lte:link.plan.version}}},orderBy:{revision:"desc"}});
  return done?.state!=="DONE";
}
export async function schedulePatientReminders(now=new Date(),patientId?:string){
  if(!config().enabled)return;
  let cursor:string|undefined;
  do{
    const patients=await db.patient.findMany({where:{...(patientId?{id:patientId}:{}),userId:{not:null},OR:[{nextVisitHasTime:true,nextVisit:{gt:now,lte:new Date(now.getTime()+2*3600000)}},{currentPlanId:{not:null}},{assessments:{some:{status:{in:["ASSIGNED","IN_PROGRESS"]}}}}]},orderBy:{id:"asc"},take:100,...(cursor?{cursor:{id:cursor},skip:1}:{}),include:{currentPlan:{include:{tasks:{include:{task:true}}}},assessments:{where:{status:{in:["ASSIGNED","IN_PROGRESS"]}},include:{definition:true}}}});
    for(const patient of patients){
      const recipientId=patient.userId!;
      if(appointmentReminderDue(patient.nextVisit,patient.nextVisitHasTime,now)){
        const announced=await db.patientReminder.findUnique({where:{key:`visit:${patient.id}:${patient.nextVisitRevision}:${recipientId}`},select:{createdAt:true}});
        // A newly booked appointment inside this window already has its confirmation notification.
        if(!announced || announced.createdAt.getTime()<=patient.nextVisit!.getTime()-2*3600000)await db.$transaction(tx=>enqueuePatientReminder(tx,{key:`visit-reminder:${patient.id}:${patient.nextVisitRevision}:${recipientId}`,kind:"APPOINTMENT_REMINDER",patientId:patient.id,recipientId,dueAt:patient.nextVisit!}));
      }
      for(const {task} of patient.currentPlan?.tasks??[]){
        if(task.kind!=="MEDICATION")continue;
        const regimen=medicationSchema.parse(task.medication).regimen;
        if(regimen){
          const day=moscowDate(now);if(!task.startDate)continue;
          const chosen=regimen.timeMode==="PATIENT"?await db.medicationSchedule.findFirst({where:{taskId:task.id,userId:recipientId},orderBy:{revision:"desc"}}):null;
          const times=medicationTimes(regimen,chosen?z.array(medicationTime).parse(chosen.times):[]);
          if(times.length && new Date(`${task.startDate}T12:00:00Z`).getTime()-new Date(`${day}T12:00:00Z`).getTime()===2*86400000 && now>=new Date(`${day}T09:00:00+03:00`))await db.$transaction(tx=>enqueuePatientReminder(tx,{key:`med-upcoming:${task.id}:${recipientId}`,kind:"MEDICATION_UPCOMING",patientId:patient.id,recipientId,planId:patient.currentPlan!.id,taskId:task.id,dueAt:new Date(`${task.startDate}T${times[0]}:00+03:00`)}));
          if(!medicationActiveDay(task.startDate,regimen.everyDays,day)||(task.dueDate&&day>task.dueDate))continue;
          const first=await db.carePlanTask.findFirst({where:{taskId:task.id,plan:{patientId:patient.id}},orderBy:{plan:{version:"asc"}},select:{plan:{select:{confirmedAt:true}}}});
          for(const time of times){const at=new Date(`${day}T${time}:00+03:00`);if(at<first!.plan.confirmedAt||now<at||now.getTime()-at.getTime()>2*3600000)continue;
            const sent=await db.patientReminder.findFirst({where:{patientId:patient.id,recipientId,taskId:task.id,kind:"MEDICATION",dueAt:at,deliveries:{some:{status:{in:["SENDING","ACCEPTED","SHOWN","UNCERTAIN"]}}}},select:{id:true}});if(sent)continue;
            await db.$transaction(tx=>enqueuePatientReminder(tx,{key:`med:${task.id}:${day}:${time}:${recipientId}:r${chosen?.revision??0}`,kind:"MEDICATION",patientId:patient.id,recipientId,planId:patient.currentPlan!.id,taskId:task.id,dueAt:at}));
          }
          continue;
        }
        if(task.startDate && new Date(`${task.startDate}T12:00:00Z`).getTime()-new Date(`${moscowDate(now)}T12:00:00Z`).getTime()===2*86400000 && now>=new Date(`${moscowDate(now)}T09:00:00+03:00`))await db.$transaction(tx=>enqueuePatientReminder(tx,{key:`med-upcoming:${task.id}:${recipientId}`,kind:"MEDICATION_UPCOMING",patientId:patient.id,recipientId,planId:patient.currentPlan!.id,taskId:task.id,dueAt:new Date(`${task.startDate}T${task.time}:00+03:00`)}));
        const first=await db.carePlanTask.findFirst({where:{taskId:task.id,plan:{patientId:patient.id}},orderBy:{plan:{version:"asc"}},select:{plan:{select:{confirmedAt:true}}}});
        const at=medicationOccurrence(task,first!.plan.confirmedAt,now);if(!at)continue;
        await db.$transaction(tx=>enqueuePatientReminder(tx,{key:`med:${task.id}:${moscowDate(at)}:${recipientId}`,kind:"MEDICATION",patientId:patient.id,recipientId,planId:patient.currentPlan!.id,taskId:task.id,dueAt:at}));
      }
      for(const assignment of patient.assessments){
        if((assignment.definition.content as {respondent?:string}).respondent==="DOCTOR")continue;
        const at=assignmentReminderOccurrence(assignment.createdAt,assignment.dueAt,now);if(!at)continue;
        await db.$transaction(tx=>enqueuePatientReminder(tx,{key:`assessment:${assignment.id}:${moscowDate(at)}:${recipientId}`,kind:"ASSESSMENT_REMINDER",patientId:patient.id,recipientId,assignmentId:assignment.id,dueAt:at}));
      }
    }
    cursor=patients.length===100?patients.at(-1)!.id:undefined;
  }while(cursor);
}
