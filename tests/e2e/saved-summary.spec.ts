import "dotenv/config";
import {randomUUID} from "node:crypto";
import {test,expect,request} from "@playwright/test";
import {db} from "../../src/server/db";
import type { SavedSummaryResult } from "../../src/modules/summaries/saved";
import {authPost} from "./auth-request";
test("saved summary survives reload, remains on failure, and is replaced after success",async({browser})=>{
  const origin="http://localhost:3000";
  const api=await request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});let doctorId="",patientId="";
  try{
    const signup=await authPost(api,"/api/auth/sign-up/email",{name:"Учебный врач",email:`saved-${randomUUID()}@synthetic.kontur.demo`,password:randomUUID()});expect(signup.status()).toBe(200);doctorId=(await signup.json()).user.id;
    await db.user.update({where:{id:doctorId},data:{role:"DOCTOR"}});
    patientId=(await db.patient.create({data:{doctorId,name:"Учебный пациент",publicId:`SAVED-${randomUUID()}`,birthDate:new Date("1990-01-01"),note:"Учебная заметка"}})).id;
    const payload:SavedSummaryResult={facts:[{text:"Первое сохранённое обобщение",evidence:[{sourceId:"s1",quote:"Учебная заметка"}]}],actionIds:[],actions:[],limitations:[],sources:[{id:"s1",label:"Заметка",text:"Учебная заметка"}],generatedAt:new Date("2026-10-23T10:00:00Z").toISOString(),clinicalDataVersion:0,model:"synthetic",scope:"Учебный пример"};
    payload.facts.push({text:"**Отдельная тема**\n\n- Первый учебный пункт\n- Второй учебный пункт",evidence:payload.facts[0].evidence});
    payload.sources[0].role="PRIMARY";
    payload.sources.push({id:"past",role:"PREVIOUS",label:"Прошлая анкета",text:"Прошлый результат: 35"},{id:"context",role:"CONTEXT",label:"Заметка",text:"Обсудить напряжение"});
    payload.facts.push({text:"Сравнение учебных результатов",evidence:[payload.facts[0].evidence[0],{sourceId:"past",quote:"Прошлый результат: 35"}]},{text:"Ответы связаны с темой заметки",evidence:[payload.facts[0].evidence[0],{sourceId:"context",quote:"Обсудить напряжение"}]});
    const row=await db.savedSummary.create({data:{patientId,doctorId,scopeKey:"patient",payload}});
    expect((await api.get(`/api/summaries?patientId=${patientId}`)).headers()["cache-control"]).toContain("no-store");
    const anon=await request.newContext({baseURL:origin});expect((await anon.get(`/api/summaries?patientId=${patientId}`)).status()).toBe(401);await anon.dispose();
    const context=await browser.newContext({storageState:await api.storageState()});const page=await context.newPage();let attempts=0;
    await page.route("**/api/summaries",async route=>{
      if(route.request().method()!=="POST")return route.continue();attempts++;
      if(attempts===1)return route.fulfill({status:504,json:{error:"Обобщение не завершилось за 30 секунд. Попробуйте ещё раз."}});
      const replacement={...payload,generatedAt:new Date().toISOString(),facts:[{...payload.facts[0],text:"Обновлённое сохранённое обобщение"}]};
      await db.savedSummary.update({where:{id:row.id},data:{payload:replacement}});return route.fulfill({json:replacement});
    });
    await page.route("**/api/summaries?*",async route=>{
      const response=await route.fetch();const data=await response.json();
      await route.fulfill({response,json:{...data,stale:false}});
    });
    await page.goto(`/doctor?patient=${patientId}`);const region=page.getByRole("region",{name:"Обобщение для врача",exact:true});
    await expect(region.getByText("Первое сохранённое обобщение",{exact:true})).toBeVisible();expect(attempts).toBe(0);
    await expect(region.getByText("Отдельная тема",{exact:true})).toBeVisible();
    await expect(region.getByRole("heading",{name:"Сравнение с прошлым",exact:true})).toBeVisible();
    await expect(region.getByRole("heading",{name:"Связь с другими данными",exact:true})).toBeVisible();
    await expect(region.getByText("Первый учебный пункт",{exact:true})).toBeVisible();
    for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await region.scrollIntoViewIfNeeded();await page.screenshot({path:`.impeccable/review/summary-structured-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
    await region.locator(".summary-evidence summary").first().click();await expect(region.locator("blockquote").first()).toBeVisible();
    await region.getByRole("button",{name:"Обобщить",exact:true}).click();await expect(region.getByRole("alert")).toContainText("30 секунд");await expect(region.getByText("Первое сохранённое обобщение",{exact:true})).toBeVisible();
    await page.reload();await expect(region.getByText("Первое сохранённое обобщение",{exact:true})).toBeVisible();expect(attempts).toBe(1);
    await region.getByRole("button",{name:"Обобщить",exact:true}).click();await expect(region.getByText("Обновлённое сохранённое обобщение",{exact:true})).toBeVisible();await expect(region.getByText("Первое сохранённое обобщение",{exact:true})).toHaveCount(0);
    await page.reload();await expect(region.getByText("Обновлённое сохранённое обобщение",{exact:true})).toBeVisible();expect(attempts).toBe(2);expect(await db.savedSummary.count({where:{patientId,doctorId}})).toBe(1);
    await context.close();
  }finally{
    if(patientId)await db.patient.deleteMany({where:{id:patientId}});if(doctorId){await db.auditEvent.deleteMany({where:{actorId:doctorId}});await db.user.deleteMany({where:{id:doctorId}});}await api.dispose();await db.$disconnect();
  }
});

test("summary starts automatically, updates on source changes and skips unchanged polling",async({browser})=>{
  const origin="http://localhost:3000";
  const api=await request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});let doctorId="",patientId="";
  try {
    const signup=await authPost(api,"/api/auth/sign-up/email",{name:"Учебный врач",email:`auto-${randomUUID()}@synthetic.kontur.demo`,password:randomUUID()});expect(signup.status()).toBe(200);doctorId=(await signup.json()).user.id;
    await db.user.update({where:{id:doctorId},data:{role:"DOCTOR"}});
    patientId=(await db.patient.create({data:{doctorId,name:"Учебный пациент",publicId:`AUTO-${randomUUID()}`,birthDate:new Date("1990-01-01"),note:"Первая учебная заметка"}})).id;
    const context=await browser.newContext({storageState:await api.storageState()});const page=await context.newPage();let calls=0;
    await page.route("**/api/summaries",async route=>{
      if(route.request().method()!=="POST")return route.continue();
      expect(route.request().postDataJSON().automatic).toBe(true);calls++;
      const state=await (await api.get(`/api/summaries?patientId=${patientId}`)).json();
      const patient=await db.patient.findUniqueOrThrow({where:{id:patientId}});
      const payload={generation:calls===1?"RULES":"MODEL",...(calls===1?{retryAfter:new Date(Date.now()+60000).toISOString()}:{}),sourceFingerprint:state.fingerprint,facts:[{text:patient.note,evidence:[{sourceId:"s1",quote:patient.note}]}],actionIds:[],actions:[],limitations:[],sources:[{id:"s1",label:"Заметка врача",text:patient.note}],generatedAt:new Date().toISOString(),clinicalDataVersion:patient.clinicalDataVersion,model:"synthetic",scope:"Учебный пример"};
      const key={patientId,doctorId,scopeKey:"patient"};
      await db.savedSummary.upsert({where:{patientId_doctorId_scopeKey:key},create:{...key,payload},update:{payload}});
      return route.fulfill({json:payload});
    });
    await page.goto(`/doctor?patient=${patientId}`);const region=page.getByRole("region",{name:"Обобщение для врача",exact:true});
    await expect(region.locator(".summary-facts > li > .summary-text").getByText("Первая учебная заметка",{exact:true})).toBeVisible();expect(calls).toBe(1);
    await expect(region.getByText("Показаны рассчитанные результаты анкет. Пояснение модели пока недоступно.",{exact:true})).toBeVisible();
    await db.patient.update({where:{id:patientId},data:{note:"Исправленная учебная заметка"}});
    await expect(region.locator(".summary-facts > li > .summary-text").getByText("Исправленная учебная заметка",{exact:true})).toBeVisible();expect(calls).toBe(2);
    await expect(region.getByText("Показаны рассчитанные результаты анкет. Пояснение модели пока недоступно.",{exact:true})).toHaveCount(0);
    await page.reload();await expect(region.locator(".summary-facts > li > .summary-text").getByText("Исправленная учебная заметка",{exact:true})).toBeVisible();
    await page.waitForTimeout(6500);expect(calls).toBe(2);
    await context.close();
  } finally {
    if(patientId)await db.patient.deleteMany({where:{id:patientId}});if(doctorId){await db.auditEvent.deleteMany({where:{actorId:doctorId}});await db.user.deleteMany({where:{id:doctorId}});}await api.dispose();await db.$disconnect();
  }
});
