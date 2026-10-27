"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, ClipboardList, CircleCheck } from "lucide-react";
import type { AssignmentData, AssessmentFormDefinition, AssessmentWorkspaceData } from "@/lib/assessments";
import { apiCommand } from "@/lib/client";
import { dateLabel } from "@/lib/format";
import { Badge, Button, Drawer } from "@/components/ui/primitives";
import { useCareResource } from "./use-care-resource";
import { AssignmentAnswers, DefinitionNotice } from "./shared";

export type ResponseDraft = { answers: Record<string, string>; note: string; revision: number; baseline: string; requestKey: string | null };
export function PatientAssessments({ patientId, active, embedded=false, requestedAssignment, onRequestedHandled }: { patientId: string; active: boolean; embedded?:boolean; requestedAssignment?: string; onRequestedHandled?: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, ResponseDraft>>({});
  const cacheDraft = useCallback((id: string, draft: ResponseDraft) => setDrafts(old => ({ ...old, [id]: draft })), []);
  const hasUnsaved = Object.values(drafts).some(draft => JSON.stringify([draft.answers, draft.note]) !== draft.baseline);
  useEffect(() => { if (!hasUnsaved) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [hasUnsaved]);
  const [cursor, setCursor] = useState<string>();
  const url = `/api/assessments?patientId=${encodeURIComponent(patientId)}&activeOnly=true${cursor ? `&cursor=${cursor}` : ""}`;
  const { data, error, loading, refresh } = useCareResource<AssessmentWorkspaceData>(url, active);
  const [selected, setSelected] = useState<AssignmentData | null>(null); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [targetId, setTargetId] = useState("");
  const target = useCareResource<AssessmentWorkspaceData>(`/api/assessments?patientId=${encodeURIComponent(patientId)}&assignmentId=${encodeURIComponent(targetId)}`, active && !!targetId && open);
  useEffect(() => { if (requestedAssignment && active) { setTargetId(requestedAssignment); setSelected(null); setOpen(true); onRequestedHandled?.(); } }, [requestedAssignment, active, onRequestedHandled]);
  useEffect(() => { if (!active) setOpen(false); }, [active]);
  const current = targetId ? target.data?.assignments[0] ?? null : selected ? data?.assignments.find(a => a.id === selected.id) ?? selected : null;
  const form = (targetId ? target.data : data)?.definitions.find(d => d.id === current?.definitionId)?.form;
  if (!data && !error) return active ? <div className="assessment-loading" role="status">Проверяем назначенные анкеты…</div> : null;

  return <><section className={embedded ? "patient-questionnaires" : "surface assessment-section"} hidden={!active} aria-label="Назначенные анкеты"><div className="surface-header"><h2 className="patient-task-section-title">Анкеты от врача</h2><ClipboardList size={18} className="secondary-text" /></div><div className="surface-body">
    {!embedded && data?.assignments.some(a => a.status === "ASSIGNED" || a.status === "IN_PROGRESS") && <p className="assignment-deadline" role="status">Врач назначил анкету. Выберите её ниже и заполните до указанной даты.</p>}{error && <div className="form-error" role="alert">{error}<Button variant="quiet" onClick={() => void refresh()}>Повторить</Button></div>}
    {data && !data.assignments.length && <p className="secondary-text small-text">Незаполненных анкет нет.</p>}<div className="patient-questionnaire-grid">{data?.assignments.map(assignment => {
      const definition = data.definitions.find(d => d.id === assignment.definitionId);
      const completed = assignment.status === "COMPLETED", cancelled = assignment.status === "CANCELLED";
      const answers = !completed && !cancelled ? drafts[assignment.id]?.answers ?? assignment.answers : assignment.answers;
      const questions = definition?.form.questions ?? [];
      const answered = questions.filter(q => q.options.some(o => o.id === answers[q.id])).length;
      const unsaved = !completed && !cancelled && !!drafts[assignment.id] && JSON.stringify([drafts[assignment.id].answers, drafts[assignment.id].note]) !== drafts[assignment.id].baseline;
      const started = answered > 0 || assignment.status === "IN_PROGRESS";
      const clinician = definition?.form.respondent === "DOCTOR";
      const status = completed ? "Заполнена" : cancelled ? "Отменена" : clinician ? "Заполняет врач" : started ? "В процессе" : "Не заполнена";
      return <button type="button" key={assignment.id} className={`patient-questionnaire-card${completed ? " is-completed" : ""}`} onClick={() => { setTargetId(assignment.id); setSelected(assignment); setOpen(true); }}>
        <span className="patient-questionnaire-heading"><span className="patient-questionnaire-icon">{completed ? <CircleCheck size={21} aria-hidden="true" /> : <ClipboardList size={21} aria-hidden="true" />}</span><Badge tone={completed ? "green" : "neutral"}>{status}</Badge></span>
        <strong className="patient-questionnaire-title">{definition?.form.title ?? "Анкета"}</strong>
        <span className="patient-questionnaire-progress-copy">{completed ? "Ответы отправлены врачу" : cancelled ? "Заполнять не нужно" : clinician ? "Самостоятельно заполнять не нужно" : `Ответов ${answered} из ${questions.length}`}</span>
        {!cancelled && !clinician && <progress className="patient-questionnaire-progress" value={completed ? questions.length : answered} max={questions.length || 1} aria-label={`Прогресс: ${definition?.form.title ?? "Анкета"}`} />}
        {unsaved && <span className="patient-questionnaire-meta">Есть несохранённые ответы</span>}
        <span className="patient-questionnaire-footer"><span>{completed ? "Передана врачу" : cancelled ? "Назначение отменено" : assignment.dueAt ? `До ${dateLabel(assignment.dueAt)} включительно` : "Срок не указан"}</span><span className="patient-questionnaire-action">{completed ? "Посмотреть ответы" : cancelled || clinician ? "Открыть" : started ? "Продолжить" : "Начать"}<ArrowUpRight size={16} aria-hidden="true" /></span></span>
      </button>;
    })}</div>
    <div className="assessment-pagination">{cursor && <Button variant="quiet" disabled={loading} onClick={() => setCursor(undefined)}>К новым анкетам</Button>}{data?.nextCursor && <Button variant="quiet" disabled={loading} onClick={() => setCursor(data.nextCursor!)}>Более ранние анкеты</Button>}</div>
  </div></section><Drawer open={open} title={form?.title ?? "Анкета"} dismissDisabled={busy} onClose={() => setOpen(false)}>{targetId && target.error && <div className="form-error" role="alert">{target.error}<Button variant="quiet" onClick={() => void target.refresh()}>Повторить</Button></div>}{targetId && !target.data && !target.error && <p role="status">Загружаем анкету…</p>}{current && form && <><DefinitionNotice form={form} />{current.dueAt && <p className="assignment-deadline">Заполнить до <strong>{dateLabel(current.dueAt, {year:"numeric"})}</strong> включительно</p>}{current.status === "COMPLETED" || current.status === "CANCELLED" ? <AssignmentAnswers assignment={current} form={form} /> : form.respondent === "DOCTOR" ? <p className="hint">Эту шкалу заполняет врач по результатам осмотра и беседы. Самостоятельно отвечать не нужно.</p> : <ResponseEditor key={current.id} initialDraft={drafts[current.id]} onDraftChange={cacheDraft} assignment={current} form={form} onBusy={setBusy} onSaved={async () => { await Promise.all([refresh(), target.refresh()]); }} />}</>}</Drawer></>;
}

export function ResponseEditor({ assignment, form, onBusy, onSaved, initialDraft, onDraftChange }: { assignment: AssignmentData; form: AssessmentFormDefinition; onBusy: (busy: boolean) => void; onSaved: () => Promise<void>; initialDraft?: ResponseDraft; onDraftChange: (id: string, draft: ResponseDraft) => void }) {
  const [answers, setAnswers] = useState(initialDraft?.answers ?? assignment.answers); const [note, setNote] = useState(initialDraft?.note ?? assignment.note); const [revision, setRevision] = useState(initialDraft?.revision ?? assignment.revision);
  const [baseline, setBaseline] = useState(initialDraft?.baseline ?? JSON.stringify([assignment.answers, assignment.note]));
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [saved, setSaved] = useState(false); const [sent, setSent] = useState(false);
  const grouped = form.questions.length > 8;
  const groupSize = grouped ? 3 : form.questions.length;
  const [group, setGroup] = useState(() => { const missing = form.questions.findIndex(q => q.required && !(initialDraft?.answers ?? assignment.answers)[q.id]); return Math.floor((missing < 0 ? form.questions.length - 1 : missing) / groupSize); });
  const groupTitle = useRef<HTMLHeadingElement>(null); const moved = useRef(false);
  const lastGroup = (group + 1) * groupSize >= form.questions.length;
  const visibleQuestions = form.questions.slice(group * groupSize, (group + 1) * groupSize);
  const groupComplete = visibleQuestions.every(q => !q.required || !!answers[q.id]);
  useEffect(() => { if (moved.current) groupTitle.current?.focus(); }, [group]);
  function move(next: number) { moved.current = true; setGroup(next); setError(""); }
  const key = useRef<string | null>(initialDraft?.requestKey ?? null); const dirty = JSON.stringify([answers, note]) !== baseline;
  useEffect(() => { onDraftChange(assignment.id, { answers, note, revision, baseline, requestKey: key.current }); }, [assignment.id, answers, note, revision, baseline, busy, onDraftChange]);
  const complete = form.questions.filter(q => q.required).every(q => answers[q.id]);
  const answered = form.questions.filter(q => answers[q.id]).length;
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  useEffect(() => { if (!dirty && !busy && assignment.revision > revision) { setAnswers(assignment.answers); setNote(assignment.note); setRevision(assignment.revision); setBaseline(JSON.stringify([assignment.answers, assignment.note])); } }, [assignment, dirty, busy, revision]);
  async function save(submit: boolean) {
    if (busy) return; setBusy(true); setError(""); setSaved(false);
    try {
      if (submit) { key.current ??= crypto.randomUUID(); await apiCommand("/api/assessments", { action: "submit", assignmentId: assignment.id, revision, answers, note, requestKey: key.current }); setSent(true); setBaseline(JSON.stringify([answers, note])); }
      else { const result = await apiCommand<{ revision: number }>("/api/assessments", { action: "save-draft", assignmentId: assignment.id, revision, answers, note }); setRevision(result.revision); setBaseline(JSON.stringify([answers, note])); setSaved(true); }
      await onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); if (grouped && !lastGroup) { if (groupComplete) move(group + 1); return; } if (complete) void save(true); }
  if (sent) return <div className="connection-success" role="status"><CircleCheck size={35} /><h3>{form.respondent === "DOCTOR" ? "Врачебная оценка сохранена" : "Ответы переданы врачу"}</h3><p>{form.respondent === "DOCTOR" ? "Оценка и программный результат сохранены в карточке пациента." : "Ответы сохранены. Врач ещё мог их не просмотреть."}</p></div>;
  return <form onSubmit={submit} className="assessment-form"><p className="assessment-instructions">{form.instructions}</p><p className="assessment-progress" aria-live="polite">Заполнено {answered} из {form.questions.length}{dirty ? " · есть несохранённые изменения" : ""}</p>
    {grouped && <div className="assessment-group-heading"><h3 ref={groupTitle} tabIndex={-1}>Вопросы {group * groupSize + 1}–{Math.min((group + 1) * groupSize, form.questions.length)} из {form.questions.length}</h3><span>Блок {group + 1} из {Math.ceil(form.questions.length / groupSize)}</span></div>}
    {visibleQuestions.map((question, i) => <fieldset className="assessment-question" disabled={busy} key={question.id}><legend>{grouped && `${group * groupSize + i + 1}. `}{question.title}{question.required && <span className="assessment-required"> · обязательно</span>}</legend>{question.options.map(option => <label className={`assessment-option ${answers[question.id] === option.id ? "is-selected" : ""}`} key={option.id}><input type="radio" name={question.id} value={option.id} checked={answers[question.id] === option.id} required={question.required} onChange={() => { setAnswers(old => ({ ...old, [question.id]: option.id })); setSaved(false); key.current = null; }} /><span>{option.label}</span></label>)}</fieldset>)}
    {lastGroup && <label className="field"><span>Комментарий к анкете · необязательно</span><textarea value={note} onChange={e => { setNote(e.target.value); setSaved(false); key.current = null; }} rows={3} maxLength={2000} disabled={busy} /></label>}
    {error && <div className="form-error" role="alert">{error}</div>}{saved && <p className="form-success" role="status">Черновик сохранён на сервере. Можно продолжить позже.</p>}
    <p className="hint">При закрытии панели ввод остаётся в этой вкладке. Сохраните черновик, чтобы продолжить после перезагрузки. Отправленный ответ нельзя незаметно изменить.</p>
    <div className="form-footer"><Button variant="secondary" disabled={!dirty || busy} onClick={() => void save(false)}>Сохранить черновик</Button>{(!grouped || lastGroup) && <Button type="submit" disabled={!complete} busy={busy}>{form.respondent === "DOCTOR" ? "Сохранить врачебную оценку" : "Отправить врачу"}</Button>}</div>
    {grouped && <div className="assessment-group-nav"><Button variant="quiet" disabled={busy || group === 0} onClick={() => move(group - 1)}>Назад</Button>{!lastGroup && <Button disabled={busy || !groupComplete} onClick={() => move(group + 1)}>Далее · вопросы {group * groupSize + groupSize + 1}–{Math.min((group + 2) * groupSize, form.questions.length)}</Button>}</div>}
    {!complete && <p className="assessment-progress">{grouped && !lastGroup ? "Ответьте на вопросы этого блока, чтобы продолжить. Черновик можно сохранить в любой момент." : "Для отправки ответьте на все обязательные вопросы."}</p>}
  </form>;
}
