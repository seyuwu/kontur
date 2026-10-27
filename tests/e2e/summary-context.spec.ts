import "dotenv/config";
import {randomUUID} from "node:crypto";
import {test,expect,request,type APIRequestContext} from "@playwright/test";
import {db} from "../../src/server/db";
import {authPost} from "./auth-request";
test("live questionnaire summary uses primary, previous and patient context",async()=>{
  test.skip(process.env.RUN_LIVE_SUMMARY_TEST!=="true","Explicit synthetic live-provider run only");
  const origin="http://localhost:3000",ids:string[]=[],clients:APIRequestContext[]=[];let patientId="";
  async function account(role:"DOCTOR"|"PATIENT"){
    const api=await request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});clients.push(api);
    const r=await authPost(api,"/api/auth/sign-up/email",{name:"Учебный участник сводки",email:`context-${randomUUID()}@synthetic.kontur.demo`,password:randomUUID()});expect(r.status()).toBe(200);
    const id=(await r.json()).user.id;ids.push(id);if(role==="DOCTOR")await db.user.update({where:{id},data:{role}});return{api,id};
  }
  try {
    const doctor=await account("DOCTOR"),patient=await account("PATIENT");
    patientId=(await db.patient.create({data:{doctorId:doctor.id,userId:patient.id,name:"Учебный пациент сравнения",publicId:`CTX-${randomUUID()}`,birthDate:new Date("1990-01-01"),note:"На ближайшем приёме уточнить ответы о напряжении."}})).id;
    const catalog=await(await doctor.api.get(`/api/assessments?patientId=${patientId}`)).json();
    const bai=catalog.definitions.find((d:{form:{code:string;version:number}})=>d.form.code==="guideline-f40-bai-demo"&&d.form.version===2);
    const other=catalog.definitions.find((d:{form:{code:string;respondent?:string}})=>d.form.code!==bai.form.code&&d.form.respondent!=="DOCTOR");
    async function submit(def:typeof bai,point:number,date?:Date){
      const assignment=await doctor.api.post("/api/assessments",{data:{action:"assign",patientId,definitionId:def.id}});expect(assignment.status()).toBe(200);const id=(await assignment.json()).id;
      const answers=Object.fromEntries(def.form.questions.map((q:{id:string;options:{id:string;points:number}[]})=>[q.id,(q.options.find(o=>o.points===point)??q.options[0]).id]));
      const r=await patient.api.post("/api/assessments",{data:{action:"submit",assignmentId:id,revision:0,answers,note:"Учебный комментарий к анкете",requestKey:randomUUID()}});expect(r.status()).toBe(200);
      if(date)await db.assessmentSubmission.update({where:{assignmentId:id},data:{createdAt:date}});return id;
    }
    await submit(bai,0,new Date("2026-10-20"));await submit(other,0,new Date("2026-10-22"));const current=await submit(bai,1);
    await db.message.create({data:{patientId,senderId:patient.id,text:"CHAT_MUST_NOT_REPLACE_QUESTIONNAIRE",requestKey:randomUUID()}});
    const input={patientId,assignmentId:current,automatic:true};
    const response=await doctor.api.post("/api/summaries",{data:input});const result=await response.json();expect(response.status(),JSON.stringify(result.error)).toBe(200);
    expect(result.generation).toBe("MODEL");expect(result.facts.length).toBeGreaterThan(0);expect(result.sources[0].role).toBe("PRIMARY");
    for(const role of ["PREVIOUS","RELATED","CONTEXT"])expect(result.sources.some((s:{role:string})=>s.role===role)).toBe(true);
    expect(JSON.stringify(result.sources)).not.toContain("CHAT_MUST_NOT_REPLACE_QUESTIONNAIRE");
    expect(result.sources.find((s:{role:string})=>s.role==="PREVIOUS").text).toContain("difference: 21");
    expect((await(await doctor.api.post("/api/summaries",{data:input})).json()).generatedAt).toBe(result.generatedAt);
    expect(await db.auditEvent.count({where:{actorId:doctor.id,action:"summary.generate",targetId:patientId}})).toBe(1);
    await db.patient.update({where:{id:patientId},data:{note:"Уточнить изменённую заметку"}});
    expect((await(await doctor.api.get(`/api/summaries?patientId=${patientId}&assignmentId=${current}`)).json()).stale).toBe(true);
  }finally{if(patientId)await db.patient.deleteMany({where:{id:patientId}});await db.auditEvent.deleteMany({where:{actorId:{in:ids}}});await db.user.deleteMany({where:{id:{in:ids}}});await Promise.all(clients.map(c=>c.dispose()));await db.$disconnect();}
});
