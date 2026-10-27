import "dotenv/config";
import {randomUUID} from "node:crypto";
import {test,expect,request} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {db} from "../../src/server/db";
import {authPost} from "./auth-request";
const origin="http://localhost:3000";
test("doctor registers through the UI, gets an empty private workspace and can log in again",async({browser})=>{
 const context=await browser.newContext(),page=await context.newPage();const email=`doctor-signup-${randomUUID()}@synthetic.kontur.demo`,password=randomUUID();let userId="",patientId="";
 try{
  await page.goto("/login");await page.getByRole("link",{name:"Создать аккаунт",exact:true}).click();await page.getByRole("radio",{name:"Врач",exact:true}).check();
  await page.getByLabel("Имя и фамилия",{exact:true}).fill("Учебный врач регистрации");await page.getByLabel("Специальность · необязательно",{exact:true}).fill("Терапевт");await page.getByLabel("Электронная почта",{exact:true}).fill(email);await page.getByLabel("Пароль",{exact:true}).fill(password);await page.getByRole("checkbox").check();
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await page.screenshot({path:`.impeccable/review/registration-doctor-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  expect((await new AxeBuilder({page}).analyze()).violations.filter(v=>v.impact==="critical"||v.impact==="serious")).toEqual([]);
  const signup=page.waitForResponse(r=>r.url().endsWith("/api/auth/sign-up/email")&&r.request().method()==="POST");await page.getByRole("button",{name:"Создать аккаунт",exact:true}).click();const response=await signup;expect(response.status()).toBe(200);
  await expect(page).toHaveURL(/\/doctor(?:\?|$)/,{timeout:30000});const user=await db.user.findUniqueOrThrow({where:{email}});userId=user.id;expect(user.role).toBe("DOCTOR");expect(user.specialty).toBe("Терапевт");
  expect((await(await context.request.get("/api/patients")).json()).patients).toEqual([]);expect((await context.request.get("/api/patients/patient-anna")).status()).toBe(404);
  const created=await context.request.post("/api/workspace",{headers:{Origin:origin},data:{action:"create-patient",name:"Учебный собственный пациент",birthDate:"1990-01-01"}});expect(created.status()).toBe(200);patientId=(await created.json()).id;expect((await db.patient.findUniqueOrThrow({where:{id:patientId}})).doctorId).toBe(userId);
  await page.getByRole("button",{name:"Выйти из аккаунта",exact:true}).click();await expect(page).toHaveURL(/\/login/,{timeout:30000});await page.getByLabel("Электронная почта",{exact:true}).fill(email);await page.getByLabel("Пароль",{exact:true}).fill(password);await page.getByRole("button",{name:"Войти",exact:true}).click();await expect(page).toHaveURL(/\/doctor(?:\?|$)/,{timeout:30000});
  const duplicate=await authPost(context.request,"/api/auth/sign-up/email",{name:"Не менять роль",email,password,accountType:"PATIENT"});expect(duplicate.ok()).toBe(false);expect((await db.user.findUniqueOrThrow({where:{id:userId}})).role).toBe("DOCTOR");
 }finally{await context.close();if(patientId)await db.patient.deleteMany({where:{id:patientId}});const user=await db.user.findUnique({where:{email}});if(user){await db.auditEvent.deleteMany({where:{actorId:user.id}});await db.user.delete({where:{id:user.id}});}await db.$disconnect();}
});
test("patient registration remains private and profile editing cannot change the role",async()=>{
 const api=await request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});let id="";
 try{
  const badEmail=`bad-role-${randomUUID()}@synthetic.kontur.demo`;const invalid=await authPost(api,"/api/auth/sign-up/email",{name:"Учебный участник",email:badEmail,password:randomUUID(),accountType:"ADMIN",syntheticData:true});expect(invalid.status()).toBe(400);expect(await db.user.findUnique({where:{email:badEmail}})).toBeNull();
  const r=await authPost(api,"/api/auth/sign-up/email",{name:"Учебный пациент регистрации",email:`patient-signup-${randomUUID()}@synthetic.kontur.demo`,password:randomUUID(),accountType:"PATIENT",syntheticData:true});expect(r.status()).toBe(200);id=(await r.json()).user.id;
  expect((await api.post("/api/auth/update-user",{data:{role:"DOCTOR"}})).status()).toBe(400);
  await api.post("/api/auth/update-user",{data:{name:"Учебный пациент",accountType:"DOCTOR",doctorSpecialty:"Не повышать роль",syntheticData:true}});
  expect((await db.user.findUniqueOrThrow({where:{id}})).role).toBe("PATIENT");expect((await api.get("/api/patients")).status()).toBe(403);expect((await(await api.get("/api/workspace")).json()).actor.role).toBe("PATIENT");
 }finally{if(id)await db.user.deleteMany({where:{id}});await api.dispose();await db.$disconnect();}
});
