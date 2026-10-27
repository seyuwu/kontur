import {z} from "zod";
import {db,lockFollowUp,followUpEvent} from "@/modules/follow-up/shared";
import {AppError,type Actor} from "@/server/access";
import {fingerprint} from "@/modules/assessments/definitions";
import {medicationSchema} from "./contract";
import {medicationActiveDay,medicationTimes,medicationTime} from "@/lib/medication-regimen";
import {moscowDate} from "@/lib/assessment-deadline";
export async function medicationTaskState(taskId:string,userId:string|null,version:number){
 const [schedule,rows]=await Promise.all([
  userId?db.medicationSchedule.findFirst({where:{taskId,userId},orderBy:{revision:"desc"}}):null,
  db.careDailyReport.findMany({where:{taskId,planVersion:{version:{lte:version}}},orderBy:[{date:"desc"},{revision:"desc"}],take:96})
 ]);
 const seen=new Set<string>();const intakes=rows.filter(r=>{const key=`${r.date}:${r.time}`;if(!r.time||seen.has(key))return false;seen.add(key);return true;});
 return {medicationSchedule:schedule?{revision:schedule.revision,times:z.array(medicationTime).parse(schedule.times)}:null,medicationIntakes:intakes.map(r=>({date:r.date,time:r.time,state:r.state,note:r.note,revision:r.revision})),dayRevision:rows.find(r=>r.date===moscowDate())?.revision??0};
}
type Base={patientId:string;planVersionId:string;taskId:string;revision:number;requestKey:string};
export async function chooseMedicationTimes(actor:Actor,data:Base&{times:string[]}){
 if(actor.role!=="PATIENT")throw new AppError(403,"Время выбирает пациент.");
 return db.$transaction(async tx=>{
  const patient=await lockFollowUp(tx,actor,data.patientId);const hash=fingerprint([actor.id,data]);
  const replay=await tx.medicationSchedule.findUnique({where:{requestKey:data.requestKey}});if(replay){if(replay.payloadHash!==hash)throw new AppError(409,"Ключ сохранения уже использован.");return{saved:true};}
  if(patient.currentPlanId!==data.planVersionId)throw new AppError(409,"Врач обновил назначения. Откройте актуальный план.");
  const link=await tx.carePlanTask.findUnique({where:{planId_taskId:{planId:data.planVersionId,taskId:data.taskId}},include:{task:true}});
  if(!link||link.task.patientId!==patient.id||link.task.kind!=="MEDICATION")throw new AppError(404,"Назначение недоступно.");
  const regimen=medicationSchema.parse(link.task.medication).regimen;
  if(!regimen||regimen.timeMode!=="PATIENT")throw new AppError(409,"Время этого назначения задаёт врач.");
  const times=medicationTimes(regimen,data.times);if(!times.length)throw new AppError(400,`Выберите ${regimen.timesPerDay} разных времени приёма.`);
  const previous=await tx.medicationSchedule.findFirst({where:{taskId:data.taskId,userId:actor.id},orderBy:{revision:"desc"}});
  if((previous?.revision??0)!==data.revision)throw new AppError(409,"Расписание уже изменилось. Обновите страницу.");
  const reported=await tx.careDailyReport.findMany({where:{taskId:data.taskId,date:moscowDate(),time:{not:""}},distinct:["time"],select:{time:true}});
  if(reported.some(row=>!times.includes(row.time)))throw new AppError(409,"Время приёмов с сегодняшними отметками изменить нельзя. Остальные часы можно перенести.");
  if(previous&&JSON.stringify(z.array(medicationTime).parse(previous.times).sort())===JSON.stringify(times))return{saved:true};
  const row=await tx.medicationSchedule.create({data:{taskId:data.taskId,userId:actor.id,revision:data.revision+1,times,requestKey:data.requestKey,payloadHash:hash}});
  await followUpEvent(tx,actor,patient.id,"medication.schedule","Пациент выбрал время приёма",`${link.task.title}: ${times.join(", ")} (МСК)`,row.id);
  return{saved:true};
 });
}
export async function reportMedicationIntake(actor:Actor,data:Base&{date:string;time:string;state:"DONE"|"NOT_DONE"|"PARTIAL"|"UNSURE";note:string}){
 if(actor.role!=="PATIENT")throw new AppError(403,"Отметку оставляет пациент.");
 return db.$transaction(async tx=>{
  const patient=await lockFollowUp(tx,actor,data.patientId);const hash=fingerprint([actor.id,data]);
  const replay=await tx.careDailyReport.findUnique({where:{requestKey:data.requestKey}});if(replay){if(replay.payloadHash!==hash)throw new AppError(409,"Ключ отметки уже использован.");return{saved:true};}
  if(patient.currentPlanId!==data.planVersionId||data.date!==moscowDate())throw new AppError(409,"Откройте сегодняшние назначения.");
  const link=await tx.carePlanTask.findUnique({where:{planId_taskId:{planId:data.planVersionId,taskId:data.taskId}},include:{task:true,plan:true}});
  if(!link||link.task.patientId!==patient.id||link.task.kind!=="MEDICATION")throw new AppError(404,"Назначение недоступно.");
  const r=medicationSchema.parse(link.task.medication).regimen;
  if(!r||!link.task.startDate||!medicationActiveDay(link.task.startDate,r.everyDays,data.date)||(link.task.dueDate&&data.date>link.task.dueDate)||data.date<moscowDate(link.plan.confirmedAt))throw new AppError(409,"В этот день приём по назначению не предусмотрен.");
  const schedule=r.timeMode==="PATIENT"?await tx.medicationSchedule.findFirst({where:{taskId:data.taskId,userId:actor.id},orderBy:{revision:"desc"}}):null;
  if(!medicationTimes(r,schedule?z.array(medicationTime).parse(schedule.times):[]).includes(data.time)||new Date(`${data.date}T${data.time}:00+03:00`)>new Date())throw new AppError(409,"Время приёма ещё не наступило или расписание изменилось.");
  const previous=await tx.careDailyReport.findFirst({where:{taskId:data.taskId,date:data.date},orderBy:{revision:"desc"}});
  if((previous?.revision??0)!==data.revision)throw new AppError(409,"Отметки уже изменились. Обновите назначения.");
  const row=await tx.careDailyReport.create({data:{taskId:data.taskId,planVersionId:data.planVersionId,date:data.date,time:data.time,revision:data.revision+1,state:data.state,note:data.note,actorId:actor.id,requestKey:data.requestKey,payloadHash:hash}});
  await followUpEvent(tx,actor,patient.id,"medication.report","Отметка о приёме лекарства",`${link.task.title} · ${data.date} ${data.time}`,row.id);return{saved:true};
 });
}
