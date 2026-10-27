import "dotenv/config";
import { randomUUID } from "node:crypto";
import { test, expect, request } from "@playwright/test";
import { db } from "../../src/server/db";
import { authPost } from "./auth-request";

test("appointment opens directly and saves without editing medication", async ({ browser }) => {
  const origin = "http://localhost:3000";
  const api = await request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});
  let doctorId = "", patientId = "", extraPatientId = "";
  try {
    const signup = await authPost(api,"/api/auth/sign-up/email",{name:"Учебный врач приёма",email:`visit-${randomUUID()}@synthetic.kontur.demo`,password:randomUUID()});
    doctorId = (await signup.json()).user.id;
    await db.user.update({where:{id:doctorId},data:{role:"DOCTOR"}});
    patientId = (await db.patient.create({data:{doctorId,name:"Учебный пациент приёма",publicId:`VISIT-${randomUUID()}`,birthDate:new Date("1990-01-01")}})).id;
    const workspace = await (await api.get(`/api/care?patientId=${patientId}`)).json();
    const content = {goal:"Учебный план",instructions:"Сохранённая памятка",nextContactDate:null,tasks:[{id:randomUUID(),kind:"MEDICATION",title:"Учебное лекарство",details:"",dueDate:null,assignmentId:null,medication:{name:"Учебное лекарство",dose:"50"},startDate:"2026-10-24",time:"09:00",repeat:"DAILY"}]};
    const draft = await (await api.post("/api/care",{data:{action:"save-draft",patientId,revision:0,basisToken:workspace.context.token,content}})).json();
    expect((await api.post("/api/care",{data:{action:"confirm",patientId,draftId:draft.id,revision:draft.revision,requestKey:randomUUID(),reviewed:true}})).status()).toBe(200);
    const previous = await (await api.get(`/api/care?patientId=${patientId}`)).json();
    const context = await browser.newContext({storageState:await api.storageState()}); const page = await context.newPage();
    await page.goto(`/doctor?patient=${patientId}`);
    await page.locator(".overview-contact").getByRole("button").click();
    const dialog = page.getByRole("dialog",{name:"Дата следующего приёма",exact:true});
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Дата приёма",{exact:true}).fill("2026-11-05");
    await dialog.getByLabel("Время приёма · Москва",{exact:true}).fill("15:30");
    await dialog.getByRole("button",{name:"Сохранить",exact:true}).click();
    await expect(dialog).not.toBeVisible(); await expect(page.locator(".overview-contact > strong")).toContainText("5 нояб.");await expect(page.locator(".overview-contact > strong")).toContainText("15:30");
    await page.reload(); await expect(page.locator(".overview-contact > strong")).toContainText("5 нояб.");await expect(page.locator(".overview-contact > strong")).toContainText("15:30");
    const current = await (await api.get(`/api/care?patientId=${patientId}`)).json();
    expect(current.current.nextContactDate).toBe("2026-11-05");
    expect(current.current.tasks).toEqual(previous.current.tasks);
    expect(current.current.instructions).toBe(previous.current.instructions);
    expect((await db.carePlanVersion.findUniqueOrThrow({where:{id:previous.current.id}})).nextContactDate).toBeNull();
    const expectedNextVisit=(await db.patient.findUniqueOrThrow({where:{id:patientId}})).nextVisit!.toISOString();
    const reschedule={action:"schedule-visit",patientId,date:"2026-11-06",expectedPlanId:current.current.id,expectedNextVisit,requestKey:randomUUID()};
    expect((await api.post("/api/care",{data:reschedule})).status()).toBe(200);
    const count=await db.carePlanVersion.count({where:{patientId}});
    expect((await api.post("/api/care",{data:reschedule})).status()).toBe(200);
    expect(await db.carePlanVersion.count({where:{patientId}})).toBe(count);
    expect((await api.post("/api/care",{data:{...reschedule,date:"2026-11-07",requestKey:randomUUID()}})).status()).toBe(409);
    expect((await api.post("/api/care",{data:{...reschedule,date:"2026-02-30",requestKey:randomUUID()}})).status()).toBe(400);
    expect((await api.post("/api/care",{data:{...reschedule,patientId:randomUUID(),requestKey:randomUUID()}})).status()).toBe(404);
    extraPatientId=(await db.patient.create({data:{doctorId,name:"Учебный пациент без плана",publicId:`VISIT-${randomUUID()}`,birthDate:new Date("1990-01-01")}})).id;
    await page.goto(`/doctor?patient=${extraPatientId}`);
    await page.locator(".overview-contact").getByRole("button").click();await dialog.getByLabel("Дата приёма",{exact:true}).fill("2026-11-08");await dialog.getByLabel("Время приёма · Москва",{exact:true}).fill("00:30");await dialog.getByRole("button",{name:"Сохранить",exact:true}).click();await expect(dialog).not.toBeVisible();
    await page.getByRole("tab",{name:"Лечение и задачи",exact:true}).click();await page.getByRole("button",{name:"Назначить лечение",exact:true}).click();
    const newPlan=page.getByRole("dialog",{name:"Подготовить план наблюдения",exact:true});await expect(newPlan.getByLabel("Дата следующего приёма · необязательно",{exact:true})).toHaveCount(0);
    await page.getByRole("button",{name:"Закрыть панель",exact:true}).click();
    await page.locator(".overview-contact").getByRole("button").click();await dialog.getByRole("button",{name:"Отменить приём",exact:true}).click();await expect(dialog).not.toBeVisible();
    await expect(page.locator(".overview-contact > strong")).toHaveText("Не назначен");
    await context.close();
  } finally {
    await db.patient.deleteMany({where:{id:{in:[patientId,extraPatientId].filter(Boolean)}}});
    if(doctorId){await db.auditEvent.deleteMany({where:{actorId:doctorId}});await db.user.deleteMany({where:{id:doctorId}});}
    await api.dispose(); await db.$disconnect();
  }
});
