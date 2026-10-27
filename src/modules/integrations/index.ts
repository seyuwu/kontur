import {db} from "@/server/db";
import {AppError,requireDoctor,requirePatientAccess,type Actor} from "@/server/access";
import {getClinicalProfile} from "@/modules/clinical-profile";
import {getCareWorkspace} from "@/modules/care";
import {getAssessmentWorkspace} from "@/modules/assessments";
import {exchangeSchema} from "./contract";
export async function exportPatient(actor:Actor,input:{patientId:string;cursor?:string}){
  requireDoctor(actor);const patient=await requirePatientAccess(actor,input.patientId);
  const [clinical,care,assessments]=await Promise.all([getClinicalProfile(actor,patient.id),getCareWorkspace(actor,patient.id),getAssessmentWorkspace(actor,patient.id,input.cursor)]);
  const result=exchangeSchema.parse({contractVersion:"1.0",generatedAt:new Date().toISOString(),patient:{id:patient.id,externalReference:patient.publicId,name:patient.name,birthDate:patient.birthDate.toISOString().slice(0,10)},
    clinical:clinical.current?{version:clinical.current.version,content:clinical.current.content}:null,
    plan:care.current?{id:care.current.id,version:care.current.version,goal:care.current.goal,instructions:care.current.instructions,nextVisitDate:care.current.nextContactDate,tasks:care.current.tasks.map(t=>({id:t.id,kind:t.kind,title:t.title,details:t.details,startDate:t.startDate??null,dueDate:t.dueDate,time:t.time??null,timeZone:"Europe/Moscow",repeat:t.repeat??null,medication:t.medication??null,assignmentId:t.assignmentId}))}:null,
    assessments:{items:assessments.assignments.map(a=>{const form=assessments.definitions.find(d=>d.id===a.definitionId)!.form;return{id:a.id,code:form.code,version:form.version,title:form.title,status:a.status,dueAt:a.dueAt,completedAt:a.completedAt,result:a.submission?.metric??null,answers:a.submission?.answers??null};}),nextCursor:assessments.nextCursor},scope:"current-clinical-profile-current-plan-paged-assessments"});
  const latest=await requirePatientAccess(actor,patient.id);
  if(latest.updatedAt.getTime()!==patient.updatedAt.getTime()||latest.clinicalDataVersion!==patient.clinicalDataVersion)throw new AppError(409,"Данные изменились во время выгрузки. Повторите запрос.");
  await db.auditEvent.create({data:{actorId:actor.id,action:"integration.export.v1",targetId:patient.id}});return result;
}
