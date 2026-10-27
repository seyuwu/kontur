"use client";
import type { ReviewContext } from "@/lib/review";
import { dateLabel } from "@/lib/format";
import { Button } from "@/components/ui/primitives";
import { dailyLabels } from "@/modules/follow-up/contract";

export function ReviewContextView({ context, onSource, showLatest = false }: { context: ReviewContext; onSource: (kind: "profile" | "plan", id: string) => void; showLatest?: boolean }) {
  return <div className="decision-context">
    <div className="decision-sources">{context.profile ? <Button variant="secondary" onClick={() => onSource("profile", context.profile!.id)}>Сведения · версия {context.profile.version}</Button> : <p>Клинические сведения пока не внесены.</p>}{context.plan ? <Button variant="secondary" onClick={() => onSource("plan", context.plan!.id)}>План · версия {context.plan.version}</Button> : <p>План наблюдения пока не подтверждён.</p>}</div>
    {!!context.unknowns.length && <div className="hint"><strong>Что ещё не уточнено</strong><ul>{context.unknowns.map(text => <li key={text}>{text}</li>)}</ul><span>Неизвестные сведения не означают отсутствие рисков.</span></div>}
    <details className="assessment-source" open={showLatest || undefined}><summary>Последние поступившие данные</summary><p className="secondary-text small-text">По одной последней записи каждого вида. Полная история — в карточке пациента.</p>
      {context.latestObservation ? <div className="decision-entry"><strong>Самоотчёт пациента</strong><small>{dateLabel(context.latestObservation.createdAt, { hour: "2-digit", minute: "2-digit" })} · со слов пациента</small>{context.latestObservation.note && <p>{context.latestObservation.note}</p>}{context.latestObservation.needsContact && <p>Пациент просит связаться.</p>}</div> : <p>Отметок самочувствия пока нет.</p>}
      {context.latestSubmission && <div className="decision-entry"><strong>Анкета · {context.latestSubmission.title}</strong><small>{dateLabel(context.latestSubmission.createdAt)}</small></div>}
      {context.latestMessage ? <div className="decision-entry"><strong>Последнее сообщение пациента</strong><small>{dateLabel(context.latestMessage.createdAt, { hour: "2-digit", minute: "2-digit" })}</small><p>{context.latestMessage.text}</p></div> : <p>Входящих сообщений пока нет.</p>}
      {context.latestDailyReport && <div className="decision-entry"><strong>Ежедневная задача · {context.latestDailyReport.title}</strong><small>{dateLabel(context.latestDailyReport.date)} · {dailyLabels[context.latestDailyReport.state]} со слов пациента</small>{context.latestDailyReport.note && <p>{context.latestDailyReport.note}</p>}</div>}
      {context.latestConcern && <div className="decision-entry"><strong>Сообщение об изменении · {context.latestConcern.title}</strong><small>{dateLabel(context.latestConcern.createdAt)}</small><p>{context.latestConcern.description}</p></div>}
    </details>
  </div>;
}
