import { describe, it, expect, vi, afterEach } from "vitest";
import { createECDH, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import webpush from "web-push";
import { validEndpoint, subscriptionSchema, pushConfiguration } from "../../src/modules/web-push/config";
import { doctorReturn, loginReturn } from "../../src/lib/login-return";
const worker = readFileSync("public/sw.js", "utf8");
function harness() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const show = vi.fn(async () => {}), fetch = vi.fn(async () => ({})), navigate = vi.fn(async () => {}), focus = vi.fn(async () => {}), openWindow = vi.fn(async () => {});
  const self = { skipWaiting: vi.fn(async () => {}), location: { origin: "https://kontur.test" }, addEventListener: (name: string, handler: typeof handlers[string]) => { handlers[name] = handler; }, registration: { showNotification: show }, clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => [{ url: "https://kontur.test/doctor", navigate, focus }]), openWindow } };
  runInNewContext(worker, { self, URL, fetch });
  async function emit(name: string, input: object) { let pending: Promise<unknown> | undefined; handlers[name]({ ...input, waitUntil: (p: Promise<unknown>) => { pending = p; } }); await pending; }
  return { emit, show, fetch, navigate, focus, openWindow, self };
}
afterEach(() => vi.unstubAllEnvs());
describe("Web Push boundaries", () => {
  it("shows medication and unfinished questionnaire reminders without medical data in the payload",async()=>{
    for(const [type,title] of [["kontur-medication","время приёма лекарства"],["kontur-medication-upcoming","скоро начало приёма"],["kontur-assessment-reminder","анкета ожидает заполнения"],["kontur-plan","назначения обновлены"]]){
      const h=harness();await h.emit("push",{data:{json:()=>({type,deliveryId:"reminder1",url:"/patient",body:"Injected dose",title:"Injected name"})}});
      expect(h.show).toHaveBeenCalledWith(`Контур · ${title}`,expect.objectContaining({data:{url:"/patient"}}));expect(JSON.stringify(h.show.mock.calls)).not.toContain("Injected");
    }
  });
  it("shows a fixed assignment deadline and preserves only the patient assignment link",async()=>{
    const h=harness();await h.emit("push",{data:{json:()=>({type:"kontur-assigned",deliveryId:"assigned1",url:"/patient?assignment=a1&secret=clinical",dueDate:"2026-10-27",title:"private name",body:"private diagnosis"})}});
    expect(h.show).toHaveBeenCalledWith("Контур · новая анкета от врача",expect.objectContaining({body:expect.stringContaining("27 октября"),data:{url:"/patient?assignment=a1"}}));expect(JSON.stringify(h.show.mock.calls)).not.toContain("private");
    await h.emit("notificationclick",{notification:{close:vi.fn(),data:{url:"/patient?assignment=a1"}}});expect(h.navigate).toHaveBeenCalledWith("/patient?assignment=a1");
  });
  it("keeps the patient assignment after authentication without accepting external destinations",()=>{
    expect(loginReturn("/patient?assignment=a1&secret=clinical")).toBe("/patient?assignment=a1");expect(loginReturn("/patient")).toBe("/patient");expect(loginReturn("https://evil.test/patient?assignment=a1")).toBe("/");expect(loginReturn("/patient/../api/private")).toBe("/");
  });
  it("shows a fixed contact-request message without patient identity or injected text", async () => {
    const h=harness(); await h.emit("push",{data:{json:()=>({type:"kontur-contact",deliveryId:"abc123",url:"/doctor?patient=p1",title:"private name",body:"private answer"})}});
    expect(h.show).toHaveBeenCalledWith("Контур · просьба связаться",expect.objectContaining({data:{url:"/doctor?patient=p1"}}));expect(JSON.stringify(h.show.mock.calls)).not.toContain("private");
  });
  it("activates updated notification templates for already-open pages", async () => {
    const h=harness(); await h.emit("install",{}); await h.emit("activate",{});
    expect(h.self.skipWaiting).toHaveBeenCalledOnce(); expect(h.self.clients.claim).toHaveBeenCalledOnce();
  });
  it("preserves exact event navigation after login without open redirects", () => {
    expect(loginReturn("/doctor?patient=p1&event=e1")).toBe("/doctor?patient=p1&event=e1");
    expect(loginReturn("/connect")).toBe("/");
    for (const value of ["//evil.test", "https://evil.test/doctor", "/doctor/../api/private", "/doctor-other", "javascript:alert(1)"]) expect(loginReturn(value)).toBe("/");
    expect(doctorReturn({ patient: ["p1", "p2"], event: "e1" })).toBe("/doctor?event=e1");
    expect(loginReturn("/doctor?patient=p1&event=e1&secret=clinical")).toBe("/doctor?patient=p1&event=e1");
  });
  it("rejects arbitrary fetch targets, credentials, ports and provider lookalikes", () => {
    for (const endpoint of ["http://fcm.googleapis.com/a", "https://127.0.0.1/a", "https://fcm.googleapis.com.evil.test/a", "https://user@fcm.googleapis.com/a", "https://fcm.googleapis.com:444/a", "https://evil.test/a", "https://fcm.googleapis.com/a#secret"]) expect(validEndpoint(endpoint), endpoint).toBe(false);
    for (const endpoint of ["https://fcm.googleapis.com/fcm/send/x", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/x", "https://wns2-par02p.notify.windows.com/w/?x=y"]) expect(validEndpoint(endpoint), endpoint).toBe(true);
  });
  it("validates actual P256 subscription points and rejects extra fields", () => {
    const curve = createECDH("prime256v1"); curve.generateKeys();
    const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/unit", keys: { p256dh: curve.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
    expect(subscriptionSchema.safeParse(subscription).success).toBe(true);
    // PushSubscription.toJSON() includes this standard field in desktop browsers.
    expect(subscriptionSchema.safeParse({ ...subscription, expirationTime: null }).success).toBe(true);
    expect(subscriptionSchema.safeParse({ ...subscription, expirationTime: 1793000000000 }).success).toBe(true);
    expect(subscriptionSchema.safeParse({ ...subscription, keys: { ...subscription.keys, p256dh: "A".repeat(87) } }).success).toBe(false);
    expect(subscriptionSchema.safeParse({ ...subscription, arbitrary: true }).success).toBe(false);
  });
  it("requires an explicit flag, valid matching persistent keys and a secure origin", () => {
    const keys = webpush.generateVAPIDKeys();
    for (const [k, v] of Object.entries({ WEB_PUSH_ENABLED: "true", WEB_PUSH_PUBLIC_KEY: keys.publicKey, WEB_PUSH_PRIVATE_KEY: keys.privateKey, WEB_PUSH_SUBJECT: "mailto:operator@kontur.test", APP_ORIGIN: "https://kontur.test", DEMO_MODE: "false", ALLOW_DEMO_WEB_PUSH: "false" })) vi.stubEnv(k, v);
    expect(pushConfiguration().enabled).toBe(true); expect(pushConfiguration("DEMO").enabled).toBe(false);
    vi.stubEnv("APP_ORIGIN", "http://192.168.1.2:3000"); expect(pushConfiguration().enabled).toBe(false);
    vi.stubEnv("APP_ORIGIN", "https://kontur.test"); vi.stubEnv("WEB_PUSH_PRIVATE_KEY", webpush.generateVAPIDKeys().privateKey); expect(pushConfiguration().enabled).toBe(false);
  });
  it("shows fixed neutral text, strips arbitrary content and reports only browser display", async () => {
    const h = harness(); await h.emit("push", { data: { json: () => ({ type: "kontur-event", deliveryId: "delivery1", url: "/doctor?patient=patient1&event=event1&secret=clinical", body: "Patient name and diagnosis", title: "Arbitrary medical title" }) } });
    const [title, options] = h.show.mock.calls[0] as unknown as [string, { body: string; data: { url: string } }];
    expect(title).toBe("Контур · новое событие"); expect(options.body).not.toContain("Patient"); expect(options.data.url).toBe("/doctor?patient=patient1&event=event1");
    expect(h.fetch).toHaveBeenCalledWith("/api/push", expect.objectContaining({ body: JSON.stringify({ action: "shown", deliveryId: "delivery1" }) }));
  });
  it("rejects external and unrelated notification navigation", async () => {
    for (const url of ["https://evil.test/doctor", "/api/private", "javascript:alert(1)"]) { const h = harness(); await h.emit("notificationclick", { notification: { close: vi.fn(), data: { url } } }); expect(h.navigate).toHaveBeenCalledWith("/doctor"); }
  });
  it("uses distinct fixed workflow recommendations and ignores injected clinical text", async () => {
    const titles=new Set<string>();
    for(const kind of ["ROUTINE","REVIEW","HIGH","SAFETY"]) {
      const h=harness(); await h.emit("push",{data:{json:()=>({type:"kontur-event",deliveryId:"delivery1",url:"/doctor",kind,title:"Injected diagnosis",body:"Patient name, dose and diagnosis"})}});
      const [title,options]=h.show.mock.calls[0] as unknown as [string,{body:string}]; titles.add(title);
      expect(options.body).not.toContain("Patient"); expect(title).not.toContain("diagnosis");
      expect(options.body).toContain("кабинете");
      if(kind==="ROUTINE") expect(options.body).toContain("план");
      if(kind==="SAFETY") expect(options.body).toContain("контакту");
    }
    expect(titles.size).toBe(4);
    const h=harness(); await h.emit("push",{data:{json:()=>({type:"kontur-event",deliveryId:"delivery1",kind:"__proto__"})}}); expect(h.show).toHaveBeenCalledWith("Контур · новое событие",expect.any(Object));
  });
  it("opens the exact event in an existing window, or creates a window", async () => {
    const h = harness(); await h.emit("notificationclick", { notification: { close: vi.fn(), data: { url: "/doctor?patient=p1&event=e1" } } }); expect(h.navigate).toHaveBeenCalledWith("/doctor?patient=p1&event=e1"); expect(h.focus).toHaveBeenCalled();
    h.self.clients.matchAll.mockResolvedValue([]); await h.emit("notificationclick", { notification: { close: vi.fn(), data: { url: "/doctor?patient=p1&event=e1" } } }); expect(h.openWindow).toHaveBeenCalledWith("/doctor?patient=p1&event=e1");
  });
  it("still displays when the optional receipt cannot reach the server", async () => {
    const h = harness(); h.fetch.mockRejectedValue(new TypeError("offline")); await h.emit("push", { data: { json: () => ({ type: "kontur-test", deliveryId: "test1", url: "/doctor" }) } }); expect(h.show).toHaveBeenCalledWith("Контур · проверка уведомлений", expect.any(Object));
  });
  it("handles corrupt payloads without displaying untrusted text or reporting a delivery", async () => {
    const h = harness(); await h.emit("push", { data: { json: () => { throw new Error("invalid"); } } }); expect(h.show).toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled();
    expect(worker).not.toMatch(/addEventListener\(["']fetch/);
  });
});

it("shows the appointment date and Moscow time using fixed copy",async()=>{
 const h=harness();await h.emit("push",{data:{json:()=>({type:"kontur-appointment",deliveryId:"visit1",url:"/patient",appointmentAt:"2026-11-05T12:30:00Z",appointmentHasTime:true,body:"private diagnosis"})}});
 expect(h.show).toHaveBeenCalledWith("Контур · назначен приём",expect.objectContaining({body:expect.stringContaining("15:30"),data:{url:"/patient"}}));
 expect(JSON.stringify(h.show.mock.calls)).not.toContain("private diagnosis");
 const cancelled=harness();await cancelled.emit("push",{data:{json:()=>({type:"kontur-appointment-cancelled",deliveryId:"visit2",url:"/patient"})}});
 expect(cancelled.show).toHaveBeenCalledWith("Контур · приём отменён",expect.anything());
});

it("shows a fixed appointment reminder with the agreed Moscow time",async()=>{
 const h=harness();await h.emit("push",{data:{json:()=>({type:"kontur-appointment-reminder",deliveryId:"visit3",url:"/patient",appointmentAt:"2026-11-05T12:30:00Z",appointmentHasTime:true})}});
 expect(h.show).toHaveBeenCalledWith("Контур · скоро приём",expect.objectContaining({body:expect.stringContaining("15:30")}));
});
