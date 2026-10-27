"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ClipboardList } from "lucide-react";
import type { ReviewEventData, ReviewWorkspaceData } from "@/lib/assessments";
import { apiCommand } from "@/lib/client";
import { dateLabel } from "@/lib/format";
import { notificationLabels } from "@/lib/assessment-notifications";
import { Badge, Button, Drawer } from "@/components/ui/primitives";
import { useCareResource } from "./use-care-resource";
import { NotificationGuidance } from "./notification-guidance";
import { GuidelineReview } from "./guideline-review";
import { AnswerList, DefinitionNotice } from "./shared";
import { LlmSummary } from "./llm-summary";
import type { ReviewDraft } from "./review-decision";
export type { ReviewDraft } from "./review-decision";

export function ReviewInbox({ patientId, embedded = false, active = true, showEmpty = false, onConversation, onPatientData }: { patientId?: string; embedded?: boolean; active?: boolean; showEmpty?: boolean; drafts: Record<string, ReviewDraft>; onDraft: (id: string, value: ReviewDraft) => void; onConversation: (patientId: string) => void; onPatientData: (patientId: string) => void }) {
  const [cursor, setCursor] = useState<string>();
  const list = useCareResource<ReviewWorkspaceData>(`/api/review-events?status=${!patientId && showEmpty ? "UNREAD" : "ALL"}${patientId ? `&patientId=${encodeURIComponent(patientId)}` : ""}${cursor ? `&cursor=${cursor}` : ""}`, active);
  const [selectedId, setSelectedId] = useState<string | null>(null), [open, setOpen] = useState(false);
  const detail = useCareResource<ReviewEventData>(`/api/review-events?eventId=${selectedId ?? ""}`, active && open && !!selectedId);
  const viewed = useRef(new Set<string>());
  const [viewError, setViewError] = useState("");
  const event = detail.data && (!patientId || detail.data.patientId === patientId) ? detail.data : undefined;
  useEffect(() => {
    if (!open || !event || event.viewedAt || viewed.current.has(event.id)) return;
    const id = event.id; viewed.current.add(id); setViewError("");
    void apiCommand("/api/review-events", { action: "view", eventId: id }).then(() => list.refresh()).catch(() => { viewed.current.delete(id); setViewError("Не удалось сохранить отметку просмотра."); });
  }, [open, event?.id, event?.viewedAt, list.refresh]);
  useEffect(() => { setSelectedId(null); setOpen(false); setCursor(undefined); }, [patientId]);
  useEffect(() => { if (!active) setOpen(false); }, [active]);
  useEffect(() => { if (!active) return; const url = new URL(window.location.href), id = url.searchParams.get("event"); if (id && id.length <= 100 && (url.searchParams.get("patient") ?? undefined) === patientId) { setSelectedId(id); setOpen(true); } }, [patientId, active]);
  function close() { setOpen(false); const url = new URL(window.location.href); if (url.searchParams.has("event")) { url.searchParams.delete("event"); history.replaceState(history.state, "", url); } }
  if (!active || (!showEmpty && !open && !list.error && !list.data?.events.length)) return null;
  return <section className={`surface review-inbox${embedded ? " review-inbox-embedded" : ""}`} aria-label="Результаты анкет">
    <div className="surface-header"><h2>Результаты анкет</h2><Button variant="quiet" disabled={list.loading} onClick={() => void list.refresh()}>Обновить</Button></div>
    <div className="surface-body">{list.error && <p className="form-error" role="alert">{list.error}</p>}
      {list.data?.events.map(item => <button type="button" className="assessment-row review-row" key={item.id} onClick={() => { setSelectedId(item.id); setOpen(true); }}><span className="review-state-icon"><ClipboardList size={18} aria-hidden="true" /></span><span className="assessment-row-copy"><strong>{item.title.split(":")[0]}</strong>{!item.viewedAt && item.status !== "RESOLVED" && <Badge>Новый</Badge>}{(item.notificationKind === "HIGH" || item.notificationKind === "SAFETY") && <Badge tone="amber">{notificationLabels[item.notificationKind]}</Badge>}<span>{!patientId && `${item.patientName} · `}{dateLabel(item.createdAt, { hour: "2-digit", minute: "2-digit" })}</span></span><ArrowUpRight size={18} aria-hidden="true" /></button>)}
      {list.data && !list.data.events.length && <p className="secondary-text">Результатов пока нет.</p>}
      <div className="assessment-pagination">{cursor && <Button variant="quiet" onClick={() => setCursor(undefined)}>К новым</Button>}{list.data?.nextCursor && <Button variant="quiet" onClick={() => setCursor(list.data!.nextCursor!)}>Более ранние</Button>}</div>
    </div>
    <Drawer open={open} title={event?.source.form.title ?? "Результат анкеты"} description={event?.patientName} onClose={close}>
      {detail.loading && !event && <p role="status">Загружаем результат…</p>}{detail.error && <p className="form-error" role="alert">{detail.error}</p>}
      {viewError && <p className="form-error" role="status">{viewError}</p>}
      {event && <>
        <GuidelineReview form={event.source.form} metric={event.source.metric} />
        {!event.source.form.provenance && <div className="assessment-result"><strong>{event.source.metric.label}: {event.source.metric.value}</strong><p>{event.source.metric.interpretation}</p></div>}
        <NotificationGuidance event={event} />
        {!event.notification && <section className="guideline-review"><h3>Рекомендации врачу</h3><ul>{event.actions.map(action => <li key={action.id}>{action.kind === "REVIEW_ANSWERS" ? "Посмотреть исходные ответы" : action.label}</li>)}</ul></section>}
        <details className="assessment-source"><summary>Исходные ответы</summary><AnswerList form={event.source.form} answers={event.source.answers} note={event.source.note} /></details>
        <details className="assessment-source"><summary>Методика и источник</summary><DefinitionNotice form={event.source.form} /></details>
        <LlmSummary patientId={event.patientId} assignmentId={event.source.assignmentId} />
        <div className="care-actions"><Button variant="secondary" onClick={() => { close(); onConversation(event.patientId); }}>Написать пациенту</Button><Button variant="quiet" onClick={() => { close(); onPatientData(event.patientId); }}>Данные пациента</Button></div>
      </>}
    </Drawer>
  </section>;
}
