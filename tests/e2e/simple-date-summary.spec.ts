import "dotenv/config";
import { randomUUID } from "node:crypto";
import { test, expect, request } from "@playwright/test";
import { db } from "../../src/server/db";
import { authPost } from "./auth-request";

test("one appointment date and immediate summary retry with a simple button",async({browser})=>{
  const api=await request.newContext({baseURL:"http://localhost:3000",extraHTTPHeaders:{Origin:"http://localhost:3000"}});
  let doctorId="",patientId="";
  try{
    const sign=await authPost(api,"/api/auth/sign-up/email",{name:"Учебный врач",email:`summary-retry-${randomUUID()}@synthetic.kontur.demo`,password:randomUUID()});expect(sign.status()).toBe(200);doctorId=(await sign.json()).user.id;
    await db.user.update({where:{id:doctorId},data:{role:"DOCTOR"}});
    patientId=(await db.patient.create({data:{doctorId,name:"Учебный пациент",publicId:`RETRY-${randomUUID()}`,birthDate:new Date("1990-01-01"),note:"Учебная заметка",nextVisit:new Date("2026-11-02T09:00:00Z")}})).id;
    const context=await browser.newContext({storageState:await api.storageState(),viewport:{width:390,height:900}});const page=await context.newPage();let calls=0;
    await page.route("**/api/summaries",async route=>{
      if(route.request().method()==="GET")return route.fulfill({json:{enabled:true,reason:"",model:"synthetic",provider:"mistral"}});
      calls++;return calls===1?route.fulfill({status:502,json:{error:"Не удалось сверить обобщение с источниками. Попробуйте ещё раз."}}):route.fulfill({json:{facts:[{text:"Учебный факт",evidence:[{sourceId:"s",quote:"Учебная заметка"}]}],actions:[],limitations:[],sources:[{id:"s",label:"Заметка",text:"Учебная заметка"}],generatedAt:new Date().toISOString(),model:"synthetic",scope:"Учебный пример",clinicalDataVersion:0}});
    });
    await page.goto(`/doctor?patient=${patientId}`);
    const button=page.getByRole("button",{name:"Обобщить",exact:true});await button.click();await expect(page.getByRole("alert").filter({hasText:"Не удалось сверить"})).toBeVisible();await expect(button).toBeEnabled();
    await button.click();await expect(page.getByText("Учебный факт",{exact:true})).toBeVisible();expect(calls).toBe(2);await expect(button).toHaveText("Обобщить");
    await page.getByRole("button",{name:"Редактировать заметку",exact:true}).click();const drawer=page.getByRole("dialog",{name:"Заметка к приёму"});await expect(drawer).toBeVisible();
    await expect(drawer.locator('input[type="date"]')).toHaveCount(0);await expect(drawer.locator('input[type="datetime-local"]')).toHaveCount(0);await expect(drawer.getByText("Связаться до",{exact:true})).toHaveCount(0);
    await page.screenshot({path:".impeccable/review/simple-date-390.png"});expect(await drawer.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:".impeccable/review/simple-date-1440.png"});await context.close();
  }finally{
    if(patientId)await db.patient.deleteMany({where:{id:patientId}});if(doctorId){await db.auditEvent.deleteMany({where:{actorId:doctorId}});await db.user.deleteMany({where:{id:doctorId}});}await api.dispose();await db.$disconnect();
  }
});
