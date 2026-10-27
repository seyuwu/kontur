"use client";
import { SummaryText } from "./summary-text";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { apiCommand } from "@/lib/client";
import { useCareResource } from "./use-care-resource";
import type { createSummary } from "@/modules/summaries";
import { dateLabel } from "@/lib/format";
const automaticAttempts = new Map<string, {count:number; after:number}>();
type Result = Awaited<ReturnType<typeof createSummary>>;
export function LlmSummary({ patientId, eventId, assignmentId, sourceVersion }: { patientId: string; eventId?: string; assignmentId?: string; sourceVersion?: number }) {
  const query = new URLSearchParams({patientId,...(eventId ? {eventId} : {}),...(assignmentId ? {assignmentId} : {})}).toString();
  const config = useCareResource<{ enabled: boolean; reason: string; model: string; saved?: Result | null; fingerprint?:string | null; stale?:boolean }>(`/api/summaries?${query}`);
  const [generated, setGenerated] = useState<{key:string;result:Result}>(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const activeQuery = useRef(query); activeQuery.current = query;
  const inFlight = useRef(false);
  const local = generated?.key === query ? generated.result : undefined;
  const stored = config.data?.saved ?? undefined;
  const candidate = local && (!stored || local.generatedAt >= stored.generatedAt) ? local : stored;
  const result = candidate?.facts.length ? candidate : undefined;
  useEffect(() => { setError(""); }, [patientId, eventId, assignmentId, sourceVersion]);
  async function generate(automatic = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const next = await apiCommand<Result>("/api/summaries", { patientId, eventId, assignmentId, automatic });
      if (activeQuery.current === query) { setGenerated({key:query,result:next}); await config.refresh(); }
    }
    catch (e) { if (activeQuery.current === query) setError((e as Error).message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const fingerprint = config.data?.fingerprint;
  const stale = config.data?.stale && (!result?.facts.length || result.sourceFingerprint !== fingerprint || result.generation === "RULES");
  useEffect(() => {
    if (!config.data?.enabled || !stale || !fingerprint || busy || document.hidden) return;
    const key = `${query}:${fingerprint}`;
    const attempt = automaticAttempts.get(key);
    if (attempt && (attempt.count >= 3 || attempt.after > Date.now())) return;
    const timer = setTimeout(() => {
      if (document.hidden || inFlight.current) return;
      automaticAttempts.set(key, {count:(attempt?.count ?? 0)+1, after:Date.now()+60000});
      if (automaticAttempts.size > 200) automaticAttempts.delete(automaticAttempts.keys().next().value!);
      void generate(true);
    }, 1500);
    return () => clearTimeout(timer);
    // Resource polling rechecks retry deadlines; unchanged sources never call the model again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, fingerprint, stale, busy, config.data]);
  const title = assignmentId ? "Обобщение анкеты" : eventId ? "Обобщение события" : "Обобщение для врача";
  return <section className="surface llm-summary" aria-label={title}><div className="surface-header"><h2>{title}</h2><Button variant="secondary" busy={busy} disabled={!config.data?.enabled} onClick={() => void generate()}>Обобщить</Button></div><div className="surface-body">

    {config.error && <p className="form-error" role="alert">{config.error}</p>}
    {config.data && !config.data.enabled && <p className="hint">{config.data.reason}</p>}
    {!config.data && config.loading && <p className="secondary-text small-text" role="status">Загружаем сохранённое обобщение…</p>}
    {busy && <p className="secondary-text small-text" role="status">{result ? "Обновляем обобщение…" : "Готовим обобщение…"}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {result?.generation === "RULES" && <p className="secondary-text small-text" role="status">Показаны рассчитанные результаты анкет. Обобщение пока недоступно.</p>}
    {result && <><p className="secondary-text small-text">Сохранено {dateLabel(result.generatedAt, { hour: "2-digit", minute: "2-digit" })}</p>
      {!result.facts.length && <p>Недостаточно данных для проверяемой сводки.</p>}
      {["Главное", "Сравнение с прошлым", "Связь с другими данными"].map(title => {
        const facts = result.facts.filter(fact => {
          const roles = fact.evidence.map(cite => result.sources.find(source => source.id === cite.sourceId)?.role);
          const group = roles.includes("PREVIOUS") ? "Сравнение с прошлым" : roles.includes("PRIMARY") && (roles.includes("RELATED") || roles.includes("CONTEXT")) ? "Связь с другими данными" : "Главное";
          return group === title;
        });
        return !!facts.length && <section key={title} className="summary-block" aria-label={title}><h3>{title}</h3><ol className="summary-facts">{facts.map((fact, i) => <li key={i}>
        <SummaryText text={fact.text} />
        <details className="summary-evidence"><summary>Источники · {fact.evidence.length}</summary>{fact.evidence.map((cite, j) => <blockquote key={j}><strong>{result.sources.find(s => s.id === cite.sourceId)?.label}</strong><p>{cite.quote}</p></blockquote>)}</details>
      </li>)}</ol></section>; })}
      {!!result.actions.length && <section className="summary-block summary-actions" aria-label="Предлагаемые действия"><h3>Предлагаемые действия</h3><ul>{result.actions.map(action => <li key={action.id}><strong>{action.label}</strong><SummaryText text={action.description} /></li>)}</ul><p className="secondary-text small-text">Решение принимает врач.</p></section>}
      {!!result.limitations.length && <section className="summary-block summary-unknowns" aria-label="Что нужно уточнить"><h3>Что нужно уточнить</h3><ul>{result.limitations.map((limitation, i) => <li key={i}><SummaryText text={limitation} /></li>)}</ul></section>}
    </>}
    <details className="assessment-source"><summary>Как составлено обобщение</summary><p className="secondary-text small-text">{assignmentId ? "В основе — текущая анкета. Для сравнения используются до 3 прошлых результатов той же методики и до 2 других анкет, общие сведения и текущий план. Переписка не включается. " : eventId ? "Обобщение по выбранному событию и ответам анкеты, на основании которой оно создано. " : "Сводка составлена по доступным данным пациента. "}Баллы и события рассчитываются правилами. Проверьте вывод по источникам перед решением.</p></details>
  </div></section>;
}
