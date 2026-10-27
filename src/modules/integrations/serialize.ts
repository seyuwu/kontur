import {exchangeSchema,type PatientExchange} from "./contract";
export function csvCell(value:unknown){
  let text=value===null||value===undefined?"":String(value);
  if(/^[\s]*[=+\-@]/.test(text))text="'"+text;
  return `"${text.replaceAll('"','""')}"`;
}
export function serializeExchange(input:PatientExchange,format:"json"|"csv"){
  const data=exchangeSchema.parse(input);
  if(format==="json")return{contentType:"application/json; charset=utf-8",extension:"json",body:JSON.stringify(data,null,2)};
  const rows:unknown[][]=[["record_type","id","title","status","date","value","details"],["patient",data.patient.id,data.patient.name,"",data.patient.birthDate,data.patient.externalReference,"contractVersion=1.0"]];
  if(data.clinical)rows.push(["clinical",data.patient.id,"Клинические сведения",data.clinical.version,"","",JSON.stringify(data.clinical.content)]);
  if(data.plan){rows.push(["plan",data.plan.id,data.plan.goal,data.plan.version,data.plan.nextVisitDate,"",data.plan.instructions]);for(const task of data.plan.tasks)rows.push([task.kind.toLowerCase(),task.id,task.title,task.repeat,task.startDate??task.dueDate,task.medication?.dose,JSON.stringify({details:task.details,time:task.time,timeZone:task.timeZone,dueDate:task.dueDate,assignmentId:task.assignmentId})]);}
  for(const form of data.assessments.items)rows.push(["assessment",form.id,form.title,form.status,form.completedAt??form.dueAt,form.result?.value,JSON.stringify({code:form.code,version:form.version,result:form.result,answers:form.answers})]);
  rows.push(["metadata","","scope","",data.generatedAt,data.assessments.nextCursor, data.scope]);
  return{contentType:"text/csv; charset=utf-8",extension:"csv",body:"\uFEFF"+rows.map(row=>row.map(csvCell).join(",")).join("\r\n")+"\r\n"};
}
