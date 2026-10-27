"use client";
import {PrescriptionAction} from "@/components/doctor/prescription-actions";
import { assessmentDateAfter, assessmentDueAt, moscowDate } from "@/lib/assessment-deadline";
import { NotificationGuidance } from "./notification-guidance";
import { ResponseEditor, type ResponseDraft } from "./patient-assessments";
import { MethodCatalogue } from "./method-catalogue";
import { LlmSummary } from "@/components/assessments/llm-summary";
import { useCallback, useState, type FormEvent } from "react";
import { ArrowUpRight, ClipboardPlus, Clock3 } from "lucide-react";
import type { AssignmentData, AssessmentWorkspaceData } from "@/lib/assessments";
import { apiCommand } from "@/lib/client";
import { dateLabel } from "@/lib/format";
import { Badge, Button, Drawer } from "@/components/ui/primitives";
import { useCareResource } from "./use-care-resource";
import { DefinitionNotice, AssignmentAnswers, assignmentLabels } from "./shared";

export function DoctorAssessments({ patientId, embedded=false }: { patientId: string; embedded?:boolean }) {
  const [responseDrafts, setResponseDrafts] = useState<Record<string, ResponseDraft>>({});
  const cacheResponseDraft = useCallback((id: string, draft: ResponseDraft) => setResponseDrafts(old => ({ ...old, [id]: draft })), []);
  const [list, setList] = useState<"active" | "finished">("active");
  const [cursor, setCursor] = useState<string>();
  const { data, error: loadError, loading, refresh } = useCareResource<AssessmentWorkspaceData>(`/api/assessments?patientId=${encodeURIComponent(patientId)}${cursor ? `&cursor=${cursor}` : ""}`);
  const [panel, setPanel] = useState<"" | "assign" | "answers" | "cancel">("");
  const [selected, setSelected] = useState<AssignmentData | null>(null);
  const [definitionId, setDefinitionId] = useState(""); const [dueDate, setDueDate] = useState(() => assessmentDateAfter(3)); const [deadline, setDeadline] = useState("3"); const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const current = selected ? data?.assignments.find(a => a.id === selected.id) ?? selected : null;
  const definition = data?.definitions.find(d => d.id === (panel === "assign" ? definitionId : current?.definitionId));
  const available = data?.definitions.filter(d => data.assignableDefinitionIds.includes(d.id)) ?? [];
  const assignments = data?.assignments ?? [];
  const activeAssignments = assignments.filter(a => a.status === "ASSIGNED" || a.status === "IN_PROGRESS");
  const finishedAssignments = assignments.filter(a => a.status === "COMPLETED" || a.status === "CANCELLED");
  const visibleAssignments = list === "active" ? activeAssignments : finishedAssignments;
  function openAssign() { setError(""); setDefinitionId(available.find(d => d.form.code === "guideline-f40-bai-demo")?.id ?? available[0]?.id ?? ""); setDeadline("3"); setDueDate(assessmentDateAfter(3)); setPanel("assign"); }
  async function assign(event: FormEvent) {
    event.preventDefault(); if (!definitionId || busy) return; setBusy(true); setError("");
    try { await apiCommand("/api/assessments", { action: "assign", patientId, definitionId, dueAt: dueDate ? assessmentDueAt(dueDate) : null }); setPanel(""); setNotice(definition?.form.respondent === "DOCTOR" ? "Добавлена врачебная шкала. Откройте её для заполнения после осмотра и беседы." : "Анкета назначена. Пациент увидит срок в кабинете и получит push, если подключил уведомления."); if (cursor) setCursor(undefined); else await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function cancel(event: FormEvent) {
    event.preventDefault(); if (!current || busy) return; setBusy(true); setError("");
    try { await apiCommand("/api/assessments", { action: "cancel", assignmentId: current.id, revision: current.revision, reason }); await refresh(); setPanel(""); setReason(""); setNotice("Назначение отменено. Причина сохранена в истории."); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className={embedded ? "assignments-subsection" : "surface assessment-section"} aria-label="Анкеты пациента"><div className={embedded ? "prescription-embedded-heading" : "surface-header"}><div><h2 className={embedded ? "sr-only" : undefined}>Анкеты и сроки</h2></div><PrescriptionAction view="questionnaires"><Button disabled={!available.length || loading} onClick={openAssign}><ClipboardPlus size={16} />Назначить анкету</Button></PrescriptionAction></div><div className="surface-body">
    {loadError && <div className="form-error" role="alert">{loadError}<Button variant="quiet" onClick={() => void refresh()}>Повторить</Button></div>}
    {notice && <p className="form-success" role="status">{notice}</p>}
    {!data && loading && <p className="secondary-text small-text" role="status">Загружаем назначения…</p>}
    {data && <>
      <div className="prescription-list-switch" role="group" aria-label="Статус анкет">
        <button type="button" aria-pressed={list === "active"} onClick={() => setList("active")}>Ожидают заполнения <span>{activeAssignments.length}</span></button>
        <button type="button" aria-pressed={list === "finished"} onClick={() => setList("finished")}>Завершённые <span>{finishedAssignments.length}</span></button>
      </div>
      {!visibleAssignments.length && <div className="prescription-empty"><strong>{list === "active" ? "Нет анкет, ожидающих заполнения" : "Завершённых анкет пока нет"}</strong></div>}
      <div className="doctor-questionnaire-list">{visibleAssignments.map(assignment => {
        const form = data.definitions.find(d => d.id === assignment.definitionId)?.form;
        const completed = assignment.status === "COMPLETED";
        const cancelled = assignment.status === "CANCELLED";
        const overdue = !completed && !cancelled && !!assignment.dueAt && assignment.dueAt.slice(0,10) < moscowDate();
        const answered = Object.keys(assignment.answers).length;
        return <button type="button" className="doctor-questionnaire" key={assignment.id} onClick={() => { setSelected(assignment); setError(""); setPanel("answers"); }}>
          <span className="doctor-questionnaire-top"><Badge tone={completed ? "green" : overdue ? "amber" : "neutral"}>{completed ? "Заполнена" : overdue ? "Срок прошёл" : assignmentLabels[assignment.status]}</Badge><span className="secondary-text small-text">{form?.respondent === "DOCTOR" ? "Заполняет врач" : "Заполняет пациент"}</span></span>
          <strong>{form?.title ?? "Анкета"}</strong>
          <span className="doctor-questionnaire-bottom"><span className={overdue ? "prescription-overdue" : ""}><Clock3 size={14} aria-hidden="true" />{completed && assignment.completedAt ? dateLabel(assignment.completedAt) : assignment.dueAt ? `До ${dateLabel(assignment.dueAt)}` : "Без срока"}</span><span>{assignment.submission ? `${assignment.submission.metric.value} балл(ов)` : cancelled ? "Отменена" : answered ? `${answered} из ${form?.questions.length ?? answered} ответов` : "Не начата"}</span><ArrowUpRight size={16} aria-hidden="true" /></span>
        </button>;
      })}</div>
    </>}
    <div className="assessment-pagination">{cursor && <Button variant="quiet" onClick={() => setCursor(undefined)}>К новым</Button>}{data?.nextCursor && <Button variant="quiet" onClick={() => setCursor(data.nextCursor!)}>Более ранние</Button>}</div>
  </div><Drawer open={!!panel} title={panel === "assign" ? "Назначить анкету" : panel === "cancel" ? "Отменить назначение" : definition?.form.respondent === "DOCTOR" ? "Врачебная оценка" : "Ответы пациента"} dismissDisabled={busy} onClose={() => setPanel("")}>
    {error && <div className="form-error" role="alert">{error}</div>}
    {panel === "assign" && <>{data && <MethodCatalogue definitions={data.definitions} assignableIds={data.assignableDefinitionIds} onSelect={id => { setDefinitionId(id); setError(""); }} />}<form onSubmit={assign}><label className="field"><span>Анкета</span><select value={definitionId} onChange={e => setDefinitionId(e.target.value)} disabled={busy} required>{available.map(d => <option key={d.id} value={d.id}>{d.form.title} · v{d.form.version}</option>)}</select></label>{definition && <DefinitionNotice form={definition.form} />}<label className="field"><span>Заполнить за</span><select value={deadline} disabled={busy} onChange={e => { const value = e.target.value; setDeadline(value); if (value !== "custom") setDueDate(assessmentDateAfter(Number(value))); }}><option value="1">1 день</option><option value="3">3 дня</option><option value="7">7 дней</option><option value="14">14 дней</option><option value="custom">Указать дату</option></select></label>{deadline === "custom" && <label className="field"><span>Заполнить до</span><input required type="date" min={moscowDate()} value={dueDate} disabled={busy} onChange={e => setDueDate(e.target.value)} /></label>}<p className="assignment-deadline">Заполнить до <strong>{dateLabel(dueDate, {year:"numeric"})}</strong> включительно</p><p className="hint">{definition?.form.respondent === "DOCTOR" ? "Эту шкалу заполняет врач. Пациенту не нужно отвечать самостоятельно." : "Пациент получит уведомление, если подключил его на устройстве."}</p><div className="form-footer"><Button type="submit" busy={busy} disabled={!definition}>{definition?.form.respondent === "DOCTOR" ? "Добавить врачебную оценку" : "Назначить пациенту"}</Button></div></form></>}
    {panel === "answers" && current && definition && <><Badge>{assignmentLabels[current.status]}</Badge><DefinitionNotice form={definition.form} />{definition.form.respondent === "DOCTOR" && (current.status === "ASSIGNED" || current.status === "IN_PROGRESS") ? <ResponseEditor key={current.id} assignment={current} form={definition.form} onBusy={setBusy} onSaved={refresh} initialDraft={responseDrafts[current.id]} onDraftChange={cacheResponseDraft} /> : <AssignmentAnswers assignment={current} form={definition.form} />}{current.submission?.notification && <NotificationGuidance event={{notification:current.submission.notification,source:{form:{version:definition.form.version}}}} />}{current.submission && <LlmSummary key={current.id} patientId={patientId} assignmentId={current.id} />}{(current.status === "ASSIGNED" || current.status === "IN_PROGRESS") && <div className="form-footer"><Button variant="quiet" onClick={() => { setReason(""); setPanel("cancel"); }}>Отменить назначение</Button></div>}</>}
    {panel === "cancel" && <form onSubmit={cancel}><label className="field"><span>Причина отмены</span><textarea value={reason} onChange={e => setReason(e.target.value)} required minLength={3} maxLength={1000} disabled={busy} /></label><div className="form-footer"><Button variant="quiet" disabled={busy} onClick={() => setPanel("answers")}>Назад</Button><Button type="submit" busy={busy}>Подтвердить отмену</Button></div></form>}
  </Drawer></section>;
}
