"use client";
import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import Link from "next/link";
import { Link2, CircleCheck } from "lucide-react";
import { Brand } from "@/components/ui/brand";
import { Button } from "@/components/ui/primitives";
import { command } from "@/lib/client";
import { useHydrated } from "@/components/ui/use-hydrated";

const validInvitation = (value: string) => /^(?:[a-f0-9]{64}|\d{6})$/.test(value);
const invitationKey = "kontur:invitation";

export function ConnectForm({ loggedIn, pending, linkedDoctorName }: { loggedIn: boolean; pending: boolean; linkedDoctorName?: string }) {
  const ready = useHydrated();
  const [secret, setSecret] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [sent, setSent] = useState(pending); const [doctorName, setDoctorName] = useState("");
  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (linkedDoctorName) {
      if (fromHash) history.replaceState(null, "", "/connect");
      try { sessionStorage.removeItem(invitationKey); } catch { /* Storage can be disabled. */ }
      return;
    }
    if (validInvitation(fromHash)) {
      try { sessionStorage.setItem(invitationKey, JSON.stringify({ secret: fromHash, expires: Date.now() + 24 * 3600000 })); } catch { /* The field still works in this tab. */ }
      history.replaceState(null, "", "/connect"); setSecret(fromHash);
    } else {
      try { const stored = JSON.parse(sessionStorage.getItem(invitationKey) ?? "null"); if (stored?.expires > Date.now() && typeof stored.secret === "string" && validInvitation(stored.secret)) setSecret(stored.secret); else sessionStorage.removeItem(invitationKey); } catch { /* The code can still be entered manually. */ }
    }
  }, [linkedDoctorName]);
  function rememberInvitation(event: MouseEvent<HTMLAnchorElement>) {
    if (secret && !validInvitation(secret)) { event.preventDefault(); setError("Введите шесть цифр кода или оставьте поле пустым."); return; }
    if (!secret) return;
    try { sessionStorage.setItem(invitationKey, JSON.stringify({ secret, expires: Date.now() + 24 * 3600000 })); }
    catch { event.preventDefault(); setError("Не удалось сохранить код. Разрешите хранение данных в браузере или войдите и введите его после входа."); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!ready || busy || !loggedIn) return; setBusy(true); setError("");
    try { const result = await command<{ doctorName: string }>({ action: "request-link", secret: secret.replace(/\s/g, "") }); setDoctorName(result.doctorName); setSent(true); try { sessionStorage.removeItem(invitationKey); } catch { /* The request is already saved. */ } }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const qrInvitation = /^[a-f0-9]{64}$/.test(secret);
  return <main id="main-content" className="connect-page" inert={!ready}><section className="connect-surface"><Brand compact />
    {linkedDoctorName ? <div className="connection-success"><CircleCheck size={37} strokeWidth={1.5} /><h1>Вы уже подключены к врачу</h1><p>Ваш врач — {linkedDoctorName}. Для подключения к другому врачу нужен отдельный аккаунт или согласование изменения связи.</p><Link className="button button-primary" href="/patient">Вернуться в кабинет</Link></div>
      : sent ? <div className="connection-success"><CircleCheck size={37} strokeWidth={1.5} /><h2>Запрос отправлен</h2><p>{doctorName ? `Врач ${doctorName} проверит подключение.` : "Врач проверит подключение."} Пока запрос не подтверждён, медицинские данные закрыты.</p><Link className="button button-primary" href="/patient">Перейти в кабинет</Link></div>
      : <><h1>Подключиться к врачу</h1><p>Введите код из приглашения. После запроса врач подтвердит связь.</p>{error && <div className="form-error" role="alert">{error}</div>}
        <form method="post" onSubmit={submit}><label className="field"><span>{qrInvitation ? "Приглашение из QR-кода" : "Код приглашения"}</span><input aria-label={qrInvitation ? "Приглашение из QR-кода" : "Код приглашения"} aria-describedby="invite-hint" className={qrInvitation ? "" : "connect-input"} type={qrInvitation ? "password" : "text"} inputMode={qrInvitation ? "text" : "numeric"} autoComplete="off" disabled={!ready || busy} value={secret} maxLength={64} onChange={e => { setSecret(e.target.value.replace(/\s/g, "")); setError(""); }} placeholder="000000" required={loggedIn} /><small id="invite-hint">Код состоит из шести цифр. QR заполняет приглашение автоматически.</small></label>
          {loggedIn ? <Button type="submit" className="button-wide" disabled={!ready} busy={busy}><Link2 size={16} />Запросить подключение</Button> : <><p className="hint">Войдите или создайте аккаунт пациента. Код сохранится в этой вкладке.</p><Link className="button button-primary button-wide" href="/login?next=/connect" onClick={rememberInvitation}>Войти в аккаунт</Link><p className="login-bottom">Первый раз здесь? <Link className="text-link" href="/register" onClick={rememberInvitation}>Создать аккаунт</Link></p></>}
        </form></>}
  </section></main>;
}
