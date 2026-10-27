import "dotenv/config";
import { randomUUID } from "node:crypto";
import { test, expect, request, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { db } from "../../src/server/db";
import { authPost } from "./auth-request";

test("patient chat fits the screen, preserves history position and jumps to new messages", async ({ browser }) => {
  const origin="http://localhost:3000"; const clients:APIRequestContext[]=[]; const users:string[]=[]; let patientId="";
  async function account(role:"PATIENT"|"DOCTOR") {
    const api=await request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});clients.push(api);
    const response=await authPost(api,"/api/auth/sign-up/email",{name:role==="DOCTOR"?"Учебный врач чата":"Учебный пациент чата",email:`chat-${randomUUID()}@synthetic.kontur.demo`,password:randomUUID()});
    expect(response.status()).toBe(200);const id=(await response.json()).user.id;users.push(id);
    if(role==="DOCTOR")await db.user.update({where:{id},data:{role}});return {api,id};
  }
  try {
    const doctor=await account("DOCTOR"), patient=await account("PATIENT");
    patientId=(await db.patient.create({data:{doctorId:doctor.id,userId:patient.id,name:"Учебный пациент чата",birthDate:new Date("1990-01-01"),publicId:`CHAT-${randomUUID()}`}})).id;
    await db.message.createMany({data:Array.from({length:80},(_,i)=>({id:randomUUID(),requestKey:randomUUID(),patientId,senderId:i%2?patient.id:doctor.id,text:`Учебное сообщение ${i}. Проверка длинной переписки и положения поля ввода.`,createdAt:new Date(Date.now()-100000+i*1000)}))});
    const context=await browser.newContext({storageState:await patient.api.storageState(),viewport:{width:390,height:844}}), page=await context.newPage();
    await page.goto("/patient?tab=messages"); const log=page.getByRole("log",{name:"Сообщения",exact:true}), input=page.getByRole("textbox",{name:"Текст сообщения",exact:true});
    const distance=()=>log.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight);
    await expect.poll(distance).toBeLessThan(3);
    const navigation=page.getByRole("navigation",{name:"Кабинет пациента"});
    for(const [width,height] of [[1440,900],[390,844],[320,700],[390,480]]) {
      await page.setViewportSize({width,height}); await expect.poll(distance).toBeLessThan(3);
      const field=await input.boundingBox(), nav=await navigation.boundingBox();
      expect(field!.y).toBeGreaterThan(0); expect(field!.y+field!.height).toBeLessThan(height);
      if(width<640)expect(field!.y+field!.height).toBeLessThan(nav!.y);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      expect(await page.evaluate(()=>window.scrollY)).toBe(0);
      await page.screenshot({path:`.impeccable/review/patient-chat-${width}-${height}.png`});
    }
    await page.setViewportSize({width:390,height:844});await expect.poll(distance).toBeLessThan(3);
    await log.evaluate(el=>{el.scrollTop=0;});
    const jump=page.getByRole("button",{name:"К последним сообщениям",exact:true});await expect(jump).toBeVisible();
    const before=await log.evaluate(el=>el.scrollTop);
    expect((await doctor.api.post("/api/workspace",{data:{action:"message",patientId,text:"Новое учебное сообщение врача",requestKey:randomUUID()}})).status()).toBe(200);
    const newMessages=page.getByRole("button",{name:"Новые сообщения · 1",exact:true});await expect(newMessages).toBeVisible();
    expect(Math.abs((await log.evaluate(el=>el.scrollTop))-before)).toBeLessThan(3);
    expect((await db.message.findFirstOrThrow({where:{patientId,text:"Новое учебное сообщение врача"}})).readAt).toBeNull();
    await newMessages.click();await expect.poll(distance).toBeLessThan(3);
    await expect.poll(async()=>!!(await db.message.findFirstOrThrow({where:{patientId,text:"Новое учебное сообщение врача"}})).readAt).toBe(true);
    await log.evaluate(el=>{el.scrollTop=0;});
    const anchor=log.getByText(/Учебное сообщение 30\./,{exact:false});const previous=await anchor.boundingBox();
    await log.getByRole("button",{name:"Показать более ранние сообщения",exact:true}).click();
    await expect(log.getByText(/Учебное сообщение 0\./,{exact:false})).toBeAttached();
    expect(Math.abs((await anchor.boundingBox())!.y-previous!.y)).toBeLessThan(4);
    await input.fill("Черновик пациента\nВторая строка");
    await page.getByRole("button",{name:/К последним сообщениям/}).click();
    await expect.poll(distance).toBeLessThan(3);
    await navigation.getByRole("button",{name:"Назначения",exact:true}).click();await navigation.getByRole("button",{name:"Чат с врачом",exact:true}).click();
    await expect(input).toHaveValue("Черновик пациента\nВторая строка");await expect.poll(distance).toBeLessThan(3);
    await page.getByRole("button",{name:"Отправить сообщение",exact:true}).click();await expect(input).toHaveValue("");await expect.poll(distance).toBeLessThan(3);
    expect((await new AxeBuilder({page}).analyze()).violations.filter(v=>v.impact==="critical"||v.impact==="serious")).toEqual([]);
    await context.close();
  } finally {
    if(patientId)await db.patient.deleteMany({where:{id:patientId}});
    await db.auditEvent.deleteMany({where:{actorId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});
    await Promise.all(clients.map(api=>api.dispose()));await db.$disconnect();
  }
});
