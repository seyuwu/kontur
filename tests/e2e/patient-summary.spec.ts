import "dotenv/config";
import { test, expect, request } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { authPost } from "./auth-request";
import { db } from "../../src/server/db";
import { emptyProfile } from "../../src/modules/clinical-profile/contract";

test("Обзор начинает с анкет, клинические сведения доступны во вкладке Данные", async ({ browser }) => {
  const api = await request.newContext({ baseURL: "http://localhost:3000", extraHTTPHeaders: { Origin: "http://localhost:3000" } });
  let doctorId = ""; const patientIds: string[] = [];
  try {
    const signup = await authPost(api, "/api/auth/sign-up/email", { name: "Врач обзора", email: `overview-${randomUUID()}@synthetic.kontur.demo`, password: randomUUID() });
    expect(signup.status()).toBe(200); doctorId = (await signup.json()).user.id;
    await db.user.update({ where: { id: doctorId }, data: { role: "DOCTOR", specialty: "Тестовый профиль" } });
    for (const name of ["Обзор без сведений", "Обзор со сведениями"]) {
      const patient = await db.patient.create({ data: { doctorId, name, publicId: `UX-${randomUUID()}`, birthDate: new Date("1990-01-01"), nextVisit: new Date("2026-10-24"), note: "Обсудить изменения на следующем контакте." } }); patientIds.push(patient.id);
    }
    const evidence = { kind: "PATIENT_REPORT" as const, reference: "Учебная беседа", date: "2026-10-21" };
    const content = emptyProfile();
    content.conditions = { status: "KNOWN", note: "", evidence: null, items: [1,2,3,4].map(n => ({ id: randomUUID(), title: `Учебное состояние ${n}`, details: "Синтетические сведения", evidence })) };
    content.allergies = { status: "NONE", note: "", evidence, items: [] };
    content.medications = { status: "KNOWN", note: "", evidence: null, items: (["TAKING", "STOPPED"] as const).map((intake, index) => ({ id: randomUUID(), title: `Учебный препарат ${index + 1}`, details: "", evidence, regimen: "Режим требует уточнения", intake, startedOn: null, stoppedOn: null })) };
    expect((await api.post("/api/clinical-profile", { data: { patientId: patientIds[1], content, expectedVersion: 0, reviewed: true, requestKey: randomUUID() } })).status()).toBe(200);
    await db.observation.create({ data: { patientId: patientIds[1], score: 4, note: "Учебная отметка пациента", requestKey: randomUUID() } });
    const context = await browser.newContext({ storageState: await api.storageState() }); const page = await context.newPage();
    await page.route("**/api/summaries?*",route=>route.fulfill({json:{enabled:false,reason:"",saved:null,fingerprint:null,stale:false}}));
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    for (const [index, state] of ["empty", "known"].entries()) {
      await page.goto(`/doctor?patient=${patientIds[index]}`);
      await expect(page.getByRole("heading", {name:"Анкеты и сроки",exact:true})).toBeVisible();
      await expect(page.getByRole("button", {name:"Назначить анкету",exact:true})).toBeEnabled();
      await expect(page.getByRole("tablist",{name:"Разделы карточки"}).getByRole("tab")).toHaveCount(4);
      await expect(page.getByRole("tab",{name:"Назначения",exact:true})).toHaveCount(0);
      for(const label of ["Написать","Открыть общение","Все назначения и результаты","Как устроен кабинет","Как пользоваться","Открыть события, требующие внимания"])await expect(page.getByRole("button",{name:label,exact:true})).toHaveCount(0);
      await expect(page.getByRole("button",{name:"Помощь",exact:true})).toHaveCount(1);
      await expect(page.getByRole("button",{name:"Подключить пациента",exact:true})).toHaveCount(1);
      await expect(page.getByRole("button",{name:"Показать приглашение",exact:true})).toHaveCount(0);
      await expect(page.getByRole("heading", {name:"Клинические сведения",exact:true})).toHaveCount(0);
      for(const width of [1440,390,320]) {await page.setViewportSize({width,height:1000});await page.screenshot({path:`.impeccable/review/patient-summary-${state}-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
      await page.getByRole("tab", {name:"Данные",exact:true}).click();
      await expect(page.getByRole("heading", {name:"Клинические сведения",exact:true})).toBeVisible();
      if(index===1) await expect(page.getByText("Учебное состояние 4",{exact:true})).toBeVisible();
      await page.getByRole("tab",{name:"Обзор",exact:true}).click();await page.reload();await expect(page.getByRole("tab",{name:"Обзор",exact:true})).toHaveAttribute("aria-selected","true");
    }
    await page.goto(`/doctor?patient=${patientIds[0]}&tab=assessments`);
    await expect(page.getByRole("tab",{name:"Обзор",exact:true})).toHaveAttribute("aria-selected","true");
    await expect(page.getByRole("button",{name:"Назначить анкету",exact:true})).toBeVisible();
    expect(errors).toEqual([]); await context.close();
  } finally {
    await db.patient.deleteMany({ where: { id: { in: patientIds } } });
    if (doctorId) { await db.auditEvent.deleteMany({ where: { actorId: doctorId } }); await db.user.deleteMany({ where: { id: doctorId } }); }
    await api.dispose(); await db.$disconnect();
  }
});
