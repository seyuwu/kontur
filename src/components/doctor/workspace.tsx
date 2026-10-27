"use client";
import type { DocumentDraft } from "@/components/clinical-profile/source-import";
import type { ReferralCache } from "@/components/follow-up/referrals";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { UsersRound, MessageSquare, Bell, Plus, ChevronRight, CircleHelp, LogOut, CircleCheck, RefreshCw, Link2, Copy, Printer, Check, FileText, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { PushSettings } from "./push-settings";
import { Brand } from "@/components/ui/brand";
import { Avatar, Badge, Button, Drawer } from "@/components/ui/primitives";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useCareResource } from "@/components/assessments/use-care-resource";
import { command, signOut } from "@/lib/client";
import { dateLabel } from "@/lib/format";
import type { PatientTab, ObservationData, PatientData } from "@/lib/types";
import { directoryUrl, type DirectoryData, type DirectoryQuery, type PatientDetailData } from "@/lib/patients";
import { PatientList, type Filter } from "./patient-list";
import { PatientDetail } from "./patient-detail";
import { ReviewInbox, type ReviewDraft } from "@/components/assessments/review-inbox";
import type { CareEditorDraft } from "@/components/care/doctor-care-plan";
import { canonicalProfile } from "@/modules/clinical-profile/contract";
import type { ProfileDraft } from "@/components/clinical-profile/clinical-profile";

