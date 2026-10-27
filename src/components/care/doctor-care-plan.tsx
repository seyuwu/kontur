"use client";
import {MedicationRegimenEditor} from "./medication-regimen-editor";
import {regimenLabel} from "@/lib/medication-regimen";
import {PrescriptionAction} from "@/components/doctor/prescription-actions";
import { MedicationDose } from "./medication-dose";
import { dateLabel } from "@/lib/format";
import {moscowDate} from "@/lib/assessment-deadline";
import { DailyTasks } from "@/components/follow-up/daily-tasks";
import { PlanDocuments } from "./plan-documents";
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, FileCheck2, Pill, ListChecks, ChevronRight } from "lucide-react";
import type { CareContent, CareWorkspace } from "@/lib/care";
import { careContentSchema } from "@/modules/care/contract";
import { apiCommand } from "@/lib/client";
import { Badge, Button, Drawer } from "@/components/ui/primitives";
import { useCareResource } from "@/components/assessments/use-care-resource";
import { PlanContent, PlanHistory } from "./shared";

export type CareEditorDraft = { content: CareContent; revision: number; basisToken: string; id?: string; baseline: string };
export function DoctorCarePlan({ patientId, patientName, active, compact = false, embedded = false, cached, onCache, onPublished, onProfileVersion, sourceVersion }: { patientId: string; patientName: string; active: boolean; compact?: boolean; embedded?:boolean; cached?: CareEditorDraft; onCache: (value: CareEditorDraft | undefined) => void; onPublished: () => Promise<void>; onProfileVersion?: (id: string) => void; sourceVersion?: number | string }) {
  const resource = useCareResource<CareWorkspace>(`/api/care?patientId=${encodeURIComponent(patientId)}`, active);
  const previousSource = useRef(sourceVersion);
  useEffect(() => { if (previousSource.current !== sourceVersion && active) { previousSource.current = sourceVersion; void resource.refresh(); } }, [sourceVersion, active, resource.refresh]);
  const { data } = resource; const [panel, setPanel] = useState<"" | "edit" | "preview" | "task" | "plan">(""); const [history, setHistory] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [editingTaskId, setEditingTaskId] = useState("");
  const selectedTask = data?.current?.tasks.find(t => t.id === taskId);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [reviewed, setReviewed] = useState(false);
  const key = useRef<string | null>(null); const editor = cached;
  const dirty = !!editor && JSON.stringify(editor.content) !== editor.baseline;
  useEffect(() => { if (!active) { setPanel(""); setHistory(false); } }, [active]);
  const stale = !!editor && !!data?.context && editor.basisToken !== data.context.token;
  function start(reload = false, focusTaskId = "") {
    setEditingTaskId(focusTaskId && (editor?.content.tasks ?? data?.draft?.content.tasks ?? data?.current?.tasks)?.some(t => t.id === focusTaskId) ? focusTaskId : "");
    if (!data?.context) return; setError(""); setReviewed(false); key.current = null;
    if (!editor || reload) {
      const content: CareContent = data.draft?.content ? { ...data.draft.content, nextContactDate: data.draft.content.appointment?.at.slice(0, 10) ?? data.draft.content.nextContactDate, appointment: data.draft.content.appointment ?? data.nextAppointment ?? null } : (data.current ? { goal: data.current.goal, instructions: data.current.instructions, nextContactDate: data.current.nextContactDate, appointment: data.current.appointment ?? data.nextAppointment ?? null, tasks: data.current.tasks.map(({ id, kind, title, details, dueDate, assignmentId, repeat, startDate, time, medication }) => ({ id, kind, title, details, dueDate, assignmentId, ...(repeat ? { repeat } : {}), ...(startDate ? {startDate} : {}), ...(time ? {time} : {}), ...(medication ? {medication} : {}) })) } : { goal: "", instructions: "", nextContactDate: data.nextVisitDate ?? null, appointment:data.nextAppointment ?? null, tasks: [] });
      onCache({ content, revision: data.draftRevision ?? 0, basisToken: data.draft?.basisToken ?? data.context.token, id: data.draft?.id, baseline: data.draft ? JSON.stringify(content) : "" });
    }
    setPanel("edit");
  }
  function change(content: CareContent) { if (!editor) return; onCache({ ...editor, content }); setReviewed(false); key.current = null; setError(""); }
  async function save(rebase: boolean) {
    if (!editor || !data?.context || busy) return;
    const parsed = careContentSchema.safeParse(editor.content); if (!parsed.success) { setError("Заполните цель, памятку и назначения. Для лекарства укажите препарат, дозу, дату начала и время приёма."); return; }
    setBusy(true); setError("");
    try { const result = await apiCommand<{ id: string; revision: number; content: CareContent; basisToken: string }>("/api/care", { action: rebase ? "rebase" : "save-draft", patientId, revision: editor.revision, content: parsed.data, basisToken: rebase ? data.context.token : editor.basisToken, ...(rebase ? { reviewed: true } : {}) });
      onCache({ ...result, baseline: JSON.stringify(result.content) }); setReviewed(false); key.current = null; await resource.refresh(); setPanel("preview");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!editor?.id || !reviewed || dirty || stale || busy) return; setBusy(true); setError(""); key.current ??= crypto.randomUUID();
    try { await apiCommand("/api/care", { action: "confirm", patientId, draftId: editor.id, revision: editor.revision, requestKey: key.current, reviewed: true }); onCache(undefined); setPanel(""); setNotice("Назначения сохранены."); await Promise.all([resource.refresh(), onPublished()]); }
    catch (e) { setError((e as Error).message); await resource.refresh(); } finally { setBusy(false); }
  }
  async function discard() {
    if (!editor || busy) return; setBusy(true); setError("");
    try { if (data?.draft) await apiCommand("/api/care", { action: "discard", patientId, revision: editor.revision }); onCache(undefined); setPanel(""); await resource.refresh(); setNotice("Черновик удалён. Действующий план сохранён."); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section id="care-plan" className={`${embedded ? "assignments-subsection" : "surface assessment-section"}${compact ? " overview-plan" : ""}`} hidden={!active} aria-label="План наблюдения">
    <div className={embedded ? "prescription-embedded-heading" : "surface-header"}><div><h2 className={embedded ? "sr-only" : undefined}>{embedded ? "Лечение и задачи" : "План наблюдения"}</h2></div>{data ? <PrescriptionAction view="treatment"><Button disabled={resource.loading} variant={data.current ? "secondary" : "primary"} onClick={() => start()}>{data.draft || editor ? "Продолжить черновик" : data.current ? "Обновить план" : embedded ? "Назначить лечение" : "Подготовить план"}</Button></PrescriptionAction> : <FileCheck2 size={18} className="secondary-text" />}</div><div className="surface-body">
      {resource.error && <div className="form-error" role="alert">{resource.error}<Button variant="quiet" onClick={() => void resource.refresh()}>Повторить</Button></div>}
      {!data && resource.loading && <p role="status">Загружаем план…</p>}
      {notice && <p className="form-success" role="status">{notice}</p>}
      {data && <>{data.current ? <>
        <ul className="prescription-treatment-list">{data.current.tasks.map(task => <li key={task.id}><button type="button" className="prescription-treatment-button" onClick={() => { setTaskId(task.id); setPanel("task"); }}>
          <span className="prescription-task-icon">{task.kind === "MEDICATION" ? <Pill size={18} aria-hidden="true" /> : <ListChecks size={18} aria-hidden="true" />}</span>
          <div className="prescription-treatment-copy"><strong>{task.title}</strong><p>{task.kind === "MEDICATION" ? `Доза: ${task.medication?.dose ?? "не указана"}` : task.kind === "ASSESSMENT" ? "Назначенная анкета" : "Договорённость"}</p></div>
          <ChevronRight size={17} className="prescription-treatment-arrow" aria-hidden="true" /><span className="prescription-task-schedule"><strong>{task.medication?.regimen ? (task.medicationSchedule?.times.join(", ") || task.medication.regimen.times.join(", ") || "Время выбирает пациент") : task.time ? `${task.time} · Москва` : task.repeat ? "Ежедневно" : task.dueDate ? `До ${dateLabel(task.dueDate)}` : "Без срока"}</strong><small>{task.medication?.regimen ? regimenLabel(task.medication.regimen) : task.time && (task.repeat ? "Ежедневно" : "Однократно")}{task.startDate ? ` · с ${dateLabel(task.startDate)}` : ""}{task.dueDate && task.time ? ` · до ${dateLabel(task.dueDate)}` : ""}</small></span>
        </button></li>)}</ul>
        {!data.current.tasks.length && <p className="secondary-text small-text">В плане нет отдельных лекарств или задач.</p>}

      </> : <div className="prescription-empty"><strong>Лечение пока не назначено</strong></div>}
      {(data.draft || editor) && <p className="care-draft-status">{dirty ? "Есть несохранённый текст в этой вкладке" : "Есть черновик врача · пациент его не видит"}</p>}
      {data.current && !data.current.tasks.length && <Button variant="quiet" onClick={() => setPanel("plan")}>Открыть план</Button>}</>}

    </div>
    <Drawer open={(panel === "task" || panel === "plan") && !!data?.current && active} title={panel === "task" ? selectedTask?.title ?? "Назначение" : "План лечения"} onClose={() => setPanel(current => current === "task" || current === "plan" ? "" : current)}>
      {data?.current && <>
        {panel === "task" && selectedTask && <>
          <dl className="prescription-task-facts">
            {selectedTask.kind === "MEDICATION" && <div><dt>Доза на один приём</dt><dd>{selectedTask.medication?.dose}</dd></div>}
            <div><dt>Расписание</dt><dd>{selectedTask.medication?.regimen ? regimenLabel(selectedTask.medication.regimen) : selectedTask.repeat ? "Ежедневно" : "Однократно"}{selectedTask.time ? ` в ${selectedTask.time} (Москва)` : ""}</dd></div>
            {selectedTask.startDate && <div><dt>Начало</dt><dd>{dateLabel(selectedTask.startDate)}</dd></div>}
            {selectedTask.dueDate && <div><dt>{selectedTask.repeat ? "Последний день" : "Срок"}</dt><dd>{dateLabel(selectedTask.dueDate)}</dd></div>}
          </dl>
          {selectedTask.details && <p className="care-prose">{selectedTask.details}</p>}
          {selectedTask.report && <p className="hint">{selectedTask.report.state === "DONE" ? "Выполнено со слов пациента" : selectedTask.report.state === "NEEDS_HELP" ? "Есть вопрос врачу" : "Пока не выполнено"}{selectedTask.report.note ? `: ${selectedTask.report.note}` : ""}</p>}
          {selectedTask.medication?.regimen&&<><p>Время: {(selectedTask.medicationSchedule?.times.length ? selectedTask.medicationSchedule.times : selectedTask.medication.regimen.times).join(", ")||"Пациент ещё не выбрал"} · Москва</p>{!!selectedTask.medicationIntakes?.length&&<details><summary>Отметки о приёмах</summary><ul>{selectedTask.medicationIntakes.slice(0,12).map(row=><li key={`${row.date}:${row.time}`}>{dateLabel(row.date)} · {row.time} · {({DONE:"Принял(а)",NOT_DONE:"Не принял(а)",PARTIAL:"Частично",UNSURE:"Не помню"} as Record<string,string>)[row.state]}{row.note&&` — ${row.note}`}</li>)}</ul></details>}</>}
          <div className="care-actions"><Button onClick={() => start(false, selectedTask.id)}>Изменить назначение</Button></div>
          {selectedTask.repeat && !selectedTask.medication?.regimen && <DailyTasks patientId={patientId} planId={data.current.id} active={active && panel === "task"} doctor taskId={selectedTask.id} />}
        </>}
        <details className="care-details" open={panel === "plan"}><summary>План лечения</summary>
          {data.context?.changesSincePlan && <p className="hint">Есть новые ответы или отметки. Проверьте актуальность плана.</p>}
          <PlanContent plan={data.current} /><PlanDocuments patientId={patientId} versionId={data.current.id} doctor />
          {data.current.clinicalProfileVersionId && onProfileVersion && <Button variant="quiet" onClick={() => { setPanel(""); onProfileVersion(data.current!.clinicalProfileVersionId!); }}>Сведения на момент подтверждения</Button>}
          <Button variant="quiet" onClick={() => { setPanel(""); setHistory(true); }}>История версий</Button>
        </details>
      </>}
    </Drawer>
    <Drawer open={(panel === "edit" || panel === "preview") && !!data && active} title={panel === "preview" ? "Проверить план перед подтверждением" : editingTaskId ? "Изменить назначение" : "Подготовить план наблюдения"} description={patientName} dismissDisabled={busy} onClose={() => setPanel(current => current === "edit" || current === "preview" ? "" : current)}>
      {data && editor && <>{error && <div className="form-error" role="alert">{error}</div>}
      {stale && <div className="care-stale" role="status"><strong>Данные пациента изменились</strong><p>Закройте панель и просмотрите новые ответы, отметки и действующий план. Затем подтвердите проверку здесь.</p><label className="check-row"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} disabled={busy} />Я просмотрел актуальные данные пациента</label><Button variant="secondary" disabled={!reviewed || busy} onClick={() => void save(true)}>Учесть проверенные данные и сохранить</Button></div>}
      {panel === "edit" ? <form onSubmit={e => { e.preventDefault(); void save(false); }}>
        
        <fieldset disabled={busy} className="care-fields"><div hidden={!!editingTaskId}><label className="field"><span>Цель наблюдения</span><input value={editor.content.goal} onChange={e => change({ ...editor.content, goal: e.target.value })} required minLength={3} maxLength={500} placeholder="Что нужно обсудить и уточнить на следующем контакте" /></label>
        <label className="field"><span>Памятка пациенту</span><textarea value={editor.content.instructions} onChange={e => change({ ...editor.content, instructions: e.target.value })} required minLength={3} maxLength={4000} rows={5} placeholder="Понятные следующие шаги и договорённости" /></label>
        </div><div hidden={!!editingTaskId} className="care-task-heading"><h3>Задачи пациенту</h3><span className="secondary-text small-text">До 8 задач</span></div>
        {editor.content.tasks.map((task, index) => { const update = (patch: Partial<typeof task>) => change({ ...editor.content, tasks: editor.content.tasks.map(t => t.id === task.id ? { ...t, ...patch } : t) }); return <fieldset disabled={!!editingTaskId && editingTaskId !== task.id} hidden={!!editingTaskId && editingTaskId !== task.id} className="care-task-editor" key={task.id}><legend>Задача {index + 1}</legend><div className="care-task-toolbar"><label className="field"><span>Тип задачи</span><select value={task.kind} onChange={e => update({ kind: e.target.value as typeof task.kind, assignmentId: null, repeat: e.target.value === "MEDICATION" ? "DAILY" : undefined, startDate:e.target.value === "MEDICATION" ? moscowDate() : undefined,time:e.target.value === "MEDICATION" ? "09:00" : undefined,medication:e.target.value === "MEDICATION" ? {name:task.title,dose:""} : undefined })}><option value="ACTION">Договорённость</option><option value="MEDICATION">Приём лекарства</option><option value="ASSESSMENT">Назначенная анкета</option></select></label><button type="button" className="icon-button" aria-label={`Удалить задачу ${index + 1}`} onClick={() => { change({ ...editor.content, tasks: editor.content.tasks.filter(t => t.id !== task.id) }); setEditingTaskId(""); }}><Trash2 size={17} /></button></div>
          {task.kind === "ASSESSMENT" && <label className="field"><span>Назначение анкеты</span><select required value={task.assignmentId ?? ""} onChange={e => { const a = data.availableAssignments?.find(a => a.id === e.target.value); update({ assignmentId: e.target.value || null, ...(a ? { title: a.title } : {}) }); }}><option value="">Выберите назначение</option>{data.availableAssignments?.map(a => <option value={a.id} key={a.id}>{a.title} · v{a.version}{!["ASSIGNED", "IN_PROGRESS"].includes(a.status) ? " · закрыта" : ""}</option>)}</select><small>Сначала назначьте анкету в карточке пациента.</small></label>}
          <label className="field"><span>{task.kind === "MEDICATION" ? "Название препарата" : `Название задачи ${index + 1}`}</span><input required minLength={2} maxLength={200} value={task.title} onChange={e => update({ title: e.target.value,...(task.kind === "MEDICATION" ? {medication:{...task.medication,name:e.target.value,dose:task.medication?.dose??""}} : {}) })} /></label><label className="field"><span>Пояснение · необязательно</span><textarea rows={2} maxLength={1500} value={task.details} onChange={e => update({ details: e.target.value })} /></label>{task.kind === "MEDICATION" && <><MedicationDose value={task.medication?.dose ?? ""} onChange={dose => update({ medication: { ...task.medication,name: task.title, dose } })} /><div className="prescription-dates"><label className="field"><span>Дата начала приёма</span><input required type="date" value={task.startDate??""} onChange={e=>update({startDate:e.target.value})} /></label></div>{task.medication?.regimen ? <MedicationRegimenEditor value={task.medication.regimen} onChange={regimen=>update({medication:{...task.medication!,regimen},time:regimen.timeMode==="FIXED"?regimen.times[0]:undefined,repeat:regimen.everyDays===0?undefined:"DAILY",...(regimen.everyDays===0?{dueDate:null}:{})})}/> : <><label className="field"><span>Время приёма · Москва</span><input required type="time" value={task.time??""} onChange={e=>update({time:e.target.value})}/></label><Button variant="quiet" onClick={()=>update({medication:{...task.medication!,regimen:{everyDays:task.repeat?1:0,timesPerDay:1,timeMode:"FIXED",times:[task.time??"09:00"]}}})}>Настроить периодичность</Button></>}</>}{task.kind !== "ASSESSMENT" && !task.medication?.regimen && <label className="check-row"><input type="checkbox" checked={!!task.repeat} onChange={e => update({ repeat: e.target.checked ? "DAILY" : undefined, ...(!e.target.checked && task.kind === "MEDICATION" ? {dueDate:null} : {}) })} />Повторять ежедневно с отдельной отметкой за день</label>}{(task.kind !== "MEDICATION" || task.repeat) && <label className="field"><span>{task.repeat ? task.kind === "MEDICATION" ? "Последний день приёма · необязательно" : "Последний день повторения · необязательно" : "Срок задачи · необязательно"}</span><input type="date" value={task.dueDate ?? ""} onChange={e => update({ dueDate: e.target.value || null })} /></label>}</fieldset>; })}
        <div hidden={!!editingTaskId}><Button variant="secondary" disabled={editor.content.tasks.length>=8} onClick={()=>change({...editor.content,tasks:[...editor.content.tasks,{id:crypto.randomUUID(),kind:"MEDICATION",title:"",details:"",dueDate:null,assignmentId:null,startDate:moscowDate(),repeat:"DAILY",medication:{name:"",dose:"",regimen:{everyDays:1,timesPerDay:1,timeMode:"PATIENT",times:[]}}}]})}><Plus size={16} />Добавить лекарство</Button><Button variant="quiet" disabled={editor.content.tasks.length >= 8} onClick={() => change({ ...editor.content, tasks: [...editor.content.tasks, { id: crypto.randomUUID(), kind: "ACTION", title: "", details: "", dueDate: null, assignmentId: null }] })}><Plus size={16} />Добавить задачу</Button></div></fieldset>
        {editingTaskId && <Button variant="quiet" onClick={() => setEditingTaskId("")}>Изменить весь план</Button>}
        <p className="hint">Сохраните черновик, чтобы продолжить после перезагрузки.</p><div className="form-footer"><Button hidden={!!editingTaskId} variant="quiet" disabled={busy} onClick={() => void discard()}>Удалить черновик</Button><Button type="submit" busy={busy}>Сохранить и проверить</Button></div>
        {editor.revision !== data.draftRevision && <Button variant="quiet" disabled={busy} onClick={() => start(true)}>Открыть сохранённую версию вместо моего текста</Button>}
      </form> : <><Badge>Предпросмотр для пациента · черновик</Badge><PlanContent plan={{ ...editor.content, tasks: editor.content.tasks.map(t => ({ ...t, report: null, assignment: (() => { const a = data.availableAssignments?.find(a => a.id === t.assignmentId); return a ? { title: a.title, version: a.version, mode: a.mode, status: a.status } : null; })() })) }} /><label className="check-row care-confirm"><input type="checkbox" checked={reviewed} disabled={busy || stale} onChange={e => setReviewed(e.target.checked)} />Я проверил содержание и подтверждаю этот план для пациента</label><div className="form-footer"><Button variant="secondary" disabled={busy} onClick={() => { setPanel("edit"); setReviewed(false); }}>Редактировать</Button><Button disabled={!reviewed || stale || dirty} busy={busy} onClick={() => void confirm()}>Подтвердить и показать пациенту</Button></div></>}
      </>}
    </Drawer><PlanHistory patientId={patientId} open={history && !!data && active} onClose={() => setHistory(false)} onProfileVersion={onProfileVersion ? id => { setHistory(false); onProfileVersion(id); } : undefined} />
  </section>;
}
