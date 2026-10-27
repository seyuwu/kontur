"use client";
import { useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button, Drawer, TextLink } from "@/components/ui/primitives";
import { visitLabel, visitTimeValue, visitDateValue } from "@/lib/appointment";
import { apiCommand } from "@/lib/client";
import type { PatientData } from "@/lib/types";

export function AppointmentCard({ patient, onSaved }: { patient: PatientData; onSaved: () => Promise<void> }) {
  const [editor, setEditor] = useState<{ date: string; time: string; planId: string | null; nextVisit: string | null }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const key = useRef<string | null>(null);
  function open() { setError(""); key.current = null; setEditor({ date: visitDateValue(patient.nextVisit), time:patient.nextVisitHasTime ? visitTimeValue(patient.nextVisit) : "", planId: patient.currentPlanId ?? null, nextVisit: patient.nextVisit ?? null }); }
  async function save(date: string | null) {
    if (!editor || busy) return;
    setBusy(true); setError(""); key.current ??= crypto.randomUUID();
    try { await apiCommand("/api/care", { action: "schedule-visit", patientId: patient.id, date, time:date ? editor.time : null, expectedPlanId: editor.planId, expectedNextVisit: editor.nextVisit, requestKey: key.current }); await onSaved(); setEditor(undefined); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="overview-contact"><h2><CalendarDays size={16} />Следующий приём</h2><strong>{visitLabel(patient.nextVisit,patient.nextVisitHasTime)}</strong><TextLink onClick={open}>{patient.nextVisit ? "Изменить приём" : "Назначить приём"}</TextLink>
    <Drawer open={!!editor} title="Дата следующего приёма" description={patient.name} dismissDisabled={busy} onClose={() => setEditor(undefined)}>
      {error && <p className="form-error" role="alert">{error}</p>}
      {editor && <form onSubmit={e => { e.preventDefault(); void save(editor.date); }}><label className="field"><span>Дата приёма</span><input required type="date" value={editor.date} disabled={busy} onChange={e => { key.current = null; setEditor({ ...editor, date: e.target.value }); }} /></label><label className="field"><span>Время приёма · Москва</span><input required type="time" value={editor.time} disabled={busy} onChange={e=>{key.current=null;setEditor({...editor,time:e.target.value});}} /></label><div className="form-footer">{editor.nextVisit && <Button variant="quiet" disabled={busy} onClick={() => { key.current = null; void save(null); }}>Отменить приём</Button>}<Button type="submit" busy={busy}>Сохранить</Button></div></form>}
    </Drawer>
  </div>;
}
