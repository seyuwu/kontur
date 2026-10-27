"use client";
import { pushLabels } from "@/lib/push";
export function PushStatus({ deliveries }: { deliveries: { id: string; device: string; status: string; attempts: number }[] }) {
  return <details className="assessment-source"><summary>Push на устройства · {deliveries.length ? `${deliveries.length} в журнале отправки` : "отправка не создавалась"}</summary>
    {deliveries.length ? <ul className="push-event-list">{deliveries.map(d => <li key={d.id}><strong>{d.device}</strong><span>{pushLabels[d.status] ?? "Обновите событие"} · попыток: {d.attempts}</span></li>)}</ul> : <p className="secondary-text small-text">В момент появления события не было подключённых устройств или push-канал был отключён. Настройки доступны по значку телефона в верхней панели.</p>}
    <p className="secondary-text small-text">Это технический статус уведомления. Прочтение и разбор события врачом фиксируются отдельно в кабинете.</p>
  </details>;
}
