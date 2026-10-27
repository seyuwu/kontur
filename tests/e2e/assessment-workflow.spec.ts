import "dotenv/config";
import {randomUUID,createECDH,randomBytes} from "node:crypto";
import {test,expect,request,type APIRequestContext} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {db} from "../../src/server/db";
import {authPost} from "./auth-request";
import {processPush} from "../../src/modules/web-push";
import {assessmentDateAfter,assessmentDueAt} from "../../src/lib/assessment-deadline";
const origin="http://localhost:3000";
const sub=()=>{const c=createECDH("prime256v1");c.generateKeys();return{endpoint:`https://fcm.googleapis.com/fcm/send/synthetic-${randomUUID()}`,keys:{p256dh:c.getPublicKey().toString("base64url"),auth:randomBytes(16).toString("base64url")}};};
test.describe.serial("Questionnaire workflow and role-scoped notifications",()=>{
  let doctor:APIRequestContext,patient:APIRequestContext,unlinked:APIRequestContext,other:APIRequestContext;
  let patientId="",doctorId="",patientUserId="",unlinkedId="",doctorDevice="",patientDevice="",definitionId="";const ids:string[]=[];let form:{questions:{id:string;options:{id:string;points:number}[]}[]};
  async function assign(){const dueAt=assessmentDueAt(assessmentDateAfter(3));const r=await doctor.post("/api/assessments",{data:{action:"assign",patientId,definitionId,dueAt}});expect(r.status()).toBe(200);return{id:(await r.json()).id as string,dueAt};}
  test.beforeAll(async()=>{
    async function account(role:"DOCTOR"|"PATIENT"){const api=await request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});const r=await authPost(api,"/api/auth/sign-up/email",{name:"Учебный участник",email:`workflow-${randomUUID()}@synthetic.kontur.demo`,password:randomUUID()});expect(r.status()).toBe(200);const id=(await r.json()).user.id;ids.push(id);if(role==="DOCTOR")await db.user.update({where:{id},data:{role}});return{api,id};}
    const d=await account("DOCTOR"),p=await account("PATIENT"),u=await account("PATIENT"),o=await account("DOCTOR");doctor=d.api;doctorId=d.id;patient=p.api;patientUserId=p.id;unlinked=u.api;unlinkedId=u.id;other=o.api;
    patientId=(await db.patient.create({data:{doctorId,userId:patientUserId,name:"Учебный пациент анкет",publicId:`WORK-${randomUUID()}`,birthDate:new Date("1990-01-01"),note:"Уточнить вопросы на следующем приёме."}})).id;
    const data=await(await doctor.get(`/api/assessments?patientId=${patientId}`)).json();const def=data.definitions.find((d:{form:{code:string;version:number}})=>d.form.code==="guideline-f40-bai-demo"&&d.form.version===2);definitionId=def.id;form=def.form;
  });
  test.afterAll(async()=>{if(patientId)await db.patient.deleteMany({where:{id:patientId}});await db.auditEvent.deleteMany({where:{actorId:{in:ids}}});await db.user.deleteMany({where:{id:{in:ids}}});await Promise.all([doctor?.dispose(),patient?.dispose(),unlinked?.dispose(),other?.dispose()]);await db.$disconnect();});
  test("requires authentication and confirmed patient link, preserves ownership and session boundaries",async()=>{
    const anon=await request.newContext({baseURL:origin});expect((await anon.get("/api/push")).status()).toBe(401);await anon.dispose();
    expect((await unlinked.get("/api/push")).status()).toBe(403);expect((await unlinked.post("/api/push",{data:{action:"connect",label:"Тест",subscription:sub()}})).status()).toBe(403);
    expect((await patient.get("/api/push")).status()).toBe(200);
    const doctorSub=sub();const dc=await doctor.post("/api/push",{data:{action:"connect",label:"Учебный врач",subscription:doctorSub}});expect(dc.status()).toBe(200);doctorDevice=(await dc.json()).id;
    expect((await patient.post("/api/push",{data:{action:"connect",label:"Чужое",subscription:doctorSub}})).status()).toBe(409);
    const pc=await patient.post("/api/push",{data:{action:"connect",label:"Учебный пациент",subscription:sub()}});expect(pc.status()).toBe(200);patientDevice=(await pc.json()).id;
    expect((await patient.post("/api/push",{data:{action:"disconnect",deviceId:doctorDevice}})).status()).toBe(404);
    expect((await patient.post("/api/push",{data:{action:"test",deviceId:doctorDevice,requestKey:randomUUID()}})).status()).toBe(404);
    expect((await doctor.post("/api/push",{data:{action:"test",deviceId:patientDevice,requestKey:randomUUID()}})).status()).toBe(404);
    expect((await patient.post("/api/push",{headers:{Origin:"https://evil.test"},data:{action:"test",deviceId:patientDevice,requestKey:randomUUID()}})).status()).toBe(403);
    const privateTest=await doctor.post("/api/push",{data:{action:"test",deviceId:doctorDevice,requestKey:randomUUID()}});const deliveryId=(await privateTest.json()).id;
    expect((await patient.post("/api/push",{data:{action:"shown",deliveryId}})).status()).toBe(404);
    expect((await patient.post("/api/assessments",{data:{action:"assign",patientId,definitionId}})).status()).toBe(403);
  });
  test("notifies patient of deadline, then doctor once with the corresponding sourced recommendation",async()=>{
    const recommendations:string[]=[];
    for(const total of [0,36]){
      const assignment=await assign();const assigned=await db.pushDelivery.findMany({where:{assignmentId:assignment.id,purpose:"ASSIGNED"}});expect(assigned).toHaveLength(1);expect(assigned[0].deviceId).toBe(patientDevice);
      let calls=0;const sendAssigned:Parameters<typeof processPush>[1]=async(_s,payload)=>{calls++;expect(payload.type).toBe("kontur-assigned");expect(payload.dueDate).toBe(assignment.dueAt.slice(0,10));expect(payload.url).toBe(`/patient?assignment=${assignment.id}`);expect(JSON.stringify(payload)).not.toContain("Учебный пациент");};await processPush(assigned[0].id,sendAssigned);await processPush(assigned[0].id,sendAssigned);expect(calls).toBe(1);
      let rest=total;const answers=Object.fromEntries(form.questions.map(q=>{const points=Math.min(3,rest);rest-=points;return[q.id,q.options.find(o=>o.points===points)!.id];}));
      const input={action:"submit",assignmentId:assignment.id,revision:0,answers,note:"",requestKey:randomUUID()};expect((await patient.post("/api/assessments",{data:input})).status()).toBe(200);expect((await patient.post("/api/assessments",{data:input})).status()).toBe(200);
      const completed=await db.pushDelivery.findMany({where:{assignmentId:assignment.id,purpose:"COMPLETED"}});expect(completed).toHaveLength(1);expect(completed[0].deviceId).toBe(doctorDevice);expect(completed[0].eventId).toBeTruthy();
      await processPush(completed[0].id,async(_s,payload)=>{expect(payload.type).toBe("kontur-completed");expect(payload.kind).toBe(total===0?"ROUTINE":"HIGH");expect(payload.url).toContain(`event=${completed[0].eventId}`);expect(JSON.stringify(payload)).not.toContain("балл");});
      const detail=await(await doctor.get(`/api/review-events?eventId=${completed[0].eventId}`)).json();expect(detail.notification.sourceIds.length).toBeGreaterThan(0);recommendations.push(detail.notification.recommendation);
      const doctorResult=await(await doctor.get(`/api/assessments?patientId=${patientId}&assignmentId=${assignment.id}`)).json();expect(doctorResult.assignments[0].submission.notification.recommendation).toBe(detail.notification.recommendation);
      const patientResult=await(await patient.get(`/api/assessments?patientId=${patientId}&assignmentId=${assignment.id}`)).json();expect(patientResult.assignments[0].submission).not.toHaveProperty("notification");
    }
    expect(recommendations[0]).not.toBe(recommendations[1]);
  });
  test("cancels assignment notifications after cancellation or patient account change",async()=>{
    const a=await assign();const row=await db.pushDelivery.findFirstOrThrow({where:{assignmentId:a.id,purpose:"ASSIGNED"}});expect((await doctor.post("/api/assessments",{data:{action:"cancel",assignmentId:a.id,revision:0,reason:"Изменился план"}})).status()).toBe(200);await processPush(row.id,async()=>{throw Error("must not send");});expect((await db.pushDelivery.findUniqueOrThrow({where:{id:row.id}})).status).toBe("CANCELLED");
    const b=await assign();const moved=await db.pushDelivery.findFirstOrThrow({where:{assignmentId:b.id,purpose:"ASSIGNED"}});await db.patient.update({where:{id:patientId},data:{userId:unlinkedId}});await processPush(moved.id,async()=>{throw Error("must not send");});expect((await db.pushDelivery.findUniqueOrThrow({where:{id:moved.id}})).status).toBe("CANCELLED");await db.patient.update({where:{id:patientId},data:{userId:patientUserId}});await doctor.post("/api/assessments",{data:{action:"cancel",assignmentId:b.id,revision:0,reason:"Завершён учебный пример"}});
  });
  test("overview leads with questionnaires, quick three-day deadline, compact referral and patient deep link",async({browser})=>{
    const dc=await browser.newContext({storageState:await doctor.storageState(),viewport:{width:1440,height:1000}});const page=await dc.newPage();await page.goto(`/doctor?patient=${patientId}`);
    await expect(page.getByRole("heading",{name:"Анкеты и сроки"})).toBeVisible();await expect(page.getByRole("region",{name:"Анкеты пациента",exact:true}).getByRole("button",{name:/Шкала тревоги/})).toHaveCount(0);await expect(page.getByRole("heading",{name:"Клинические сведения",exact:true})).toHaveCount(0);await expect(page.getByRole("heading",{name:"Что изменилось",exact:true})).toHaveCount(0);await expect(page.getByRole("heading",{name:"Сообщение пациента",exact:true})).toHaveCount(0);
    const aside=page.getByRole("complementary",{name:"Заметка и наблюдение"});await expect(aside.getByText("Уточнить вопросы на следующем приёме.")).toBeVisible();await expect(aside.getByRole("button",{name:"Направление к психиатру",exact:true})).toBeEnabled();
    await page.screenshot({path:".impeccable/review/questionnaire-overview-1440.png",fullPage:true});await page.getByRole("button",{name:"Назначить анкету",exact:true}).click();const assignDialog=page.getByRole("dialog",{name:"Назначить анкету",exact:true});await expect(assignDialog.getByRole("combobox",{name:"Заполнить за",exact:true})).toHaveValue("3");await expect(assignDialog.locator('input[type="date"]')).toHaveCount(0);await page.screenshot({path:".impeccable/review/questionnaire-assign-1440.png"});
    await assignDialog.getByRole("combobox",{name:"Заполнить за",exact:true}).selectOption("custom");await expect(assignDialog.getByLabel("Заполнить до",{exact:true})).toBeVisible();await assignDialog.getByRole("combobox",{name:"Заполнить за",exact:true}).selectOption("3");await assignDialog.getByRole("button",{name:"Назначить пациенту",exact:true}).click();await expect(assignDialog).not.toBeVisible();
    const assigned=await db.assessmentAssignment.findFirstOrThrow({where:{patientId,status:"ASSIGNED"},orderBy:{createdAt:"desc"}});expect(assigned.dueAt?.toISOString()).toBe(assessmentDueAt(assessmentDateAfter(3)));
    for(const width of [390,320]){await page.setViewportSize({width,height:950});await page.screenshot({path:`.impeccable/review/questionnaire-overview-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
    expect((await new AxeBuilder({page}).analyze()).violations.filter(v=>v.impact==="critical"||v.impact==="serious")).toEqual([]);
    await aside.getByRole("button",{name:"Направление к психиатру",exact:true}).click();await expect(page.getByRole("dialog",{name:"Подготовить направление к психиатру",exact:true})).toBeVisible();await page.keyboard.press("Escape");
    await page.getByRole("tab",{name:"Данные",exact:true}).click();await expect(page.getByRole("heading",{name:"Клинические сведения",exact:true})).toBeVisible();await dc.close();
    const pc=await browser.newContext({storageState:await patient.storageState(),viewport:{width:390,height:900}});const pp=await pc.newPage();await pp.goto(`/patient?assignment=${assigned.id}`);await expect(pp.getByRole("dialog").getByRole("heading",{name:/Шкала тревоги/})).toBeVisible();await expect(pp.getByRole("dialog").getByText(/Заполнить до/)).toBeVisible();await pp.screenshot({path:".impeccable/review/questionnaire-patient-390.png"});await pp.keyboard.press("Escape");await expect(pp.getByRole("button",{name:"Настроить push-уведомления"})).toBeVisible();await pc.close();
  });
  test("patient cards show progress and hide completed questionnaires from home",async({browser})=>{
    for(const pending of await db.assessmentAssignment.findMany({where:{patientId,definitionId,status:{in:["ASSIGNED","IN_PROGRESS"]}}})) {
      expect((await doctor.post("/api/assessments",{data:{action:"cancel",assignmentId:pending.id,revision:pending.revision,reason:"Новый учебный сценарий"}})).status()).toBe(200);
    }
    const assignment=await assign();
    const context=await browser.newContext({storageState:await patient.storageState(),viewport:{width:390,height:900}});
    const page=await context.newPage();await page.goto("/patient");
    const cards=page.locator(".patient-questionnaire-card");
    const card=cards.filter({hasText:"Не заполнена"}).filter({hasText:"Шкала тревоги"}).first();
    await expect(card.getByText("Ответов 0 из 21",{exact:true})).toBeVisible();await expect(card.getByText("Начать",{exact:true})).toBeVisible();
    const saved=await patient.post("/api/assessments",{data:{action:"save-draft",assignmentId:assignment.id,revision:0,answers:{[form.questions[0].id]:form.questions[0].options[0].id},note:""}});expect(saved.status()).toBe(200);
    await page.reload();const progressCard=cards.filter({hasText:"В процессе"}).first();await expect(progressCard.getByText("Ответов 1 из 21",{exact:true})).toBeVisible();
    await progressCard.click();const dialog=page.getByRole("dialog");await dialog.locator("fieldset").nth(1).getByRole("radio").first().check();await page.keyboard.press("Escape");
    await expect(progressCard.getByText("Ответов 2 из 21",{exact:true})).toBeVisible();await expect(progressCard.getByText("Есть несохранённые ответы",{exact:true})).toBeVisible();
    await progressCard.click();await dialog.getByRole("button",{name:"Сохранить черновик",exact:true}).click();await expect(dialog.getByText("Черновик сохранён на сервере. Можно продолжить позже.",{exact:true})).toBeVisible();await dialog.getByRole("button",{name:"Закрыть панель",exact:true}).click();await expect(dialog).not.toBeVisible();
    for(const width of [1440,390,320]){await page.setViewportSize({width,height:950});await page.screenshot({path:`.impeccable/review/patient-questionnaire-cards-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
    expect((await new AxeBuilder({page}).analyze()).violations.filter(v=>v.impact==="critical"||v.impact==="serious")).toEqual([]);
    const completed=await patient.post("/api/assessments",{data:{action:"submit",assignmentId:assignment.id,revision:2,answers:Object.fromEntries(form.questions.map(q=>[q.id,q.options[0].id])),note:"",requestKey:randomUUID()}});expect(completed.status()).toBe(200);
    await page.reload();await expect(cards.filter({has:page.getByText("Заполнена",{exact:true})})).toHaveCount(0);await expect(page.getByText("Незаполненных анкет нет.",{exact:true})).toBeVisible();
    await context.close();
  });
});
