"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Plus, Trash2 } from "lucide-react";
import type { ProfileContent, ProfileHistory, ProfileWorkspace } from "@/lib/clinical-profile";
import { canonicalProfile, categoryNames, emptyProfile, evidenceNames, intakeNames, profileContentSchema, statusNames, type Evidence, type ProfileCategory } from "@/modules/clinical-profile/contract";
import { apiCommand } from "@/lib/client";
import { dateLabel } from "@/lib/format";
import { Button, Drawer } from "@/components/ui/primitives";
import { useCareResource } from "@/components/assessments/use-care-resource";
import { SourceImport, type DocumentDraft } from "./source-import";
import { ProfileContentView } from "./profile-content";
import { ProfileSummary } from "./profile-summary";

export type ProfileDraft = { content: ProfileContent; expectedVersion: number; baseline: string; requestKey: string | null };
const categories: ProfileCategory[] = ["conditions", "allergies", "medications"];
type BaseItem = ProfileContent["conditions"]["items"][number];
type Medication = ProfileContent["medications"]["items"][number];
export function ClinicalProfileSection({ patientId, patientName, active, compact, draft, onDraft, onSaved, requestedVersion, onRequestHandled, documentDraft, onDocumentDraft }: {
  documentDraft?: DocumentDraft; onDocumentDraft: (v: DocumentDraft | undefined) => void;
  patientId: string; patientName: string; active: boolean; compact: boolean; draft?: ProfileDraft; onDraft: (value: ProfileDraft | undefined) => void; onSaved: () => Promise<void>; requestedVersion?: string; onRequestHandled: () => void;
}) {
  const base = `/api/clinical-profile?patientId=${encodeURIComponent(patientId)}`;
  const current = useCareResource<ProfileWorkspace>(base, active);
  const [panel, setPanel] = useState<"" | "view" | "edit" | "history" | "version">(""); const [category, setCategory] = useState<ProfileCategory>("conditions");
  const [versionId, setVersionId] = useState(""); const [cursor, setCursor] = useState<string>();
  const history = useCareResource<ProfileHistory>(`${base}&view=history${cursor ? `&cursor=${cursor}` : ""}`, panel === "history" && active && !!current.data);
  const version = useCareResource<ProfileWorkspace>(`${base}&versionId=${encodeURIComponent(versionId)}`, panel === "version" && active && !!current.data && !!versionId);
  const [busy, setBusy] = useState(false); const [reviewed, setReviewed] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [documentRequested, setDocumentRequested] = useState(false);
  const epoch = useRef(0);
  useEffect(() => { if (!active) setPanel(""); }, [active]);
  useEffect(() => { if (!current.data) { epoch.current++; setPanel(""); } }, [current.data]);
  useEffect(() => { if (requestedVersion && active && current.data) { setVersionId(requestedVersion); setPanel("version"); onRequestHandled(); } }, [requestedVersion, active, current.data, onRequestHandled]);
  const content = current.data?.current?.content ?? emptyProfile();
  const dirty = !!draft && JSON.stringify(canonicalProfile(draft.content)) !== draft.baseline;
  function start(replace = false) {
    if (!current.data) return;
    if (!draft || replace) onDraft({ content, expectedVersion: current.data.version, baseline: JSON.stringify(content), requestKey: null });
    setReviewed(false); setError(""); setPanel("edit");
  }
  function change(content: ProfileContent) { if (draft) { onDraft({ ...draft, content, requestKey: null }); setReviewed(false); setError(""); } }
  function updateSection(patch: { status?: "UNKNOWN" | "NONE" | "KNOWN"; note?: string; evidence?: Evidence | null }) {
    if (!draft) return; change({ ...draft.content, [category]: { ...draft.content[category], ...patch } });
  }
  function updateBase(id: string, patch: Partial<BaseItem>) {
    if (!draft) return;
    const section = draft.content[category]; change({ ...draft.content, [category]: { ...section, items: section.items.map(i => i.id === id ? { ...i, ...patch } : i) } });
  }
  function updateMedication(id: string, patch: Partial<Medication>) {
    if (!draft) return; const section = draft.content.medications; change({ ...draft.content, medications: { ...section, items: section.items.map(i => i.id === id ? { ...i, ...patch } : i) } });
  }
  function add() {
    if (!draft || draft.content[category].items.length >= 20) return;
    const evidence: Evidence = { kind: "PATIENT_REPORT", reference: "", date: null }; const item: BaseItem = { id: crypto.randomUUID(), title: "", details: "", evidence };
    if (category === "medications") change({ ...draft.content, medications: { ...draft.content.medications, status: "KNOWN", items: [...draft.content.medications.items, { ...item, regimen: "", intake: "UNKNOWN", startedOn: null, stoppedOn: null }] } });
    else change({ ...draft.content, [category]: { ...draft.content[category], status: "KNOWN", items: [...draft.content[category].items, item] } });
  }
  function remove(id: string) { if (draft) { const section = draft.content[category]; change({ ...draft.content, [category]: { ...section, items: section.items.filter(i => i.id !== id) } }); } }
  async function save() {
    if (!draft || !reviewed || busy || !dirty) return;
    const parsed = profileContentSchema.safeParse(canonicalProfile(draft.content));
    if (!parsed.success) { setError(`Проверьте разделы и источники. ${parsed.error.issues.map(i => i.message).filter((message, i, all) => all.indexOf(message) === i).slice(0, 3).join(" ")}`); return; }
    const generation = epoch.current; const requestKey = draft.requestKey ?? crypto.randomUUID(); onDraft({ ...draft, requestKey }); setBusy(true); setError("");
    try { const result = await apiCommand<{ version: number }>("/api/clinical-profile", { patientId, expectedVersion: draft.expectedVersion, content: parsed.data, requestKey, reviewed: true });
      if (generation !== epoch.current) return;
      onDraft(undefined); setNotice(`Сохранена версия ${result.version}. Источники и предыдущие сведения остались в истории.`); setReviewed(false); setPanel("view"); await Promise.all([current.refresh(), onSaved()]);
    } catch (e) { if (generation === epoch.current) { setError((e as Error).message); await current.refresh(); } } finally { setBusy(false); }
  }
  const editing = draft?.content[category]; const resource = panel === "history" ? history : panel === "version" ? version : current;
  return <section className={`surface assessment-section${compact ? " profile-overview" : ""}`} hidden={!active} aria-label="Клинические сведения">
    {compact ? <ProfileSummary profile={current.data?.current ?? null} loading={!current.data && current.loading} available={!!current.data} dirty={dirty} onOpen={() => setPanel("view")} /> : <><div className="surface-header"><h2>Клинические сведения</h2><Button variant="secondary" disabled={!current.data} onClick={() => start()}>{draft ? "Продолжить ввод" : "Уточнить сведения"}</Button></div><div className="surface-body">{current.data?.current ? <ProfileContentView profile={current.data.current} /> : current.loading && !current.data ? <p role="status">Загружаем сведения…</p> : current.data ? <p className="secondary-text">Сведения ещё не уточнены. Пустые поля не означают отсутствия состояний, аллергий или приёма препаратов.</p> : null}{current.data?.current && <Button variant="quiet" onClick={() => setPanel("history")}>История сведений</Button>}</div></>}
    <SourceImport patientId={patientId} patientName={patientName} active={active && !!current.data} showTrigger={!compact} requested={documentRequested} onHandled={() => setDocumentRequested(false)} profileVersion={current.data?.version ?? 0} profileContent={content} disabled={dirty} draft={documentDraft} onDraft={onDocumentDraft} onPrepared={value => { onDraft({ ...value, requestKey: null }); setPanel("edit"); setReviewed(false); setError(""); }} />
    {current.error && <div className="form-error" role="alert">{current.error}<Button variant="quiet" onClick={() => void current.refresh()}>Повторить</Button></div>}
    {notice && <p className="form-success" role="status">{notice}</p>}
    <Drawer open={!!panel && !!current.data && active} title={panel === "edit" ? "Уточнить клинические сведения" : panel === "history" ? "История клинических сведений" : panel === "version" ? "Сведения выбранной версии" : "Клинические сведения"} description={patientName} dismissDisabled={busy} onClose={() => setPanel("")}>
      {current.data && <>{error && <div className="form-error" role="alert">{error}</div>}{panel !== "edit" && resource.error && <div className="form-error" role="alert">{resource.error}<Button variant="quiet" onClick={() => void resource.refresh()}>Повторить</Button></div>}
      {panel === "view" && <>{current.data.current ? <ProfileContentView profile={current.data.current} /> : <p className="hint">Сведения пока не уточнены. Отсутствие записи не означает отсутствия ограничений или приёма препаратов.</p>}<div className="form-footer"><Button variant="quiet" disabled={dirty} onClick={() => { setPanel(""); setDocumentRequested(true); }}>Из истории болезни</Button>{current.data.current && <Button variant="quiet" onClick={() => setPanel("history")}>История сведений</Button>}<Button onClick={() => start()}>{draft ? "Продолжить ввод" : "Уточнить сведения"}</Button></div></>}
      {panel === "history" && <>{!history.data && history.loading && <p role="status">Загружаем историю…</p>}{history.data?.versions.map(row => <button type="button" className="assessment-row" key={row.id} onClick={() => { setVersionId(row.id); setPanel("version"); }}><span className="assessment-row-copy"><strong>Версия {row.version}</strong><span>{row.savedBy} · {dateLabel(row.createdAt, { year: "numeric", hour: "2-digit", minute: "2-digit" })}</span></span><ArrowUpRight size={17} aria-hidden="true" /></button>)}<div className="assessment-pagination">{cursor && <Button variant="quiet" onClick={() => setCursor(undefined)}>К последним версиям</Button>}{history.data?.nextCursor && <Button variant="quiet" onClick={() => setCursor(history.data!.nextCursor!)}>Более ранние</Button>}</div></>}
      {panel === "version" && <><Button variant="quiet" onClick={() => setPanel("history")}>К истории сведений</Button>{!version.data && version.loading && <p role="status">Загружаем версию…</p>}{version.data?.current && <ProfileContentView profile={version.data.current} />}</>}
      {panel === "edit" && draft && editing && <form onSubmit={e => { e.preventDefault(); void save(); }} noValidate>
        <p className="hint">Текущие сведения по источникам. Лечение назначается в разделе «Назначения».</p>
        {draft.expectedVersion !== current.data.version && <div className="form-error" role="status">На сервере уже версия {current.data.version}. Ваш текст не заменён.<Button variant="quiet" disabled={busy} onClick={() => setPanel("view")}>Посмотреть актуальные сведения</Button><Button variant="quiet" disabled={busy} onClick={() => start(true)}>Заменить мой ввод актуальной версией</Button></div>}
        <div className="profile-categories" role="group" aria-label="Раздел клинических сведений">{categories.map(key => <Button key={key} variant={category === key ? "primary" : "secondary"} aria-pressed={category === key} disabled={busy} onClick={() => setCategory(key)}>{key === "conditions" ? "Состояния" : key === "allergies" ? "Аллергии" : "Препараты"}</Button>)}</div>
        <fieldset disabled={busy} className="care-fields"><legend className="profile-editor-heading">{categoryNames[category]}</legend><label className="field"><span>Статус сведений</span><select value={editing.status} onChange={e => updateSection({ status: e.target.value as typeof editing.status })}>{Object.entries(statusNames).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label>
        {editing.status === "NONE" && <><p className="hint">Отрицательный ответ относится только к указанному источнику. Он не означает, что ограничения или риски исключены.</p><EvidenceEditor value={editing.evidence} onChange={evidence => updateSection({ evidence })} /></>}
        {editing.status !== "KNOWN" && !!editing.items.length && <p className="hint">После сохранения прежние записи этого раздела останутся в истории. Можно вернуть статус «Есть сведения» до сохранения.</p>}
        {editing.status === "KNOWN" && <>{editing.items.map((item, index) => <fieldset className="care-task-editor" key={item.id}><legend>Запись {index + 1}</legend><div className="profile-item-heading"><strong>{category === "medications" ? "Препарат по источнику" : "Сведение"}</strong><button type="button" className="icon-button" aria-label={`Удалить запись ${index + 1}`} onClick={() => remove(item.id)}><Trash2 size={17} /></button></div><label className="field"><span>Название</span><input maxLength={200} value={item.title} onChange={e => updateBase(item.id, { title: e.target.value })} /></label>
          {"intake" in item && <><label className="field"><span>Статус приёма</span><select value={item.intake} onChange={e => updateMedication(item.id, { intake: e.target.value as Medication["intake"], stoppedOn: null })}>{Object.entries(intakeNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><label className="field"><span>Режим по источнику · необязательно</span><input maxLength={500} value={item.regimen} onChange={e => updateMedication(item.id, { regimen: e.target.value })} /></label><label className="field"><span>Начало приёма · если известно</span><input type="date" value={item.startedOn ?? ""} onChange={e => updateMedication(item.id, { startedOn: e.target.value || null })} /></label>{item.intake === "STOPPED" && <label className="field"><span>Прекращение приёма · если известно</span><input type="date" value={item.stoppedOn ?? ""} onChange={e => updateMedication(item.id, { stoppedOn: e.target.value || null })} /></label>}</>}
          <label className="field"><span>Пояснение · необязательно</span><textarea rows={2} maxLength={1500} value={item.details} onChange={e => updateBase(item.id, { details: e.target.value })} /></label><EvidenceEditor value={item.evidence} onChange={evidence => updateBase(item.id, { evidence })} /></fieldset>)}<Button variant="quiet" disabled={editing.items.length >= 20} onClick={add}><Plus size={16} />Добавить запись</Button></>}
        <label className="field"><span>{editing.status === "UNKNOWN" ? "Что осталось уточнить · необязательно" : "Комментарий к разделу · необязательно"}</span><textarea rows={2} maxLength={1000} value={editing.note} onChange={e => updateSection({ note: e.target.value })} /></label></fieldset>
        <label className="check-row"><input type="checkbox" checked={reviewed} disabled={busy} onChange={e => setReviewed(e.target.checked)} /><span>Я проверил ввод, источники и статусы всех изменённых разделов</span></label><p className="hint">После перезагрузки останется только сохранённая версия.</p><div className="form-footer"><Button variant="secondary" disabled={busy} onClick={() => setPanel("")}>Закрыть</Button><Button type="submit" disabled={!reviewed || !dirty} busy={busy}>Сохранить сведения</Button></div>
      </form>}
      </>}
    </Drawer>
  </section>;
}
function EvidenceEditor({ value, onChange }: { value: Evidence | null; onChange: (value: Evidence) => void }) {
  const evidence = value ?? { kind: "PATIENT_REPORT", reference: "", date: null };
  return <fieldset className="profile-source-fields"><legend>Источник сведений</legend>{evidence.document && <><blockquote className="document-quote">{evidence.document.quote}</blockquote><Button variant="quiet" onClick={() => onChange({ kind: evidence.kind, reference: evidence.reference, date: evidence.date })}>Использовать ручной источник вместо привязанного фрагмента</Button></>}<label className="field"><span>Тип источника</span><select value={evidence.kind} onChange={e => onChange({ ...evidence, kind: e.target.value as Evidence["kind"], document: e.target.value === "DOCUMENT" ? evidence.document : undefined })}>{Object.entries(evidenceNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><label className="field"><span>Где получены сведения</span><input maxLength={500} value={evidence.reference} placeholder="Беседа на приёме или название и раздел документа" onChange={e => onChange({ ...evidence, reference: e.target.value })} /></label><label className="field"><span>Дата источника · если известна</span><input type="date" value={evidence.date ?? ""} onChange={e => onChange({ ...evidence, date: e.target.value || null })} /></label></fieldset>;
}