const validTabs = ["overview", "data", "dynamics", "messages"];
type Invitation = { code: string; url: string; expiresAt: string };
export function DoctorWorkspace({ initialData, initialQuery, initialPatient, initialPatientId, initialTab, initialNotice }: { initialData: DirectoryData; initialQuery: DirectoryQuery; initialPatient?: PatientData; initialPatientId?: string; initialTab?: string; initialNotice?: string }) {
  const ready = useHydrated();
  const [selectedId, setSelectedId] = useState(initialPatientId ?? "");
  const [tab, setTab] = useState<PatientTab>(validTabs.includes(initialTab ?? "") ? initialTab as PatientTab : "overview");
  const [filter, setFilter] = useState<Filter>(initialQuery.filter); const [search, setSearch] = useState(initialQuery.q);
  const [debouncedSearch, setDebouncedSearch] = useState(initialQuery.q);
  const [cursor, setCursor] = useState(initialQuery.cursor);
  const searching = search.trim() !== debouncedSearch.trim();
  const directory = useCareResource<DirectoryData>(directoryUrl({ q: debouncedSearch, filter, cursor }), !searching, { url: directoryUrl(initialQuery), data: initialData });
  const detail = useCareResource<PatientDetailData>(`/api/patients/${encodeURIComponent(selectedId)}`, !!selectedId, initialPatient ? { url: `/api/patients/${encodeURIComponent(initialPatient.id)}`, data: { patient: initialPatient } } : undefined);
  const [lastDirectory, setLastDirectory] = useState(initialData);
  useEffect(() => { if (directory.data) setLastDirectory(directory.data); }, [directory.data]);
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  const data = directory.data ?? lastDirectory;
  const connectionError = directory.error || (selectedId && detail.error);
  const refresh = useCallback(async () => { await Promise.all([directory.refresh(), detail.refresh()]); }, [directory.refresh, detail.refresh]);
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({});
  const [careDrafts, setCareDrafts] = useState<Record<string, CareEditorDraft | undefined>>({});
  const [profileDrafts, setProfileDrafts] = useState<Record<string, ProfileDraft | undefined>>({});
  const careDirty = Object.values(careDrafts).some(d => d && JSON.stringify(d.content) !== d.baseline) || Object.values(profileDrafts).some(d => d && JSON.stringify(canonicalProfile(d.content)) !== d.baseline);
  useEffect(() => { if (!careDirty) return; const warn = (e: BeforeUnloadEvent) => e.preventDefault(); window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [careDirty]);
  const [documentDrafts, setDocumentDrafts] = useState<Record<string, DocumentDraft | undefined>>({});
  const [referralCaches, setReferralCaches] = useState<Record<string, ReferralCache | undefined>>({});
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const reviewPanel = (patientId?: string, embedded = false) => <ReviewInbox embedded={embedded} key={patientId ?? "all"} patientId={patientId} active={!!patientId || (!search.trim() && (filter === "all" || filter === "attention"))} showEmpty={filter === "attention"} drafts={reviewDrafts} onDraft={(id, value) => setReviewDrafts(current => ({ ...current, [id]: value }))} onConversation={id => navigate(id, "messages")} onPatientData={id => navigate(id, "data")} />;
  const [panel, setPanel] = useState<"" | "new" | "invite" | "note" | "source" | "help">("");
  const [source, setSource] = useState<ObservationData | null>(null);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [toast, setToast] = useState(initialNotice ?? "");
  const [newName, setNewName] = useState(""); const [newBirthDate, setNewBirthDate] = useState("");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, { note: string }>>({});
  const listScroll = useRef(0);
  const patient = selectedId ? detail.data?.patient : undefined;
  const invitationGeneration = useRef(0);
  const availablePatient = useRef(patient?.id); availablePatient.current = patient?.id;
  const boundPanel = panel === "invite" || panel === "source" || panel === "note";
  useEffect(() => {
    if (patient?.id) return;
    invitationGeneration.current++; setSource(null); setInvitation(null);
    setPanel(current => current === "invite" || current === "source" || current === "note" ? "" : current);
    if (panel === "invite") setBusy(false);
  }, [selectedId, patient?.id]);
  const noteDraft = patient ? noteDrafts[patient.id] ?? { note: patient.note } : { note: "" };
  const { note } = noteDraft;
  const setNote = (value: string) => { if (patient) setNoteDrafts(current => ({ ...current, [patient.id]: { ...noteDraft, note: value } })); };
  function discardNote() { if (patient) setNoteDrafts(current => { const next = { ...current }; delete next[patient.id]; return next; }); }
  const attentionCount = data.counts.attention;
  const messageCount = data.counts.unreadMessages;
  const doctorShort = `${data.actor.name.split(" ")[0]} ${data.actor.name.split(" ").at(-1)}`;
  useEffect(() => { const pop = () => { const params = new URLSearchParams(window.location.search); setPanel(""); setSelectedId(params.get("patient") ?? ""); const t = params.get("tab"); setTab(validTabs.includes(t ?? "") ? t as PatientTab : "overview"); const q = (params.get("q") ?? "").slice(0, 120); setSearch(q); setDebouncedSearch(q); const f = params.get("filter"); setFilter(["all", "attention", "pending", "messages"].includes(f ?? "") ? f as Filter : "all"); const nextCursor = params.get("cursor"); setCursor(nextCursor ?? undefined); }; window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 4200); return () => clearTimeout(timer); }, [toast]);
  function writeUrl(patientId: string, nextTab: PatientTab, query: DirectoryQuery, replace: boolean) {
    const params = new URLSearchParams(); if (query.q.trim()) params.set("q", query.q.trim()); if (query.filter !== "all") params.set("filter", query.filter); if (query.cursor) params.set("cursor", query.cursor);
    if (patientId) { params.set("patient", patientId); params.set("tab", nextTab); }
    window.history[replace ? "replaceState" : "pushState"]({}, "", `/doctor${params.size ? `?${params}` : ""}`);
  }
  function navigate(patientId: string, nextTab: PatientTab = "overview", replace = false) {
    const changingPatient = patientId !== selectedId;
    if (!selectedId && patientId) listScroll.current = window.scrollY;
    setSelectedId(patientId); setTab(nextTab); setPanel("");
    writeUrl(patientId, nextTab, { q: search, filter, cursor }, replace);
    if (changingPatient) requestAnimationFrame(() => {
      window.scrollTo({ top: patientId ? 0 : listScroll.current, behavior: "instant" });
      const title = document.querySelector<HTMLElement>("#main-content h1");
      title?.setAttribute("tabindex", "-1"); title?.focus({ preventScroll: true });
    });
  }
  function chooseFilter(value: Filter) { setFilter(value); setCursor(undefined); setSelectedId(""); setPanel(""); writeUrl("", "overview", { q: search, filter: value }, !!selectedId); }
  function chooseSearch(value: string) { const q = value.slice(0, 120); setSearch(q); setCursor(undefined); writeUrl("", "overview", { q, filter }, true); }
  function changePage(next?: string) { setCursor(next); writeUrl("", "overview", { q: search, filter, cursor: next }, true); }
  function openPanel(kind: typeof panel) { setError(""); setPanel(kind); }
  async function invite(patientId: string) {
    const generation = ++invitationGeneration.current;
    setInvitation(null); openPanel("invite"); setBusy(true);
    try { const result = await command<Invitation>({ action: "invite", patientId }); if (generation === invitationGeneration.current && availablePatient.current === patientId) setInvitation(result); }
    catch (e) { if (generation === invitationGeneration.current && availablePatient.current === patientId) setError((e as Error).message); } finally { if (generation === invitationGeneration.current) setBusy(false); }
  }
  function editNote() { if (!patient) return; if (!noteDrafts[patient.id]) setNoteDrafts(current => ({ ...current, [patient.id]: noteDraft })); openPanel("note"); }
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await command<{ id: string }>({ action: "create-patient", name: newName, birthDate: newBirthDate }); await refresh(); setNewName(""); setNewBirthDate(""); navigate(result.id); setToast("Карточка создана. Теперь можно подключить пациента."); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function saveNote(event: FormEvent) {
    event.preventDefault(); if (!patient) return; setBusy(true); setError("");
    try { await command({ action: "note", patientId: patient.id, note }); await refresh(); discardNote(); setPanel(""); setToast("Запись сохранена"); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function revokeInvite() { if (!patient || busy) return; setBusy(true); setError(""); try { await command({ action: "revoke-invite", patientId: patient.id }); setInvitation(null); setPanel(""); await refresh(); setToast("Приглашение отменено. Прежний код и QR больше не действуют."); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function acknowledge(observationId: string) { if (!patient) return; try { await command({ action: "acknowledge", patientId: patient.id, observationId }); await refresh(); setToast("Просмотр отмечен. Клиническое решение не изменено."); } catch (e) { setToast((e as Error).message); } }
  async function resolve(requestId: string, approve: boolean) { setBusy(true); try { await command({ action: "resolve-link", requestId, approve }); await refresh(); setToast(approve ? "Связь с пациентом подтверждена" : "Запрос отклонён"); } catch (e) { setToast((e as Error).message); } finally { setBusy(false); } }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setToast("Скопировано"); } catch { setError("Не удалось скопировать. Можно переписать код вручную."); } }
  const panelTitles = { new: "Новый пациент", invite: "Подключить пациента", note: "Заметка к приёму", source: "Исходный самоотчёт", help: "Как устроен Контур", "": "" };
  return <div className="app-shell" inert={!ready}><aside className="sidebar" aria-label="Навигация и профиль врача"><Brand /><p className="nav-label">Рабочее пространство</p><nav className="side-nav" aria-label="Основная навигация">
    <button className={`nav-button ${filter === "all" ? "is-active" : ""}`} onClick={() => chooseFilter("all")} aria-label="Все пациенты" title="Все пациенты"><UsersRound size={18} /><span>Пациенты</span></button>
    <button className={`nav-button ${filter === "attention" ? "is-active" : ""}`} onClick={() => chooseFilter("attention")} title="Требуют внимания"><Bell size={18} /><span>Требуют внимания</span>{attentionCount > 0 && <span className="nav-count">{attentionCount}</span>}</button>
    <button className={`nav-button ${filter === "messages" ? "is-active" : ""}`} onClick={() => chooseFilter("messages")} title="Новые сообщения"><MessageSquare size={18} /><span>Сообщения</span>{messageCount > 0 && <span className="nav-count">{messageCount}</span>}</button>
  </nav><div className="sidebar-bottom"><div className="sidebar-profile"><Avatar name={data.actor.name} size="small" /><div className="sidebar-profile-text"><strong>{doctorShort}</strong><span>{data.actor.specialty}</span></div><button className="icon-button" aria-label="Выйти из аккаунта" onClick={() => void signOut().catch(e => setToast(e.message))}><LogOut size={15} /></button></div></div></aside>
    <div className="app-content"><header className="topbar"><div className="mobile-brand"><Brand compact /></div><div className="breadcrumb"><span>Рабочее пространство</span><ChevronRight size={12} /><span>{selectedId ? "Карточка пациента" : "Пациенты"}</span></div><div className="topbar-actions"><span className="topbar-date">{dateLabel(new Date().toISOString(), { weekday: "long", month: "long" })}</span><PushSettings /><button className="icon-button" aria-label="Помощь" onClick={() => openPanel("help")}><CircleHelp size={18} /></button><button className="icon-button mobile-menu-button" aria-label="Выйти из аккаунта" onClick={() => void signOut().catch(e => setToast(e.message))}><LogOut size={17} /></button></div></header>
    {connectionError && <div className="connection-error" role="status"><RefreshCw size={15} />{connectionError}<button className="text-link" onClick={() => void refresh()}>Повторить</button></div>}
    <main id="main-content" className="page">{!selectedId ? <><div className="page-heading"><div><div className="heading-title"><h1>{filter === "messages" ? "Новые сообщения" : "Пациенты"}</h1>{data.counts.contactRequests > 0 && <Badge tone="amber">{data.counts.contactRequests} просят связаться</Badge>}</div><p>Всё важное для внимательного сопровождения</p></div><Button aria-label="Добавить пациента" onClick={() => openPanel("new")}><Plus size={16} />Добавить пациента</Button></div>
      {data.linkRequests.length > 0 && <section className="requests-box"><h2>Запросы на подключение</h2><p className="secondary-text small-text">Проверьте личность пациента перед подтверждением.</p>{data.linkRequests.map(request => <div className="request-row" key={request.id}><div><strong>{request.user.name}</strong><p>{request.user.email} → {request.invitation.patient.name}, {request.invitation.patient.publicId}</p></div><div className="request-actions"><Button variant="secondary" disabled={busy} onClick={() => void resolve(request.id, false)}>Отклонить</Button><Button disabled={busy} onClick={() => void resolve(request.id, true)}><Check size={14} />Подтвердить</Button></div></div>)}</section>}
      <PatientList reviewInbox={reviewPanel(undefined, true)} patients={searching ? [] : directory.data?.patients ?? []} filter={filter} search={search} upcoming={data.upcoming} matchedTotal={directory.data?.matchedTotal ?? 0} total={data.counts.all} loading={searching || (!directory.data && directory.loading)} error={directory.error} nextCursor={directory.data?.nextCursor} page={directory.data?.page ?? lastDirectory.page} setFilter={chooseFilter} setSearch={chooseSearch} onNext={next => changePage(next)} onPrevious={() => changePage(directory.data?.previousCursor ?? undefined)} onReset={() => changePage()} onRetry={() => void directory.refresh()} onSelect={(p, messages) => navigate(p.id, messages ? "messages" : "overview")} />
    </> : !patient ? <section className="surface directory-message"><button className="back-link" onClick={() => navigate("")}>К списку пациентов</button><h1>{detail.error ? "Карточка недоступна" : "Открываем карточку…"}</h1>{detail.error && <><p role="alert">{detail.error}</p><Button variant="secondary" onClick={() => void detail.refresh()}>Повторить загрузку</Button></>}</section> : <PatientDetail documentDraft={documentDrafts[patient.id]} onDocumentDraft={value => setDocumentDrafts(old => ({ ...old, [patient.id]: value }))} referralCache={referralCaches[patient.id]} onReferralCache={value => setReferralCaches(old => ({ ...old, [patient.id]: value }))} profileDraft={profileDrafts[patient.id]} onProfileDraft={value => setProfileDrafts(old => ({ ...old, [patient.id]: value }))} careDraft={careDrafts[patient.id]} onCareDraft={value => setCareDrafts(old => ({ ...old, [patient.id]: value }))} reviewPanel={reviewPanel(patient.id)} patient={patient} tab={tab} actorId={data.actor.id} onTab={value => navigate(patient.id, value, true)} onBack={() => navigate("")} onInvite={() => void invite(patient.id)} onNote={editNote} onSource={observation => { setSource(observation); openPanel("source"); }} onAcknowledge={id => void acknowledge(id)} refresh={refresh} onSuccess={setToast} messageDraft={messageDrafts[patient.id] ?? ""} onMessageDraft={text => setMessageDrafts(current => ({ ...current, [patient.id]: text }))} />}</main></div>
    <Drawer open={!!panel && (!boundPanel || !!patient)} title={panelTitles[panel]} dismissDisabled={busy} description={panel === "invite" || panel === "note" || panel === "source" ? patient?.name : undefined} onClose={() => { if (!busy) setPanel(""); }}>
      {error && <div className="form-error" role="alert">{error}</div>}
      {panel === "new" && <form onSubmit={create}><label className="field"><span>Имя и фамилия</span><input autoComplete="name" placeholder="Например, Анна Ковалёва" disabled={busy} value={newName} onChange={e => setNewName(e.target.value)} required minLength={2} maxLength={120} /></label><label className="field"><span>Дата рождения</span><input type="date" disabled={busy} value={newBirthDate} onChange={e => setNewBirthDate(e.target.value)} required max={new Date().toISOString().slice(0, 10)} /></label><div className="hint">Сначала создадим карточку. Остальные сведения можно добавить позже, а пациента подключить прямо на приёме.</div><div className="form-footer"><Button variant="secondary" onClick={() => setPanel("")} disabled={busy}>Отмена</Button><Button type="submit" busy={busy}>Создать карточку</Button></div></form>}
      {panel === "invite" && patient && <>{!invitation && !error && <p className="secondary-text">Создаём одноразовое приглашение…</p>}{invitation && <><p className="secondary-text small-text">Передайте пациенту QR или код, затем подтвердите его запрос.</p><div className="qr-box"><QRCodeSVG value={invitation.url} size={190} level="M" marginSize={2} title="Приглашение в кабинет пациента" /></div><p className="invite-caption">Код для ввода вручную</p><div className="invite-code">{invitation.code.slice(0, 3)} {invitation.code.slice(3)}</div><p className="invite-caption">Действует до {dateLabel(invitation.expiresAt, { hour: "2-digit", minute: "2-digit" })}</p><div className="invite-actions"><Button variant="secondary" onClick={() => void copy(invitation.code)}><Copy size={14} />Код</Button><Button variant="secondary" onClick={() => void copy(invitation.url)}><Link2 size={14} />Ссылка</Button><Button variant="secondary" onClick={() => window.print()}><Printer size={14} />Печать</Button></div><div className="hint">{/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?\//i.test(invitation.url) ? "QR ведёт на localhost и не откроется на другом устройстве. Для телефона нужен доступный адрес сайта." : "Для QR-кода сайт должен открываться на телефоне пациента."}</div><div className="form-footer"><Button variant="quiet" busy={busy} onClick={() => patient && void invite(patient.id)}>Выпустить новый код</Button><Button variant="quiet" disabled={busy} onClick={() => void revokeInvite()}>Отменить приглашение</Button></div></>}</>}
      {panel === "note" && patient && <form onSubmit={saveNote}><label className="field"><span>Что обсудить с пациентом</span><textarea disabled={busy} value={note} onChange={e => setNote(e.target.value)} maxLength={6000} rows={7} placeholder="Вопросы и контекст к следующему контакту" /></label><div className="hint">Несохранённая заметка пропадёт после перезагрузки.</div><div className="form-footer"><Button variant="quiet" onClick={discardNote} disabled={busy}>Сбросить изменения</Button><Button type="submit" busy={busy}>Сохранить запись</Button></div></form>}
      {panel === "source" && patient && source && <><Badge tone="green">Сообщил пациент</Badge><p className="source-quote">{source.note || "Просьба о контакте без комментария"}</p><dl className="source-meta"><dt>Поступило</dt><dd>{dateLabel(source.createdAt, { year: "numeric", hour: "2-digit", minute: "2-digit" })}</dd><dt>Просьба связаться</dt><dd>{source.needsContact ? "Да" : "Не отмечена"}</dd></dl><p className="hint" style={{ marginTop: 25 }}>Это личный самоотчёт. Он не устанавливает диагноз и не заменяет клиническую оценку.</p></>}
      {panel === "help" && <div className="help-text"><h3>Начните со списка</h3><p>Найдите пациента по имени или номеру карты. Фильтры показывают просьбы о контакте, новые сообщения и неподключённых пациентов.</p><h3>Подключите на приёме</h3><p>Откройте карточку и покажите QR или код. Проверьте личность человека, запросившего связь, и подтвердите запрос в списке пациентов.</p><h3>Сохраняйте контекст</h3><p>В карточке пациента назначайте анкеты и лечение. Результаты, данные и переписка доступны в своих разделах.</p><h3>Что работает в этой версии</h3><p>Подключение пациента, анкеты, назначение лечения, обобщения и переписка. Экстренная доставка не предусмотрена.</p>{data.demo && <><h3>Данные</h3><p>Используйте только вымышленные данные.</p></>}</div>}
    </Drawer>{toast && <div className="toast" role="status"><CircleCheck size={17} /><span>{toast}</span><button className="icon-button" aria-label="Закрыть сообщение" onClick={() => setToast("")}><X size={15} /></button></div>}
  </div>;
}
