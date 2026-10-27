import "dotenv/config";
import { randomUUID, createECDH, randomBytes } from "node:crypto";
import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { db } from "../../src/server/db";
import { authPost } from "./auth-request";
import { processPush, enqueueContactPush } from "../../src/modules/web-push";
const origin = "http://localhost:3000";
function subscription() { const curve = createECDH("prime256v1"); curve.generateKeys(); return { endpoint: `https://fcm.googleapis.com/fcm/send/synthetic-${randomUUID()}`, expirationTime: null, keys: { p256dh: curve.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } }; }
test.describe.serial("Web Push without contacting real push services", () => {
  let doctor: APIRequestContext, patient: APIRequestContext, other: APIRequestContext;
  let doctorId = "", patientUserId = "", otherId = "", patientId = "", definitionId = "", deviceId = "", eventId = "", sessionId = "";
  const sub = subscription();
  const doctorPassword = randomUUID(); let doctorEmail = "";
  const connect = (c: APIRequestContext, value = sub) => c.post("/api/push", { data: { action: "connect", label: "Учебный телефон", subscription: value } });
  async function newTest() { const response = await doctor.post("/api/push", { data: { action: "test", deviceId, requestKey: randomUUID() } }); expect(response.status()).toBe(200); return (await response.json()).id as string; }
  async function submit() {
    const ids: string[]=[];
    for(let i=0;i<2;i++) {
      const requestKey=randomUUID();
      const input={action:"observation",patientId,note:"Учебная просьба",needsContact:true,requestKey};
      expect((await patient.post("/api/workspace",{data:input})).status()).toBe(200);
      expect((await patient.post("/api/workspace",{data:input})).status()).toBe(200);
      ids.push((await db.observation.findUniqueOrThrow({where:{requestKey}})).id);
    }
    return db.observation.findMany({where:{id:{in:ids}},orderBy:{createdAt:"asc"},include:{pushDeliveries:true}});
  }
  test.beforeAll(async () => {
    async function account(role: string) { const c = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } }); const r = await authPost(c, "/api/auth/sign-up/email", { name: "Push Учебный", email: role === "DOCTOR" && !doctorEmail ? (doctorEmail = `push-${randomUUID()}@synthetic.kontur.demo`) : `push-${randomUUID()}@synthetic.kontur.demo`, password: doctorPassword }); expect(r.status()).toBe(200); const id = (await r.json()).user.id; if (role === "DOCTOR") await db.user.update({ where: { id }, data: { role } }); return { c, id }; }
    const d = await account("DOCTOR"); doctor = d.c; doctorId = d.id; const p = await account("PATIENT"); patient = p.c; patientUserId = p.id; const o = await account("DOCTOR"); other = o.c; otherId = o.id;
    sessionId = (await db.session.findFirstOrThrow({ where: { userId: doctorId } })).id;
    patientId = (await db.patient.create({ data: { doctorId, userId: patientUserId, name: "Учебный Push", publicId: `PUSH-${randomUUID()}`, birthDate: new Date("1990-01-01") } })).id;
    definitionId = (await (await doctor.get(`/api/assessments?patientId=${patientId}`)).json()).assignableDefinitionIds[0];
  });
  test.afterAll(async () => {
    const ids = [doctorId, patientUserId, otherId].filter(Boolean); await db.patient.deleteMany({ where: { id: patientId } }); await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } }); await db.user.deleteMany({ where: { id: { in: ids } } });
    await Promise.all([doctor?.dispose(), patient?.dispose(), other?.dispose()]); await db.$disconnect();
  });
  test("enforces authentication, confirmed roles, origin and subscription boundary", async () => {
    const anon = await request.newContext({ baseURL: origin }); expect((await anon.get("/api/push")).status()).toBe(401); await anon.dispose(); expect((await patient.get("/api/push")).status()).toBe(200);
    expect((await doctor.post("/api/push", { headers: { Origin: "https://evil.test" }, data: { action: "connect", label: "x", subscription: sub } })).status()).toBe(403);
    expect((await connect(doctor, { ...sub, endpoint: "https://127.0.0.1/private" })).status()).toBe(400);
    const result = await connect(doctor); expect(result.status()).toBe(200); deviceId = (await result.json()).id;
    expect((await connect(doctor)).status()).toBe(200); expect(await db.pushDevice.count({ where: { userId: doctorId } })).toBe(1);
    expect((await connect(other)).status()).toBe(409); expect((await connect(patient)).status()).toBe(409); const read = await doctor.get("/api/push"); expect(read.headers()["cache-control"]).toContain("no-store"); const data = await read.json();
    expect(data.enabled).toBe(true); expect(data.devices[0].currentSession).toBe(true); expect(JSON.stringify(data)).not.toContain(sub.endpoint); expect(JSON.stringify(data)).not.toContain(sub.keys.auth); expect(JSON.stringify(data)).not.toContain(sessionId);
  });
  test("queues idempotent device-scoped tests and records acceptance separately from browser display", async () => {
    const input = { action: "test", deviceId, requestKey: randomUUID() }; const a = await doctor.post("/api/push", { data: input }); expect(a.status()).toBe(200); const id = (await a.json()).id;
    expect((await (await doctor.post("/api/push", { data: input })).json()).id).toBe(id); expect((await other.post("/api/push", { data: input })).status()).toBe(404);
    let count = 0; const send = async (_subscription: unknown, payload: { type: string; url: string }) => { count++; expect(payload.type).toBe("kontur-test"); expect(payload.url).toBe("/doctor"); };
    await Promise.all([processPush(id, send), processPush(id, send)]); expect(count).toBe(1); expect((await db.pushDelivery.findUniqueOrThrow({ where: { id } })).status).toBe("ACCEPTED");
    expect((await other.post("/api/push", { data: { action: "shown", deliveryId: id } })).status()).toBe(404);
    expect((await doctor.post("/api/push", { data: { action: "shown", deliveryId: id } })).status()).toBe(200); expect((await db.pushDelivery.findUniqueOrThrow({ where: { id } })).status).toBe("SHOWN");
  });
  test("contact requests and questionnaire completion queue independent idempotent pushes", async () => {
    const assigned=await doctor.post("/api/assessments",{data:{action:"assign",patientId,definitionId}});expect(assigned.status()).toBe(200);const assignmentId=(await assigned.json()).id;
    expect((await patient.post("/api/assessments",{data:{action:"submit",assignmentId,revision:0,answers:{clarity:"unclear",contact:"yes"},note:"",requestKey:randomUUID()}})).status()).toBe(200);
    eventId=(await db.reviewEvent.findFirstOrThrow({where:{submission:{assignmentId},pushDeliveries:{some:{deviceId}}}})).id;
    expect(await db.pushDelivery.count({where:{event:{patientId}}})).toBe(1);
    expect(await db.notificationDelivery.count({where:{event:{patientId}}})).toBe(0);
    const requestKey=randomUUID();expect((await patient.post("/api/workspace",{data:{action:"observation",patientId,note:"Просто текст",needsContact:false,requestKey}})).status()).toBe(200);
    const plain=await db.observation.findUniqueOrThrow({where:{requestKey}});expect(await db.pushDelivery.count({where:{observationId:plain.id}})).toBe(0);
    const rows=await submit();expect(rows).toHaveLength(2);expect(rows.every(r=>r.pushDeliveries.length===1)).toBe(true);
    const id=rows[0].pushDeliveries[0].id;
    await processPush(id,async(_s,payload)=>{expect(Object.keys(payload).sort()).toEqual(["deliveryId","tag","type","url"]);expect(payload.type).toBe("kontur-contact");expect(payload.url).toBe(`/doctor?patient=${patientId}`);expect(JSON.stringify(payload)).not.toContain("Учебная");});
    expect((await db.pushDelivery.findUniqueOrThrow({where:{id}})).status).toBe("ACCEPTED");
    await expect(db.$transaction(async tx=>{const o=await tx.observation.create({data:{patientId,note:"rollback",needsContact:true,requestKey:randomUUID()}});await enqueueContactPush(tx,{id:o.id,recipientId:doctorId});throw Error("rollback");})).rejects.toThrow("rollback");
    expect(await db.pushDelivery.count({where:{observation:{patientId}}})).toBe(2);
    // Already queued historical questionnaire notifications are cancelled by the sender.
    const unused=await db.reviewEvent.findFirstOrThrow({where:{patientId,pushDeliveries:{none:{deviceId}}}}); const legacy=await db.pushDelivery.create({data:{eventId:unused.id,deviceId,sessionId,purpose:"LEGACY_EVENT"}});await processPush(legacy.id,async()=>{throw Error("must not send");});expect((await db.pushDelivery.findUniqueOrThrow({where:{id:legacy.id}})).status).toBe("CANCELLED");
  });
  test("retries explicit transient rejection at most three times, preserves unknown outcomes", async () => {
    const fresh = (await submit())[0].pushDeliveries[0];
    for (let i = 0; i < 3; i++) { await db.pushDelivery.update({ where: { id: fresh.id }, data: { nextAttemptAt: null } }); await processPush(fresh.id, async () => { throw { statusCode: 503 }; }); }
    const failed = await db.pushDelivery.findUniqueOrThrow({ where: { id: fresh.id } }); expect(failed.status).toBe("FAILED"); expect(failed.attempts).toBe(3); expect(failed.nextAttemptAt).toBeNull();
    const unknown = (await submit())[0].pushDeliveries[0]; let calls = 0; const send = async () => { calls++; throw new TypeError("connection lost"); }; await processPush(unknown.id, send); await processPush(unknown.id, send); expect(calls).toBe(1); expect((await db.pushDelivery.findUniqueOrThrow({ where: { id: unknown.id } })).status).toBe("UNCERTAIN");
    const stale = (await submit())[0].pushDeliveries[0]; await db.pushDelivery.update({ where: { id: stale.id }, data: { status: "SENDING", updatedAt: new Date(Date.now() - 180000) } }); await processPush(stale.id, send); expect(calls).toBe(1); expect((await db.pushDelivery.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("UNCERTAIN");
  });
  test("revoked endpoints disable the device and cancel pending transmissions", async () => {
    const rows = await submit(); await processPush(rows[0].pushDeliveries[0].id, async () => { throw { statusCode: 410 }; }); expect((await db.pushDevice.findUniqueOrThrow({ where: { id: deviceId } })).active).toBe(false);
    expect((await db.pushDelivery.findUniqueOrThrow({ where: { id: rows[1].pushDeliveries[0].id } })).status).toBe("CANCELLED"); expect((await submit()).every(r => !r.pushDeliveries.length)).toBe(true); expect((await connect(doctor)).status()).toBe(200);
  });
  test("checks acknowledged requests, changed ownership, session expiry and channel configuration before sending", async () => {
    const send = async () => { throw new Error("must not send"); };
    const resolved = (await submit())[0]; await db.observation.update({ where: { id: resolved.id }, data: { acknowledgedAt: new Date() } }); await processPush(resolved.pushDeliveries[0].id, send); expect((await db.pushDelivery.findUniqueOrThrow({ where: { id: resolved.pushDeliveries[0].id } })).status).toBe("CANCELLED");
    const changed = (await submit())[0]; await db.patient.update({ where: { id: patientId }, data: { doctorId: otherId } }); await processPush(changed.pushDeliveries[0].id, send); expect((await db.pushDelivery.findUniqueOrThrow({ where: { id: changed.pushDeliveries[0].id } })).status).toBe("CANCELLED"); await db.patient.update({ where: { id: patientId }, data: { doctorId } });
    const expiry = (await submit())[0]; const session = await db.session.findUniqueOrThrow({ where: { id: sessionId } }); await db.session.update({ where: { id: sessionId }, data: { expiresAt: new Date(0) } }); await processPush(expiry.pushDeliveries[0].id, send); expect((await db.pushDelivery.findUniqueOrThrow({ where: { id: expiry.pushDeliveries[0].id } })).status).toBe("CANCELLED"); await db.session.update({ where: { id: sessionId }, data: { expiresAt: session.expiresAt } });
    const disabled = (await submit())[0]; const previous = process.env.WEB_PUSH_ENABLED; process.env.WEB_PUSH_ENABLED = "false"; try { await processPush(disabled.pushDeliveries[0].id); expect((await db.pushDelivery.findUniqueOrThrow({ where: { id: disabled.pushDeliveries[0].id } })).status).toBe("CANCELLED"); } finally { process.env.WEB_PUSH_ENABLED = previous; }
  });
  test("browser enrollment, test state, denied/unsupported states and responsive settings", async ({ browser }) => {
    // Real SW registration and permission API; subscription transport is deliberately simulated.
    await db.reviewEvent.updateMany({ where: { patientId, id: { not: eventId } }, data: { status: "RESOLVED" } });
    await doctor.post("/api/push", { data: { action: "disconnect", deviceId } });
    const c = await browser.newContext({ storageState: await doctor.storageState(), permissions: ["notifications"], viewport: { width: 1440, height: 1000 } });
    await c.addInitScript(({ sub, key }) => {
      const decode = (v: string) => Uint8Array.from(atob(v.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - v.length % 4) % 4)), ch => ch.charCodeAt(0));
      let subscribed = false; const fake = { endpoint: sub.endpoint, options: { applicationServerKey: decode(key).buffer }, toJSON: () => sub, unsubscribe: async () => { subscribed = false; return true; } };
      PushManager.prototype.getSubscription = async () => subscribed ? fake as unknown as PushSubscription : null;
      PushManager.prototype.subscribe = async () => { subscribed = true; return fake as unknown as PushSubscription; };
    }, { sub, key: (await (await doctor.get("/api/push")).json()).publicKey });
    const page = await c.newPage(); await page.goto("/doctor"); await page.getByRole("button", { name: "Настроить push-уведомления" }).click(); const panel = page.getByRole("dialog", { name: "Уведомления на устройстве" }); await expect(panel.getByRole("button", { name: "Подключить уведомления" })).toBeEnabled();
    for (const width of [1440, 390, 320, 1575]) { await page.setViewportSize({ width, height: width > 400 ? 1000 : 930 }); await page.screenshot({ fullPage: true, animations: "disabled", path: `.impeccable/review/push-settings-${width}.png` }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`).toBe(true); }
    await panel.getByRole("button", { name: "Подключить уведомления" }).click(); await expect(panel.getByText("Подключено", { exact: true })).toBeVisible(); await expect.poll(async () => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration("/"))?.active)).toBe(true);
    const queued = page.waitForResponse(r => r.url().endsWith("/api/push") && r.request().method() === "POST" && r.request().postDataJSON()?.action === "test"); await panel.getByRole("button", { name: "Отправить проверку" }).click(); const deliveryResponse = await queued; expect(deliveryResponse.status()).toBe(200); await processPush((await deliveryResponse.json()).id, async () => {}); await expect(panel.getByText(/Проверка: Push-сервис принял уведомление/)).toBeVisible();
    await page.setViewportSize({ width: 390, height: 1000 }); await page.screenshot({ fullPage: true, animations: "disabled", path: ".impeccable/review/push-connected-390.png" });
    await page.keyboard.press("Escape"); await page.evaluate(() => Object.defineProperty(Notification, "permission", { configurable: true, get: () => "denied" })); await page.getByRole("button", { name: "Настроить push-уведомления" }).click(); await expect(panel.getByText(/Браузер заблокировал уведомления/)).toBeVisible(); await page.setViewportSize({ width: 320, height: 930 }); await page.screenshot({ fullPage: true, animations: "disabled", path: ".impeccable/review/push-denied-320.png" });
    await page.keyboard.press("Escape"); await page.evaluate(() => { Reflect.deleteProperty(window, "PushManager"); Object.defineProperty(navigator, "userAgent", { value: "iPhone" }); }); await page.getByRole("button", { name: "Настроить push-уведомления" }).click(); await expect(panel.getByText(/добавьте сайт на экран/)).toBeVisible(); await page.screenshot({ fullPage: true, animations: "disabled", path: ".impeccable/review/push-ios-320.png" });
    await page.keyboard.press("Escape"); await page.goto(`/doctor?patient=${patientId}&event=${eventId}`); const review = page.getByRole("dialog", { name: /Пациент просит связаться|Нужно объяснить следующие шаги/ }); await review.getByText(/Push на устройства ·/).click(); await expect(review.getByText("Это технический статус уведомления.", { exact: false })).toBeVisible(); await page.screenshot({ fullPage: true, animations: "disabled", path: ".impeccable/review/push-event-320.png" }); await c.close();
    const loggedOut = await browser.newContext(); const loginPage = await loggedOut.newPage();
    await loginPage.goto(`/doctor?patient=${patientId}&event=${eventId}`); await expect(loginPage).toHaveURL(/\/login\?next=/);
    await loginPage.getByRole("textbox", { name: "Электронная почта" }).fill(doctorEmail); await loginPage.getByLabel("Пароль", { exact: true }).fill(doctorPassword); await loginPage.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(loginPage.getByRole("dialog", { name: /Пациент просит связаться|Нужно объяснить следующие шаги/ })).toBeVisible(); await loggedOut.close();
  });
  test("bounded devices, test rate limit and logout revoke further delivery", async () => {
    await db.pushDelivery.deleteMany({ where: { deviceId, eventId: null } });
    for (let i = 0; i < 3; i++) await newTest(); expect((await doctor.post("/api/push", { data: { action: "test", deviceId, requestKey: randomUUID() } })).status()).toBe(429);
    for (let i = 0; i < 4; i++) expect((await connect(doctor, subscription())).status()).toBe(200); expect((await connect(doctor, subscription())).status()).toBe(409);
    expect((await other.post("/api/push", { data: { action: "disconnect", deviceId } })).status()).toBe(404);
    const rows = await submit(); expect(rows[0].pushDeliveries).toHaveLength(5); expect((await doctor.post("/api/auth/sign-out", { data: {} })).status()).toBe(200);
    expect((await db.pushDevice.findUniqueOrThrow({ where: { id: deviceId } })).sessionId).toBeNull();
    for (const row of rows[0].pushDeliveries) { let count = 0; await processPush(row.id, async () => { count++; }); expect(count).toBe(0); expect((await db.pushDelivery.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("CANCELLED"); }
  });
});
