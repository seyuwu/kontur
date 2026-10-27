import "dotenv/config";
import {randomUUID,createECDH,randomBytes} from "node:crypto";
import {test,expect,request,type APIRequestContext} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {db} from "../../src/server/db";
import {authPost} from "./auth-request";
import {moscowDate,assessmentDateAfter,assessmentDueAt} from "../../src/lib/assessment-deadline";
import {schedulePatientReminders,reminderEligible} from "../../src/modules/web-push/reminders";
import {processPush,type PushMessage} from "../../src/modules/web-push";
const origin="http://localhost:3000";
function subscription(){const curve=createECDH("prime256v1");curve.generateKeys();return{endpoint:`https://fcm.googleapis.com/fcm/send/synthetic-${randomUUID()}`,expirationTime:null,keys:{p256dh:curve.getPublicKey().toString("base64url"),auth:randomBytes(16).toString("base64url")}};}
test.describe.serial("One place for assignments and treatment",()=>{
  let doctor:APIRequestContext,patient:APIRequestContext;let patientId="",doctorId="",patientUserId="",assignmentId="",planId="";const deviceIds:string[]=[];
  test.beforeAll(async()=>{
    async function account(role:string){const api=await request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});const r=await authPost(api,"/api/auth/sign-up/email",{name:"Учебный участник",email:`tasks-${randomUUID()}@synthetic.kontur.demo`,password:randomUUID()});expect(r.status()).toBe(200);const id=(await r.json()).user.id;if(role==="DOCTOR")await db.user.update({where:{id},data:{role}});return{api,id};}
    const d=await account("DOCTOR"),p=await account("PATIENT");doctor=d.api;doctorId=d.id;patient=p.api;patientUserId=p.id;
    patientId=(await db.patient.create({data:{doctorId,userId:patientUserId,name:"Учебный пациент назначений",publicId:`TASKS-${randomUUID()}`,birthDate:new Date("1990-01-01")}})).id;
    for(const [api,label] of [[doctor,"Врач"],[patient,"Пациент 1"],[patient,"Пациент 2"]] as const){const r=await api.post("/api/push",{data:{action:"connect",label,subscription:subscription()}});expect(r.status()).toBe(200);deviceIds.push((await r.json()).id);}
  });
  test.afterAll(async()=>{if(patientId)await db.patient.deleteMany({where:{id:patientId}});await db.auditEvent.deleteMany({where:{actorId:{in:[doctorId,patientUserId].filter(Boolean)}}});await db.user.deleteMany({where:{id:{in:[doctorId,patientUserId].filter(Boolean)}}});await doctor?.dispose();await patient?.dispose();await db.$disconnect();});
  test("doctor assigns questionnaires and confirms a medication schedule in one section",async({browser})=>{
    const context=await browser.newContext({storageState:await doctor.storageState()});const page=await context.newPage();await page.goto(`/doctor?patient=${patientId}`);
    const section=page.getByRole("region",{name:"Назначения пациенту",exact:true});await expect(section.getByRole("button",{name:"Назначить анкету",exact:true})).toBeVisible();await section.getByRole("tab",{name:"Лечение и задачи",exact:true}).click();await section.getByRole("button",{name:"Назначить лечение",exact:true}).click();
    const editor=page.getByRole("dialog",{name:"Подготовить план наблюдения",exact:true});await editor.getByLabel("Цель наблюдения",{exact:true}).fill("Учебный план назначений");await editor.getByLabel("Памятка пациенту",{exact:true}).fill("Вымышленные назначения для проверки интерфейса.");
    for(const [name,amount,unit,start,time,repeat] of [["Учебное лекарство сегодня","1","капс.",moscowDate(),"12:00",true],["Учебное лекарство позже","5","мл",assessmentDateAfter(2),"09:00",false]] as const){
      await editor.getByRole("button",{name:"Добавить лекарство",exact:true}).click();const task=editor.locator(".care-task-editor").last();await task.getByLabel("Название препарата",{exact:true}).fill(name);await task.getByLabel("Количество на один приём",{exact:true}).fill(amount);await task.getByRole("combobox",{name:"Единица",exact:true}).selectOption(unit);await expect(task.getByLabel("Количество на один приём",{exact:true})).toHaveValue(amount);await task.getByLabel("Дата начала приёма",{exact:true}).fill(start);await task.getByRole("combobox",{name:"Кто выбирает время",exact:true}).selectOption("FIXED");await task.getByLabel("Приём 1 · время Москвы",{exact:true}).fill(time);if(!repeat)await task.getByRole("combobox",{name:"Дни приёма",exact:true}).selectOption("once");
    }
    await editor.getByRole("button",{name:"Сохранить и проверить",exact:true}).click();const preview=page.getByRole("dialog",{name:"Проверить план перед подтверждением",exact:true});await expect(preview.getByText(/1 капс\./)).toBeVisible();await preview.getByRole("checkbox",{name:"Я проверил содержание и подтверждаю этот план для пациента"}).check();await preview.getByRole("button",{name:"Подтвердить и показать пациенту",exact:true}).click();await expect(preview).not.toBeVisible();
    planId=(await db.patient.findUniqueOrThrow({where:{id:patientId}})).currentPlanId!;
    const workspace=await(await doctor.get(`/api/assessments?patientId=${patientId}`)).json();const bai=workspace.definitions.find((d:{form:{code:string;version:number}})=>d.form.code==="guideline-f40-bai-demo"&&d.form.version===2);
    const assigned=await doctor.post("/api/assessments",{data:{action:"assign",patientId,definitionId:bai.id,dueAt:assessmentDueAt(assessmentDateAfter(3))}});expect(assigned.status()).toBe(200);assignmentId=(await assigned.json()).id;
    const simple=workspace.definitions.find((d:{form:{questions:unknown[];respondent?:string}})=>d.form.questions.length===2&&d.form.respondent!=="DOCTOR");const closed=await doctor.post("/api/assessments",{data:{action:"assign",patientId,definitionId:simple.id}});expect(closed.status()).toBe(200);const closedId=(await closed.json()).id;expect((await patient.post("/api/assessments",{data:{action:"submit",assignmentId:closedId,revision:0,answers:Object.fromEntries(simple.form.questions.map((q:{id:string;options:{id:string}[]})=>[q.id,q.options[0].id])),note:"",requestKey:randomUUID()}})).status()).toBe(200);
    await expect(section.locator(".prescription-treatment-list").getByText("Учебное лекарство сегодня",{exact:true})).toBeVisible();
    await expect(section.getByText("Памятка, отметки и документы",{exact:true})).toHaveCount(0);
    await expect(section.getByText("Вымышленные назначения для проверки интерфейса.",{exact:true})).not.toBeVisible();
    for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await page.screenshot({path:`.impeccable/review/doctor-treatment-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
    await section.getByRole("tab",{name:"Анкеты",exact:true}).click();
    await expect(page.getByRole("tab",{name:"Назначения",exact:true})).toHaveCount(0);
    await expect(section.getByRole("button",{name:"Все назначения и результаты",exact:true})).toHaveCount(0);
    await expect(section.locator(".doctor-questionnaire").filter({hasText:"Шкала тревоги Бека"})).toBeVisible();
    await expect(section.getByText("Все методики из рекомендаций",{exact:false})).toHaveCount(0);
    await section.getByRole("button",{name:/Завершённые/}).click();
    await expect(section.locator(".doctor-questionnaire").getByText("Заполнена",{exact:true})).toBeVisible();
    await section.getByRole("button",{name:/Ожидают заполнения/}).click();
    for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await page.screenshot({path:`.impeccable/review/doctor-questionnaires-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
    expect((await new AxeBuilder({page}).analyze()).violations.filter(v=>v.impact==="critical"||v.impact==="serious")).toEqual([]);
    await section.getByRole("button",{name:"Назначить анкету",exact:true}).click();
    await expect(page.getByRole("dialog",{name:"Назначить анкету",exact:true}).getByText(/Все методики из рекомендаций/)).toBeVisible();
    await page.getByRole("button",{name:"Закрыть панель",exact:true}).click();
    await section.getByRole("tab",{name:"Лечение и задачи",exact:true}).click();
    await section.getByRole("button",{name:/Учебное лекарство сегодня/}).click();
    const detail=page.getByRole("dialog",{name:"Учебное лекарство сегодня",exact:true});
    await expect(detail.getByText("1 капс.",{exact:true})).toBeVisible();
    await detail.getByRole("button",{name:"Изменить назначение",exact:true}).click();
    const medicationEditor=page.getByRole("dialog",{name:"Изменить назначение",exact:true});
    await expect(medicationEditor.getByRole("textbox",{name:"Название препарата",exact:true})).toHaveCount(1);
    for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await medicationEditor.locator(".medication-dose-fields").filter({visible:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`.impeccable/review/dose-editor-${width}.png`});expect(await medicationEditor.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);}
    await medicationEditor.getByRole("textbox",{name:"Количество на один приём",exact:true}).fill("2");
    await medicationEditor.getByRole("button",{name:"Сохранить и проверить",exact:true}).click();
    const updatedPreview=page.getByRole("dialog",{name:"Проверить план перед подтверждением",exact:true});
    await updatedPreview.getByRole("checkbox",{name:"Я проверил содержание и подтверждаю этот план для пациента"}).check();
    await updatedPreview.getByRole("button",{name:"Подтвердить и показать пациенту",exact:true}).click();await expect(updatedPreview).not.toBeVisible();
    const updatedCare=await(await doctor.get(`/api/care?patientId=${patientId}`)).json();planId=updatedCare.current.id;
    expect(updatedCare.current.tasks.map((t:{medication:{dose:string}})=>t.medication.dose)).toEqual(["2 капс.","5 мл"]);
    await page.screenshot({path:".impeccable/review/doctor-prescriptions-1440.png",fullPage:true});await context.close();
  });
  test("patient has only current tasks, upcoming medication and one chat entry",async({browser})=>{
    const context=await browser.newContext({storageState:await patient.storageState()});const page=await context.newPage();await page.goto("/patient");
    await expect(page.getByRole("navigation",{name:"Кабинет пациента"}).getByRole("button")).toHaveCount(2);await expect(page.getByRole("button",{name:/Динамика|Есть вопрос|Написать врачу/})).toHaveCount(0);await expect(page.getByRole("heading",{name:"Как вы себя чувствуете?",exact:true})).toHaveCount(0);
    const tasks=page.getByRole("region",{name:"Назначения врача",exact:true});await expect(tasks.getByText("Учебное лекарство сегодня",{exact:true})).toBeVisible();await expect(tasks.getByText("Учебное лекарство позже",{exact:true})).toBeVisible();await expect(tasks.locator(".patient-medication-card").filter({hasText:"Учебное лекарство позже"}).getByRole("button",{name:/09:00/})).toBeDisabled();await expect(tasks.getByText("Заполнена",{exact:true})).toHaveCount(0);await expect(tasks.getByText("Шкала тревоги Бека (BAI)",{exact:true})).toBeVisible();

    for(const width of [1440,390,320]){await page.setViewportSize({width,height:950});await page.screenshot({path:`.impeccable/review/patient-assignments-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
    expect((await new AxeBuilder({page}).analyze()).violations.filter(v=>v.impact==="critical"||v.impact==="serious")).toEqual([]);
    await page.getByRole("button",{name:"Чат с врачом",exact:true}).click();await page.getByRole("textbox",{name:"Текст сообщения",exact:true}).fill("Учебный вопрос: прошу связаться.");await page.getByRole("checkbox",{name:"Попросить врача связаться со мной при отправке сообщения"}).check();await page.getByRole("button",{name:"Отправить сообщение",exact:true}).click();await expect(page.getByRole("log").getByText("Учебный вопрос: прошу связаться.",{exact:true})).toBeVisible();
    expect(await db.observation.count({where:{patientId,needsContact:true}})).toBe(1);expect(await db.pushDelivery.count({where:{observation:{patientId},purpose:"CONTACT",deviceId:deviceIds[0]}})).toBe(1);await context.close();
  });
  test("reminders are idempotent and stop after completion or changed plan",async()=>{
    const now=new Date(`${moscowDate()}T12:05:00+03:00`);await db.carePlanVersion.update({where:{id:planId},data:{confirmedAt:new Date(`${moscowDate()}T00:00:00+03:00`)}});await db.assessmentAssignment.update({where:{id:assignmentId},data:{createdAt:new Date(`${assessmentDateAfter(-1)}T12:00:00+03:00`)}});
    await schedulePatientReminders(now,patientId);await schedulePatientReminders(now,patientId);
    const reminders=await db.patientReminder.findMany({where:{patientId,kind:{not:"PLAN"}},include:{deliveries:true}});expect(reminders.map(r=>r.kind).sort()).toEqual(["ASSESSMENT_REMINDER","MEDICATION","MEDICATION_UPCOMING"]);expect(reminders.every(r=>r.deliveries.length===2)).toBe(true);
    const sent:PushMessage[]=[];for(const reminder of reminders)await processPush(reminder.deliveries[0].id,async(_s,payload)=>{sent.push(payload);},now);
    expect(sent.map(p=>p.type).sort()).toEqual(["kontur-assessment-reminder","kontur-medication","kontur-medication-upcoming"]);expect(JSON.stringify(sent)).not.toContain("Учебная доза");
    const workspace=await(await doctor.get(`/api/care?patientId=${patientId}`)).json();
    const content={goal:"Уточнённый учебный план",instructions:workspace.current.instructions,nextContactDate:workspace.current.nextContactDate,tasks:workspace.current.tasks.map(({report:_report,assignment:_assignment,medicationSchedule:_schedule,medicationIntakes:_intakes,dayRevision:_dayRevision,...task}:{report:unknown;assignment:unknown;medicationSchedule?:unknown;medicationIntakes?:unknown;dayRevision?:unknown})=>task)};
    const draft=await doctor.post("/api/care",{data:{action:"save-draft",patientId,revision:workspace.draftRevision,basisToken:workspace.context.token,content}});expect(draft.status()).toBe(200);const saved=await draft.json();
    const confirmed=await doctor.post("/api/care",{data:{action:"confirm",patientId,draftId:saved.id,revision:saved.revision,reviewed:true,requestKey:randomUUID()}});expect(confirmed.status()).toBe(200);planId=(await confirmed.json()).id;
    const med=reminders.find(r=>r.kind==="MEDICATION")!;expect(await reminderEligible(med,patientUserId,now)).toBe(true);
    await schedulePatientReminders(now,patientId);expect(await db.pushDelivery.count({where:{reminderId:{in:reminders.map(r=>r.id)}}})).toBe(6);
    expect((await patient.post("/api/care",{data:{action:"medication-report",patientId,planVersionId:planId,taskId:med.taskId,date:moscowDate(),time:"12:00",revision:0,state:"DONE",note:"",requestKey:randomUUID()}})).status()).toBe(200);
    await processPush(med.deliveries[1].id,async()=>{throw Error("must not send completed medication");},now);expect((await db.pushDelivery.findUniqueOrThrow({where:{id:med.deliveries[1].id}})).status).toBe("CANCELLED");
    const assignment=await(await patient.get(`/api/assessments?patientId=${patientId}&assignmentId=${assignmentId}`)).json();const form=assignment.definitions.find((d:{id:string})=>d.id===assignment.assignments[0].definitionId).form;
    expect((await patient.post("/api/assessments",{data:{action:"submit",assignmentId,revision:0,answers:Object.fromEntries(form.questions.map((q:{id:string;options:{id:string}[]})=>[q.id,q.options[0].id])),note:"",requestKey:randomUUID()}})).status()).toBe(200);
    const questionnaire=reminders.find(r=>r.kind==="ASSESSMENT_REMINDER")!;await processPush(questionnaire.deliveries[1].id,async()=>{throw Error("must not send completed questionnaire");},now);expect((await db.pushDelivery.findUniqueOrThrow({where:{id:questionnaire.deliveries[1].id}})).status).toBe("CANCELLED");
    await db.patient.update({where:{id:patientId},data:{currentPlanId:null}});const upcoming=reminders.find(r=>r.kind==="MEDICATION_UPCOMING")!;await processPush(upcoming.deliveries[1].id,async()=>{throw Error("must not send revoked plan");},now);expect((await db.pushDelivery.findUniqueOrThrow({where:{id:upcoming.deliveries[1].id}})).status).toBe("CANCELLED");
  });
  test("doctor sees recommendations without a review workflow",async({browser})=>{
    const context=await browser.newContext({storageState:await doctor.storageState()}); const page=await context.newPage();
    await page.goto(`/doctor?patient=${patientId}`);
    const results=page.getByRole("region",{name:"Результаты анкет",exact:true});await expect(results).toBeVisible();
    await expect(results.getByText(/Разобрать результат|В работе|Нужно разобрать/)).toHaveCount(0);
    await results.locator(".assessment-row").first().click();const dialog=page.getByRole("dialog");
    await expect(dialog.getByRole("heading",{name:"Рекомендация врачу по этому результату",exact:true})).toBeVisible();
    await expect(dialog.getByRole("button",{name:/Взять в работу|Завершить разбор|Зафиксировать результат/})).toHaveCount(0);
    await expect.poll(()=>db.reviewEvent.count({where:{patientId,viewedAt:{not:null}}})).toBeGreaterThan(0);
    await expect(dialog.getByRole("button",{name:"Написать пациенту",exact:true})).toBeVisible();
    await context.close();
  });

});
