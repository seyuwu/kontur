"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MessageSquare, Send, ArrowDown } from "lucide-react";
import type { MessageData, MessagePage, PatientData } from "@/lib/types";
import { dateLabel, timeLabel } from "@/lib/format";
import { command } from "@/lib/client";
import { Button, EmptyState } from "@/components/ui/primitives";

function mergeMessages(current: MessageData[], incoming: MessageData[]) {
  const byId = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) byId.set(message.id, { ...message, readAt: message.readAt ?? byId.get(message.id)?.readAt ?? null });
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function Conversation({ patient, actorId, refresh, onSuccess, draft, onDraftChange }: { patient: PatientData; actorId: string; refresh: () => Promise<void>; onSuccess: (message: string) => void; draft: string; onDraftChange: (text: string) => void }) {
  const text = draft; const setText = onDraftChange;
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [needsContact,setNeedsContact]=useState(false);
  const requestKey = useRef<string | null>(null);
  const messages = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const logSize = useRef({width:0,height:0});
  const [atLatest, setAtLatest] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const lastTail = useRef<string | undefined>(undefined);
  const input = useRef<HTMLTextAreaElement>(null);
  function goLatest() { const log = messages.current; if (!log) return; followLatest.current = true; log.scrollTop = log.scrollHeight; setAtLatest(true); setNewCount(0); }
  useLayoutEffect(() => { const field = input.current; if (field) { field.style.height = "auto"; field.style.height = `${Math.min(field.scrollHeight, 120)}px`; } }, [text]);
  useEffect(() => {
    const log = messages.current; if (!log) return;
    logSize.current = {width:log.clientWidth,height:log.clientHeight};
    const observer = new ResizeObserver(() => {
      if (followLatest.current) log.scrollTop = log.scrollHeight;
      logSize.current = {width:log.clientWidth,height:log.clientHeight};
    });
    observer.observe(log); return () => observer.disconnect();
  }, []);
  const [loadedMessages, setLoadedMessages] = useState(patient.messages);
  const [hasEarlier, setHasEarlier] = useState(patient.messages.length === 50);
  const historyStarted = useRef(false);
  const [historyBusy, setHistoryBusy] = useState(false); const [historyError, setHistoryError] = useState("");
  const [readError, setReadError] = useState(""); const [readRetry, setReadRetry] = useState(0);
  const reading = useRef(false); const readBlocked = useRef(false);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  useEffect(() => { setLoadedMessages(current => mergeMessages(current, patient.messages)); if (!historyStarted.current && patient.messages.length === 50) setHasEarlier(true); }, [patient.messages]);
  useLayoutEffect(() => {
    const log = messages.current; if (!log) return;
    const tail = loadedMessages.at(-1)?.id;
    if (!followLatest.current && lastTail.current && tail !== lastTail.current) {
      const previous = loadedMessages.findIndex(m => m.id === lastTail.current);
      if (previous >= 0) setNewCount(count => count + loadedMessages.slice(previous + 1).filter(m => m.senderId !== actorId).length);
    }
    lastTail.current = tail;
    if (anchor.current) { log.scrollTop = anchor.current.top + log.scrollHeight - anchor.current.height; anchor.current = null; }
    else if (followLatest.current) { log.scrollTop = log.scrollHeight; setNewCount(0); }
  }, [loadedMessages.length, loadedMessages.at(-1)?.id, actorId]);
  useEffect(() => {
    if (!atLatest || document.hidden) return;
    const ids = loadedMessages.filter(m => m.senderId !== actorId && !m.readAt).slice(0, 50).map(m => m.id);
    if (!ids.length || reading.current || readBlocked.current) return;
    reading.current = true;
    void command({ action: "read-messages", patientId: patient.id, messageIds: ids }).then(async () => {
      reading.current = false; setReadError(""); const now = new Date().toISOString();
      setLoadedMessages(current => current.map(m => ids.includes(m.id) ? { ...m, readAt: m.readAt ?? now } : m)); await refresh();
    }).catch(() => { reading.current = false; readBlocked.current = true; setReadError("Не удалось отметить загруженные сообщения прочитанными."); });
  }, [loadedMessages, patient.id, actorId, refresh, readRetry, atLatest]);
  async function loadEarlier() {
    if (historyBusy || !loadedMessages.length) return; setHistoryBusy(true); setHistoryError("");
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patient.id)}/messages?before=${encodeURIComponent(loadedMessages[0].id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Не удалось загрузить ранние сообщения. Повторите попытку.");
      const page: MessagePage = await response.json();
      historyStarted.current = true;
      if (messages.current && page.messages.length) { anchor.current = { height: messages.current.scrollHeight, top: messages.current.scrollTop }; followLatest.current = false; }
      setLoadedMessages(current => mergeMessages(current, page.messages)); setHasEarlier(!!page.nextCursor);
    } catch (e) { setHistoryError(e instanceof TypeError ? "Нет связи с сервером. Ранее загруженные сообщения сохранены на экране." : (e as Error).message); }
    finally { setHistoryBusy(false); }
  }
  async function send(event: React.FormEvent) {
    event.preventDefault(); if (!text.trim() || busy) return;
    setBusy(true); setError("");
    requestKey.current ??= crypto.randomUUID();
    try { await command({ action: "message", patientId: patient.id, text, requestKey: requestKey.current, ...(patient.userId===actorId ? {needsContact} : {}) }); requestKey.current = null; followLatest.current = true; setText("");setNeedsContact(false); await refresh(); onSuccess("Сообщение сохранено в переписке"); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="surface message-layout" aria-label="Переписка"><div className="surface-header"><h2>Переписка</h2></div>
    <div className="conversation-log-area"><div ref={messages} className="messages" role="log" aria-label="Сообщения" tabIndex={0} onScroll={event => { const pane = event.currentTarget;
      const resized = pane.clientWidth !== logSize.current.width || pane.clientHeight !== logSize.current.height;
      if (resized && followLatest.current) { pane.scrollTop = pane.scrollHeight; return; }
      const latest = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 72; followLatest.current = latest; setAtLatest(latest); if (latest) setNewCount(0); }}><div className="conversation-history">{hasEarlier && <Button variant="quiet" busy={historyBusy} onClick={() => void loadEarlier()}>Показать более ранние сообщения</Button>}{historyError && <p className="form-error" role="alert">{historyError}</p>}{readError && <p className="form-error" role="status">{readError}<Button variant="quiet" onClick={() => { readBlocked.current = false; setReadRetry(n => n + 1); }}>Повторить отметку прочтения</Button></p>}</div>{!loadedMessages.length && <EmptyState icon={<MessageSquare size={25} />} title="Начните разговор" />}{loadedMessages.map(message => <div key={message.id} className={`message ${message.senderId === actorId ? "is-own" : ""}`}><div className="message-author">{message.senderId === actorId ? "Вы" : message.sender.name}</div><div className="message-bubble">{message.text}</div><div className="message-time">{dateLabel(message.createdAt)} в {timeLabel(message.createdAt)}{message.senderId === actorId && (message.readAt ? " · Прочитано" : " · Сохранено")}</div></div>)}</div>
    {!atLatest && <Button variant="secondary" className="conversation-latest" onClick={goLatest}><ArrowDown size={15} aria-hidden="true" />{newCount ? `Новые сообщения · ${newCount}` : "К последним сообщениям"}</Button>}</div>
    <div className="conversation-compose-area">{error && <div className="form-error" role="alert">{error}</div>}
    <form className="message-compose" onSubmit={send}><textarea ref={input} aria-label="Текст сообщения" disabled={busy} placeholder="Написать сообщение…" value={text} onChange={e => { requestKey.current = null; setText(e.target.value); }} maxLength={4000} rows={1} /><Button type="submit" aria-label="Отправить сообщение" busy={busy} disabled={!text.trim()}><Send size={17} /></Button></form>
    {patient.userId===actorId && <label className="check-row chat-contact"><input type="checkbox" disabled={busy} checked={needsContact} onChange={e=>{setNeedsContact(e.target.checked);requestKey.current=null;}} />Попросить врача связаться со мной при отправке сообщения</label>}
    <p className="chat-disclaimer">Ответ может прийти позже. Этот чат не является каналом экстренной помощи.</p></div>
  </section>;
}
