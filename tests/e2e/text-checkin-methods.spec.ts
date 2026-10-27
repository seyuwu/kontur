import "dotenv/config";
import { randomUUID, randomBytes, createECDH } from "node:crypto";
import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { db } from "../../src/server/db";
import { authPost } from "./auth-request";
import { processPush } from "../../src/modules/web-push";
const origin = "http://localhost:3000";
test.describe.serial("Text check-in and guideline methods", () => {
  let doctor: APIRequestContext, patient: APIRequestContext, other: APIRequestContext;
  let patientId="", hamId="", sclId=""; const userIds: string[]=[];
  test.beforeAll(async()=>{
    async function account(role: "DOCTOR" | "PATIENT") {
      const client=await request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});
      const response=await authPost(client,"/api/auth/sign-up/email",{name:"Учебный пример",email:`methods-${randomUUID()}@synthetic.kontur.demo`,password:randomUUID()});
      expect(response.status()).toBe(200); const id=(await response.json()).user.id; userIds.push(id);
      if(role==="DOCTOR") await db.user.update({where:{id},data:{role}});
      return {client,id};
    }
    const d=await account("DOCTOR"), p=await account("PATIENT"), o=await account("DOCTOR"); doctor=d.client; patient=p.client; other=o.client;
    patientId=(await db.patient.create({data:{doctorId:d.id,userId:p.id,name:"Учебная карточка",publicId:`METHODS-${randomUUID()}`,birthDate:new Date("1990-01-01")}})).id;
  });
  test.afterAll(async()=>{
    if(patientId) await db.patient.deleteMany({where:{id:patientId}});
    await db.auditEvent.deleteMany({where:{actorId:{in:userIds}}}); await db.user.deleteMany({where:{id:{in:userIds}}});
    await Promise.all([doctor?.dispose(),patient?.dispose(),other?.dispose()]); await db.$disconnect();
  });
  test("saves a text-only observation and a contact-only request without fabricated score",async()=>{
    const input={action:"observation",patientId,note:"Учебный текст без оценки",needsContact:false,requestKey:randomUUID()};
    expect((await patient.post("/api/workspace",{data:input})).status()).toBe(200);
    expect((await patient.post("/api/workspace",{data:input})).status()).toBe(200);
    const rows=await db.observation.findMany({where:{patientId}}); expect(rows).toHaveLength(1); expect(rows[0].score).toBeNull();
    expect((await patient.post("/api/workspace",{data:{...input,note:"",needsContact:true,requestKey:randomUUID()}})).status()).toBe(200);
    expect((await patient.post("/api/workspace",{data:{...input,note:"",requestKey:randomUUID()}})).status()).toBe(400);
    const history=await doctor.get(`/api/patients/${patientId}/history`); expect(history.status()).toBe(200); expect(JSON.stringify(await history.json())).not.toContain("из 5");
  });
  test("enforces clinician/patient respondents and preserves private clinician drafts",async()=>{
    const definitions=(await (await doctor.get(`/api/assessments?patientId=${patientId}`)).json()).definitions;
    const ham=definitions.find((d:{form:{code:string}})=>d.form.code==="guideline-f40-ham-demo"); expect(ham.form.respondent).toBe("DOCTOR");
    const r=await doctor.post("/api/assessments",{data:{action:"assign",patientId,definitionId:ham.id}}); expect(r.status()).toBe(200); hamId=(await r.json()).id;
    const input={assignmentId:hamId,revision:0,answers:{ham_1:"answer_4"},note:"Врачебный черновик"};
    expect((await patient.post("/api/assessments",{data:{action:"save-draft",...input}})).status()).toBe(403);
    expect((await other.post("/api/assessments",{data:{action:"save-draft",...input}})).status()).toBe(404);
    expect((await doctor.post("/api/assessments",{data:{action:"save-draft",...input}})).status()).toBe(200);
    const d=await (await doctor.get(`/api/assessments?patientId=${patientId}&assignmentId=${hamId}`)).json(); expect(d.assignments[0].answers.ham_1).toBe("answer_4");
    const p=await (await patient.get(`/api/assessments?patientId=${patientId}&assignmentId=${hamId}`)).json(); expect(p.assignments[0].answers).toEqual({}); expect(p.assignments[0].note).toBe("");
    const answers=Object.fromEntries(ham.form.questions.map((q:{id:string})=>[q.id,"answer_4"]));
    const result=await doctor.post("/api/assessments",{data:{action:"submit",assignmentId:hamId,revision:1,answers,note:"Учебная врачебная оценка",requestKey:randomUUID()}}); expect(result.status()).toBe(200);
    const done=await (await doctor.get(`/api/assessments?patientId=${patientId}&assignmentId=${hamId}`)).json(); expect(done.assignments[0].submission.metric.value).toBe(56);
  });
  test("accepts a complete 90-item SCL-90-R submission",async()=>{
    const definitions=(await (await doctor.get(`/api/assessments?patientId=${patientId}`)).json()).definitions;
    const scl=definitions.find((d:{form:{code:string}})=>d.form.code==="guideline-f40-scl-demo");
    const r=await doctor.post("/api/assessments",{data:{action:"assign",patientId,definitionId:scl.id}}); expect(r.status()).toBe(200); sclId=(await r.json()).id;
    const answers=Object.fromEntries(scl.form.questions.map((q:{id:string})=>[q.id,"answer_2"])); expect(Object.keys(answers)).toHaveLength(90);
    expect((await doctor.post("/api/assessments",{data:{action:"submit",assignmentId:sclId,revision:0,answers,note:"",requestKey:randomUUID()}})).status()).toBe(403);
    expect((await patient.post("/api/assessments",{data:{action:"submit",assignmentId:sclId,revision:0,answers,note:"",requestKey:randomUUID()}})).status()).toBe(200);
    const done=await (await doctor.get(`/api/assessments?patientId=${patientId}&assignmentId=${sclId}`)).json(); expect(done.assignments[0].submission.metric.value).toBe(2);
  });
  test("different results create one sourced recommendation and one result push per submission",async()=>{
    const curve=createECDH("prime256v1"); curve.generateKeys();
    const connected=await doctor.post("/api/push",{data:{action:"connect",label:"Проверка рекомендаций",subscription:{endpoint:`https://fcm.googleapis.com/fcm/send/synthetic-${randomUUID()}`,keys:{p256dh:curve.getPublicKey().toString("base64url"),auth:randomBytes(16).toString("base64url")}}}}); expect(connected.status()).toBe(200);
    const definitions=(await (await doctor.get(`/api/assessments?patientId=${patientId}`)).json()).definitions;
    const bai=definitions.find((d:{form:{code:string;version:number}})=>d.form.code==="guideline-f40-bai-demo" && d.form.version===2); expect(bai).toBeTruthy();
    const recommendations:string[]=[];
    for(const [total,kind] of [[0,"ROUTINE"],[36,"HIGH"]] as const) {
      const assigned=await doctor.post("/api/assessments",{data:{action:"assign",patientId,definitionId:bai.id}}); expect(assigned.status()).toBe(200); const assignmentId=(await assigned.json()).id;
      let rest=total; const answers=Object.fromEntries(bai.form.questions.map((q:{id:string;options:{id:string;points:number}[]})=>{const n=Math.min(rest,3); rest-=n; return[q.id,q.options.find(o=>o.points===n)!.id];}));
      const data={action:"submit",assignmentId,revision:0,answers,note:"Учебный пример для уведомлений",requestKey:randomUUID()};
      expect((await patient.post("/api/assessments",{data})).status()).toBe(200); expect((await patient.post("/api/assessments",{data})).status()).toBe(200);
      const events=await db.reviewEvent.findMany({where:{submission:{assignmentId}},include:{pushDeliveries:true}}); expect(events).toHaveLength(1); expect(events[0].pushDeliveries).toHaveLength(1);
      const detail=await(await doctor.get(`/api/review-events?eventId=${events[0].id}`)).json(); expect(detail.notification.kind).toBe(kind); expect(detail.notification.sourceIds.length).toBeGreaterThan(0); recommendations.push(detail.notification.recommendation);
    }
    expect(recommendations[0]).not.toBe(recommendations[1]);
    const scl=definitions.find((d:{form:{code:string;version:number}})=>d.form.code==="guideline-f40-scl-demo" && d.form.version===2);
    const assigned=await doctor.post("/api/assessments",{data:{action:"assign",patientId,definitionId:scl.id}}); expect(assigned.status()).toBe(200); const assignmentId=(await assigned.json()).id;
    const answers=Object.fromEntries(scl.form.questions.map((q:{id:string})=>[q.id,q.id==="scl_15"?"answer_1":"answer_0"]));
    expect((await patient.post("/api/assessments",{data:{action:"submit",assignmentId,revision:0,answers,note:"",requestKey:randomUUID()}})).status()).toBe(200);
    const events=await db.reviewEvent.findMany({where:{submission:{assignmentId}},include:{pushDeliveries:true}}); expect(events).toHaveLength(1); expect(events[0].priority).toBe(4); expect(events[0].pushDeliveries).toHaveLength(1);
    const detail=await(await doctor.get(`/api/review-events?eventId=${events[0].id}`)).json(); expect(detail.notification.kind).toBe("SAFETY"); expect(detail.notification.sourceIds).toContain("nice-safety");
  });
  test("summary configuration never exposes a key and enforces role and ownership",async()=>{
    const anon=await request.newContext({baseURL:origin}); expect((await anon.get("/api/summaries")).status()).toBe(401); await anon.dispose();
    expect((await patient.get("/api/summaries")).status()).toBe(403);
    const config=await doctor.get("/api/summaries"); expect(config.status()).toBe(200); expect(config.headers()["cache-control"]).toContain("no-store");
    const data=await config.json(); expect(data.provider).toBe(process.env.LLM_SUMMARY_PROVIDER ?? "groq"); expect(data).not.toHaveProperty("apiKey");
    expect((await other.post("/api/summaries",{data:{patientId}})).status()).toBe(404);
    expect((await patient.post("/api/summaries",{data:{patientId}})).status()).toBe(403);
    expect((await doctor.post("/api/summaries",{headers:{Origin:"https://untrusted.example"},data:{patientId}})).status()).toBe(403);
  });
  test("patient UI has no five-point control; doctor UI shows the full catalogue",async({browser})=>{
    const patientContext=await browser.newContext({storageState:await patient.storageState()}); const page=await patientContext.newPage();
    await page.goto("/patient"); await expect(page.getByRole("heading",{name:"Ваши назначения",exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:"Как вы себя чувствуете?",exact:true})).toHaveCount(0);await expect(page.getByRole("group",{name:"Оценка самочувствия"})).toHaveCount(0);
    const docContext=await browser.newContext({storageState:await doctor.storageState()}); const doc=await docContext.newPage();
    const duplicateKeys: string[]=[]; doc.on("console",message=>{if(message.type()==="error" && message.text().includes("same key")) duplicateKeys.push(message.text());});
    await doc.goto(`/doctor?patient=${patientId}`); await doc.getByRole("tab",{name:"Обзор",exact:true}).click();
    await doc.getByText("Все методики из рекомендаций · 19",{exact:true}).click();
    await expect(doc.getByRole("heading",{name:/Г19\. Шкала общего/})).toBeVisible();
    await doc.getByLabel("Найти методику").fill("Либовица"); await expect(doc.getByText("Нужна сверка источника",{exact:true})).toBeVisible();
    const definitions=(await (await doctor.get(`/api/assessments?patientId=${patientId}`)).json()).definitions;
    const ham=definitions.find((d:{form:{code:string}})=>d.form.code==="guideline-f40-ham-demo");
    expect((await doctor.post("/api/assessments",{data:{action:"assign",patientId,definitionId:ham.id}})).status()).toBe(200);
    const row=doc.getByRole("button",{name:/Шкала тревоги Гамильтона/}).filter({hasText:"Назначена"}); await row.click();
    const dialog=doc.getByRole("dialog",{name:"Врачебная оценка",exact:true});
    await expect(dialog.getByRole("heading",{name:"Вопросы 1–3 из 14"})).toBeVisible();
    for(const radio of await dialog.getByRole("radio",{name:"В очень тяжелой степени",exact:true}).all()) await radio.check();
    await doc.keyboard.press("Escape"); await row.click();
    await expect(dialog.getByRole("heading",{name:"Вопросы 4–6 из 14"})).toBeVisible();
    await dialog.getByRole("button",{name:"Назад",exact:true}).click(); expect(await dialog.locator("input:checked").count()).toBe(3);
    await dialog.getByRole("button",{name:"Сохранить черновик",exact:true}).click(); await expect(dialog.getByRole("status")).toContainText("Черновик сохранён");
    await doc.keyboard.press("Escape");
    await page.screenshot({path:"test-results/patient-text-checkin.png",fullPage:true}); await doc.screenshot({path:"test-results/method-catalogue.png",fullPage:true});
    expect(duplicateKeys).toEqual([]);
    await Promise.all([patientContext.close(),docContext.close()]);
  });
});
