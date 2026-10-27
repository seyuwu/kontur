"use client";
import { useId, useState, type ReactNode } from "react";
import { PrescriptionActionContext } from "./prescription-actions";
import { ClipboardList, Pill } from "lucide-react";

export function PrescriptionWorkspace({ view, onView, questionnaires, treatment }: {
  view: "questionnaires" | "treatment";
  onView: (view: "questionnaires" | "treatment") => void;
  questionnaires: ReactNode; treatment: ReactNode;
}) {
  const id = useId();
  const [actionHost,setActionHost]=useState<HTMLDivElement|null>(null);
  const items = [{ value: "questionnaires", label: "Анкеты", icon: ClipboardList }, { value: "treatment", label: "Лечение и задачи", icon: Pill }] as const;
  return <PrescriptionActionContext.Provider value={{host:actionHost,view}}><section className="surface doctor-prescriptions" aria-label="Назначения пациенту">
    <div className="prescriptions-heading"><div className="prescriptions-title-row"><h2>Назначения пациенту</h2><div className="prescriptions-action" ref={setActionHost}/></div>
      <div className="prescription-switch" role="tablist" aria-label="Тип назначений">
        {items.map((item, index) => <button key={item.value} type="button" role="tab" id={`${id}-${item.value}`} aria-controls={`${id}-${item.value}-panel`} aria-selected={view === item.value} tabIndex={view === item.value ? 0 : -1} onClick={() => onView(item.value)} onKeyDown={e => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
          e.preventDefault(); const next = items[e.key === "Home" ? 0 : e.key === "End" ? 1 : 1 - index];
          onView(next.value); document.getElementById(`${id}-${next.value}`)?.focus();
        }}><item.icon size={16} aria-hidden="true" />{item.label}</button>)}
      </div>
    </div>
    {items.map(item => <div key={item.value} role="tabpanel" id={`${id}-${item.value}-panel`} aria-labelledby={`${id}-${item.value}`} hidden={view !== item.value}>{item.value === "questionnaires" ? questionnaires : treatment}</div>)}
  </section></PrescriptionActionContext.Provider>;
}
