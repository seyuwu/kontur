import "dotenv/config";
import { randomUUID } from "node:crypto";
import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { db } from "../../src/server/db";
import { authPost } from "./auth-request";
import { processReviewEmail, retryReviewEmail } from "../../src/modules/notifications";

const origin = "http://localhost:3000";
test.describe.serial("Состояние внешней передачи без реальной отправки", () => {
  let doctor: APIRequestContext, patient: APIRequestContext, other: APIRequestContext;
  let doctorId = "", userId = "", otherId = "", patientId = "", definitionId = "", eventId = "", firstId = "", secondId = "";
  async function submit() { const assigned = await doctor.post("/api/assessments", { data: { action: "assign", patientId, definitionId } }); expect(assigned.status()).toBe(200); const assignmentId = (await assigned.json()).id; const sent = await patient.post("/api/assessments", { data: { action: "submit", assignmentId, revision: 0, answers: { clarity: "unclear", contact: "yes" }, note: "Учебный запрос без медицинских данных", requestKey: randomUUID() } }); expect(sent.status()).toBe(200); return db.reviewEvent.findMany({ where: { submission: { assignmentId } }, include: { emailDelivery: true } }); }
  test.beforeAll(async () => { async function account(role: string) { const c = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } }); const r = await authPost(c, "/api/auth/sign-up/email", { name: "Уведомления Учебные", email: `notification-${randomUUID()}@synthetic.kontur.demo`, password: randomUUID() }); expect(r.status()).toBe(200); const id = (await r.json()).user.id; if (role === "DOCTOR") await db.user.update({ where: { id }, data: { role } }); return { c, id }; }
    const d = await account("DOCTOR"); doctor = d.c; doctorId = d.id; const p = await account("PATIENT"); patient = p.c; userId = p.id; const o = await account("DOCTOR"); other = o.c; otherId = o.id; patientId = (await db.patient.create({ data: { doctorId, userId, name: "Сигнал Учебный", publicId: `NOTIFY-${randomUUID()}`, birthDate: new Date("1990-01-01") } })).id; definitionId = (await (await doctor.get(`/api/assessments?patientId=${patientId}`)).json()).assignableDefinitionIds[0]; const rows = await submit(); eventId = rows[0].id; 
  });
  test.afterAll(async () => { await db.patient.deleteMany({ where: { id: patientId } }); await db.auditEvent.deleteMany({ where: { actorId: { in: [doctorId, userId, otherId].filter(Boolean) } } }); await db.user.deleteMany({ where: { id: { in: [doctorId, userId, otherId].filter(Boolean) } } }); await Promise.all([doctor?.dispose(), patient?.dispose(), other?.dispose()]); await db.$disconnect(); });
  test("анкеты не создают email, события доступны в кабинете", async () => {
    expect(await db.notificationDelivery.count({where:{event:{patientId}}})).toBe(0);
    expect(await db.pushDelivery.count({where:{event:{patientId}}})).toBe(0);
    const result=await doctor.get(`/api/review-events?eventId=${eventId}`);expect(result.status()).toBe(200);const event=await result.json();expect(event.emailEnabled).toBe(false);expect(event.delivery).toBeNull();
    const data={action:"retry-email",eventId,revision:0,requestKey:randomUUID(),duplicateRisk:false};
    expect((await patient.post("/api/review-events",{data})).status()).toBe(403);
    expect((await other.post("/api/review-events",{data})).status()).toBe(404);
    expect((await doctor.post("/api/review-events",{data})).status()).toBe(409);
  });
  test("ранее поставленная в очередь отправка отменяется, успешная история не переписывается",async()=>{
    const row=await db.notificationDelivery.create({data:{eventId,status:"PENDING"}});let calls=0;
    await Promise.all([processReviewEmail(row.id,async()=>{calls++;return{messageId:"test"};}),processReviewEmail(row.id)]);
    const cancelled=await db.notificationDelivery.findUniqueOrThrow({where:{id:row.id}});expect(cancelled.status).toBe("CANCELLED");expect(cancelled.lastErrorCode).toBe("CONTACT_REQUESTS_ONLY");expect(calls).toBe(0);
    await db.notificationDelivery.update({where:{id:row.id},data:{status:"ACCEPTED",acceptedAt:new Date()}});await processReviewEmail(row.id);expect((await db.notificationDelivery.findUniqueOrThrow({where:{id:row.id}})).status).toBe("ACCEPTED");
  });
});
