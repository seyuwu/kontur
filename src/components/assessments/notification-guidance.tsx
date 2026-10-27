import { Badge } from "@/components/ui/primitives";
import { guidanceSources, notificationLabels, type GuidanceSourceId } from "@/lib/assessment-notifications";
import type { ReviewEventData } from "@/lib/assessments";

export function GuidanceSources({ ids }: { ids: GuidanceSourceId[] }) {
  return <details className="assessment-source"><summary>Документы и основание рекомендации</summary><ul>{ids.map(id => {
    const source = guidanceSources[id];
    return <li key={id}><a className="text-link" href={source.url} target="_blank" rel="noopener noreferrer">{source.title} · {source.reference}</a><p className="secondary-text small-text">{source.scope}</p></li>;
  })}</ul><p className="secondary-text small-text">Справочные материалы для врача. Правила уведомлений требуют клинической проверки.</p></details>;
}
export function NotificationGuidance({ event }: { event: { notification?: ReviewEventData["notification"]; source: { form: { version: number } } } }) {
  if (!event.notification) return null;
  const note = event.notification;
  return <section className="guideline-review" aria-label="Рекомендация по результату анкеты">
    {(note.kind === "HIGH" || note.kind === "SAFETY") && <Badge tone="amber">{notificationLabels[note.kind]}</Badge>}
    <h3>Рекомендация врачу по этому результату</h3><p>{note.recommendation}</p>
    
    <GuidanceSources ids={note.sourceIds} />
  </section>;
}
