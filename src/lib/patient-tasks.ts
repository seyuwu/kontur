import {moscowDate,assessmentDateAfter} from "./assessment-deadline";
import type {CareTaskData} from "./care";
export function patientTaskSchedule(task:CareTaskData,confirmedAt:string,doneToday:boolean,now=new Date()){
  const today=moscowDate(now),start=task.startDate??moscowDate(new Date(confirmedAt));
  if(task.kind==="ASSESSMENT")return null;
  let date=task.repeat ? [today,start].sort().at(-1)! : task.startDate??task.dueDate??today;
  if(task.repeat && doneToday && date===today)date=assessmentDateAfter(1,now);
  if(task.dueDate && task.repeat && date>task.dueDate)return null;
  if(!task.repeat && task.report?.state==="DONE")return null;
  const days=Math.round((new Date(`${date}T12:00:00Z`).getTime()-new Date(`${today}T12:00:00Z`).getTime())/86400000);
  const label=days===0?"Сегодня":days===1?"Завтра":days>1?`Через ${days} дн.`:"Срок прошёл";
  return {date,label,upcoming:date>today,canReport:!task.repeat&&task.kind!=="MEDICATION"||date<=today && (!task.repeat||date===today)};
}
