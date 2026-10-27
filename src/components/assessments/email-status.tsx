"use client";
import { useEffect, useRef, useState } from "react";
import type { ReviewEventData } from "@/lib/assessments";
import { dateLabel } from "@/lib/format";
import { apiCommand } from "@/lib/client";
import { Button } from "@/components/ui/primitives";
const labels: Record<string, string> = { PENDING: "Ожидает отправки", SENDING: "Передаётся почтовому серверу", ACCEPTED: "Почтовый сервер принял письмо", FAILED: "Передача не выполнена", UNCERTAIN: "Результат передачи неизвестен", NOT_CONFIGURED: "Почта не подключена", CANCELLED: "Передача отменена" };
export function EmailStatus({ event, refresh, busy, onBusy }: { event: ReviewEventData; refresh: () => Promise<unknown>; busy: boolean; onBusy: (v: boolean) => void }) {
  const [error, setError] = useState(""); const [risk, setRisk] = useState(false); const key = useRef<string | null>(null); const delivery = event.delivery;
  useEffect(() => { key.current = null; setRisk(false); }, [delivery?.revision]);
  async function retry() { if (busy) return; onBusy(true); setError(""); key.current ??= crypto.randomUUID(); try { await apiCommand("/api/review-events", { action: "retry-email", eventId: event.id, revision: delivery?.revision ?? 0, requestKey: key.current, duplicateRisk: risk }); await refresh(); } catch (e) { setError((e as Error).message); await refresh(); } finally { onBusy(false); } }
  const canRetry = event.emailEnabled && event.status !== "RESOLVED" && (!delivery || ["FAILED", "NOT_CONFIGURED", "UNCERTAIN"].includes(delivery.status));
  return <details className="assessment-source"><summary>Почта · {delivery ? labels[delivery.status] ?? delivery.status : "задание не создавалось"}</summary>
    <p className="secondary-text small-text">Событие доступно в кабинете независимо от email. Приём письма почтовым сервером не подтверждает доставку в почтовый ящик, прочтение или реакцию врача.</p>
    {delivery && <p className="small-text">Попыток: {delivery.attempts}. Обновлено {dateLabel(delivery.updatedAt, { hour: "2-digit", minute: "2-digit" })}{delivery.nextAttemptAt ? ` · технический повтор после ${dateLabel(delivery.nextAttemptAt, { hour: "2-digit", minute: "2-digit" })}` : ""}.</p>}
    {!event.emailEnabled && <p className="hint">Отправка по почте отключена или не настроена.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}{canRetry && <>{delivery?.status === "UNCERTAIN" && <label className="check-row"><input type="checkbox" checked={risk} disabled={busy} onChange={e => setRisk(e.target.checked)} />Я проверил канал: повтор может создать дубликат письма</label>}<Button variant="secondary" disabled={busy || (delivery?.status === "UNCERTAIN" && !risk)} onClick={() => void retry()}>Повторить отправку письма</Button></>}
  </details>;
}
