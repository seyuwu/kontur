"use client";
import { useEffect, useRef, useState } from "react";
import { BellRing, Smartphone } from "lucide-react";
import { Badge, Button, Drawer } from "@/components/ui/primitives";
import { useCareResource } from "@/components/assessments/use-care-resource";
import { apiCommand } from "@/lib/client";
import { pushLabels, pushSupportIssue, type PushSettingsData } from "@/lib/push";

function bytes(key: string) { return Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - key.length % 4) % 4)), c => c.charCodeAt(0)); }
async function endpointHash(endpoint: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint))), b => b.toString(16).padStart(2, "0")).join(""); }
function sameKey(subscription: PushSubscription, key: string) {
  const value = subscription.options.applicationServerKey;
  return value && Array.from(new Uint8Array(value)).join(",") === Array.from(bytes(key)).join(",");
}
async function registration() {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  if (reg.active) return reg;
  await new Promise<void>((resolve, reject) => {
    const worker = reg.installing ?? reg.waiting; if (!worker) { reject(new Error("Не удалось подготовить уведомления. Обновите страницу и повторите.")); return; }
    const done = () => { if (worker.state === "activated") { clearTimeout(timer); worker.removeEventListener("statechange", done); resolve(); } };
    const timer = setTimeout(() => { worker.removeEventListener("statechange", done); reject(new Error("Браузер не подготовил уведомления. Обновите страницу и повторите.")); }, 15000);
    worker.addEventListener("statechange", done); done();
  }); return reg;
}
export function PushSettings({ audience = "doctor" }: { audience?: "doctor" | "patient" } = {}) {
  const [open, setOpen] = useState(false); const resource = useCareResource<PushSettingsData>("/api/push", open);
  const [supported, setSupported] = useState(false), [ios, setIos] = useState(false), [standalone, setStandalone] = useState(false);
  const [supportIssue, setSupportIssue] = useState("");
  const [permission, setPermission] = useState<NotificationPermission>("default"); const [hash, setHash] = useState("");
  const [label, setLabel] = useState("Это устройство"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const guard = useRef(false), testKey = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const support = window.isSecureContext && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
    setSupported(support); setPermission("Notification" in window ? Notification.permission : "default");
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    setStandalone(matchMedia("(display-mode: standalone)").matches || !!(navigator as Navigator & { standalone?: boolean }).standalone);
    setSupportIssue(pushSupportIssue({ secure: window.isSecureContext, notifications: "Notification" in window, serviceWorker: "serviceWorker" in navigator, pushManager: "PushManager" in window, ios: /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1), standalone: matchMedia("(display-mode: standalone)").matches || !!(navigator as Navigator & { standalone?: boolean }).standalone }));
    let cancelled = false;
    if (support) void navigator.serviceWorker.getRegistration("/").then(async reg => { if (reg) await reg.update().catch(() => {}); const sub = await reg?.pushManager.getSubscription(); const h = sub ? await endpointHash(sub.endpoint) : ""; if (!cancelled) setHash(h); }).catch(() => { if (!cancelled) setError("Не удалось прочитать подписку браузера. Обновите страницу и повторите."); });
    return () => { cancelled = true; };
  }, [open]);
  const current = resource.data?.devices.find(d => d.endpointHash === hash);
  const connected = !!current && current.currentSession && current.sessionActive && current.keyCurrent;
  async function run(task: () => Promise<void>) { if (guard.current) return; guard.current = true; setBusy(true); setError(""); setNotice(""); try { await task(); } catch (e) { setError((e as Error).message || "Браузер не подключил уведомления. Проверьте разрешение и повторите."); } finally { guard.current = false; setBusy(false); } }
  function connect() {
    if (!resource.data?.enabled || !supported) return;
    void run(async () => {
      // First awaited browser call follows the user's click, including Safari.
      const granted = await Notification.requestPermission(); setPermission(granted);
      if (granted !== "granted") { setNotice(granted === "denied" ? "Уведомления заблокированы. Разрешите их в настройках сайта в браузере." : "Разрешение не выдано. Можно подключить уведомления позже."); return; }
      const reg = await registration(); let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub, resource.data!.publicKey)) { await sub.unsubscribe(); sub = null; }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(resource.data!.publicKey) });
      await apiCommand("/api/push", { action: "connect", label: label.trim() || "Это устройство", subscription: sub.toJSON() });
      setHash(await endpointHash(sub.endpoint)); await resource.refresh(); setNotice("Устройство подключено. Отправьте проверку и убедитесь, что уведомление появилось.");
    });
  }
  function disconnect(id: string) { void run(async () => {
    await apiCommand("/api/push", { action: "disconnect", deviceId: id });
    if (current?.id === id) {
      try { const reg = await navigator.serviceWorker.getRegistration("/"); await (await reg?.pushManager.getSubscription())?.unsubscribe(); (await reg?.getNotifications())?.forEach(n => n.close()); } catch { /* server is already disabled */ }
      setHash("");
    }
    await resource.refresh(); setNotice("Уведомления на устройстве отключены.");
  }); }
  function testNotification() { if (!current) return; void run(async () => { testKey.current ??= crypto.randomUUID(); await apiCommand("/api/push", { action: "test", deviceId: current.id, requestKey: testKey.current }); testKey.current = null; await resource.refresh(); setNotice("Проверка в очереди. Дождитесь уведомления на устройстве; статус передачи обновится здесь."); }); }
  function testDisplay() { void run(async () => {
    const granted = await Notification.requestPermission(); setPermission(granted);
    if (granted !== "granted") throw new Error("Разрешите уведомления для этого сайта в настройках браузера.");
    const reg = await registration();
    await reg.showNotification("Контур · проверка показа", { body: "Браузер получил команду показать уведомление. Это локальная проверка без сервера доставки.", tag: "kontur-local-test", icon: "/icons/icon-192.png" });
    setNotice("Команда показа выполнена. Проверьте центр уведомлений Windows и режим «Не беспокоить». Доставка через сервер проверяется отдельно кнопкой «Отправить проверку».");
  }); }
  return <>
    <button className="icon-button" aria-label="Настроить push-уведомления" title="Уведомления на устройстве" onClick={() => { setError(""); setNotice(""); setOpen(true); }}><Smartphone size={18} /></button>
    <Drawer open={open} title="Уведомления на устройстве" onClose={() => setOpen(false)} dismissDisabled={busy}>
      <p className="secondary-text">{audience === "patient" ? "Получайте уведомления о новых анкетах и сроке заполнения. Нажатие открывает назначенную анкету." : "Получайте результаты заполненных анкет с рекомендациями и просьбы пациентов связаться."}</p>
      
      {resource.data?.enabled && resource.data.workerReady === false && <p className="hint">Фоновый обработчик не отвечает. Локальный показ можно проверить, но серверная доставка будет ждать запуска npm run worker.</p>}
      {supportIssue && <p className="help-text" role="status">{supportIssue}</p>}
      {supported && !(ios && !standalone) && <div className="push-actions"><Button variant="secondary" disabled={busy} onClick={testDisplay}>Проверить показ на ПК</Button></div>}
      {resource.error && <div className="form-error" role="alert">{resource.error}<Button variant="quiet" onClick={() => void resource.refresh()}>Повторить загрузку</Button></div>}
      {!resource.data && !resource.error && <p role="status">Загружаем настройки…</p>}
      {resource.data && <section className="push-current" aria-labelledby="push-current-heading">
        <div className="push-heading"><h3 id="push-current-heading">Это устройство</h3><Badge tone={connected && permission === "granted" ? "green" : "neutral"}>{connected && permission === "granted" ? "Подключено" : "Не подключено"}</Badge></div>
        {!resource.data.enabled ? <p className="hint">Push-канал на сервере отключён или не настроен. Новые события доступны в кабинете.</p> : !supported || (ios && !standalone) ? null : <>
          {permission === "denied" ? <p className="hint">Браузер заблокировал уведомления. В настройках этого сайта разрешите уведомления и откройте эту панель снова.</p> : !connected ? <><label className="field"><span>Название устройства</span><input value={label} onChange={e => setLabel(e.target.value)} maxLength={60} disabled={busy} autoComplete="off" /></label><Button busy={busy} disabled={resource.loading || !label.trim()} onClick={connect}><BellRing size={16} />Подключить уведомления</Button></> : <div className="push-actions"><Button disabled={busy || resource.loading} onClick={testNotification}><BellRing size={16} />Отправить проверку</Button></div>}
          {current && !connected && <p className="hint">Подключите устройство заново после выхода из аккаунта.</p>}
        </>}
        
      </section>}
      {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="hint" role="status">{notice}</p>}
      {!!resource.data?.devices.length && <section className="push-devices" aria-labelledby="push-devices-heading"><h3 id="push-devices-heading">Подключённые устройства</h3><ul>{resource.data.devices.map(device => <li key={device.id}><div><strong>{device.label}{device.id === current?.id ? " · текущее" : ""}</strong><p className="secondary-text small-text">{!device.sessionActive || !device.keyCurrent ? "Требуется подключить заново" : device.lastDelivery ? `${device.lastDelivery.test ? "Проверка: " : "Последняя отправка: "}${pushLabels[device.lastDelivery.status] ?? "Обновите состояние"}` : "Уведомлений пока не было"}</p></div><Button variant="quiet" disabled={busy} aria-label={`Отключить устройство ${device.label}`} onClick={() => disconnect(device.id)}>Отключить</Button></li>)}</ul></section>}
      <details className="assessment-source push-help"><summary>Как доставляются уведомления</summary><p className="secondary-text small-text">На экране блокировки нет имени пациента и медицинских данных. Системные настройки и режим «Не беспокоить» могут задерживать показ. Принятие push-сервисом и сообщение браузера о показе не подтверждают прочтение и реакцию врача. Для срочных ситуаций нужен согласованный порядок связи с клиникой.</p></details>
    </Drawer>
  </>;
}
