"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowUpRight, Stethoscope, UserRound, Brain, ShieldCheck, MessageSquare, ListChecks } from "lucide-react";
import { Brand } from "@/components/ui/brand";
import { loginReturn } from "@/lib/login-return";
import { Button } from "@/components/ui/primitives";
import { useHydrated } from "@/components/ui/use-hydrated";

export function LoginForm({ demoPassword }: { demoPassword?: string }) {
  const ready = useHydrated();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function login(loginEmail = email, loginPassword = password) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: loginEmail, password: loginPassword }) });
      if (!response.ok) { setError(response.status === 429 ? "Слишком много попыток. Подождите немного." : "Не удалось войти. Проверьте почту и пароль."); return; }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.assign(loginReturn(next));
    } catch { setError("Не удалось связаться с сервером. Попробуйте ещё раз."); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void login(); }
  return <main id="main-content" className="login-layout" inert={!ready}><section className="login-intro"><div><Brand /><h1>Внимание к человеку.<br /><span>Ясность в работе.</span></h1><p>Анкеты, назначения и общение врача с пациентом.</p><div className="login-principles"><div className="login-principle"><ListChecks size={19} />Важные изменения перед глазами</div><div className="login-principle"><MessageSquare size={19} />Связь между контактами</div><div className="login-principle"><ShieldCheck size={19} />Каждому — только свои данные</div></div></div><p className="login-legal">Контур помогает организовать сопровождение. Клинические решения остаются за врачом.</p></section>
    <section className="login-form-side"><div className="login-form"><h2>Войти в Контур</h2>{error && <p className="form-error" role="alert">{error}</p>}<form method="post" onSubmit={submit}><label className="field"><span>Электронная почта</span><input type="email" autoComplete="email" disabled={!ready || busy} value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.ru" required /></label><label className="field"><span>Пароль</span><input type="password" autoComplete="current-password" disabled={!ready || busy} value={password} onChange={e => setPassword(e.target.value)} placeholder="Введите пароль" required /></label><Button className="button-wide" type="submit" disabled={!ready} busy={busy}>Войти</Button></form>
    {demoPassword && <div className="demo-accounts"><p>Быстрый вход</p>{[
      { email: "doctor@kontur.demo", title: "Кабинет терапевта", icon: Stethoscope },
      { email: "psychiatrist@kontur.demo", title: "Кабинет психиатра", icon: Brain },
      { email: "patient@kontur.demo", title: "Кабинет пациента", icon: UserRound }
    ].map(account => <button key={account.email} type="button" className="demo-account" disabled={!ready || busy} onClick={() => void login(account.email, demoPassword)}><account.icon size={18} /><span><strong>{account.title}</strong></span><ArrowUpRight size={15} /></button>)}</div>}
    <p className="login-bottom">Первый раз здесь? <Link className="text-link" href="/register">Создать аккаунт</Link></p><p className="login-bottom"><Link className="text-link" href="/connect">У меня есть код от врача</Link></p></div></section></main>;
}
