"use client";
import {regimenLabel} from "@/lib/medication-regimen";
import {appointmentLabel} from "@/lib/appointment";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { CarePlanData, CareHistory } from "@/lib/care";
import { dateLabel } from "@/lib/format";
import { Badge, Button, Drawer } from "@/components/ui/primitives";
import { useCareResource } from "@/components/assessments/use-care-resource";
export const reportLabels = { DONE: "Выполнено со слов пациента", NOT_DONE: "Пока не выполнено", NEEDS_HELP: "Есть вопрос врачу" };
export function PlanContent({ plan }: { plan: Pick<CarePlanData, "goal" | "instructions" | "nextContactDate" | "appointment" | "tasks"> }) {
  return <div className="care-content"><h3>{plan.goal}</h3><p className="care-prose">{plan.instructions}</p>{plan.nextContactDate && <p className="care-contact">Дата следующего приёма · <strong>{plan.appointment ? appointmentLabel(plan.appointment) : dateLabel(plan.nextContactDate)}</strong></p>}
    {!!plan.tasks.length && <><h3>Задачи до контакта</h3><ol className="care-tasks">{plan.tasks.map(task => <li key={task.id}><strong>{task.title}{task.medication?.regimen ? ` · ${regimenLabel(task.medication.regimen)}` : task.repeat ? " · ежедневно" : ""}</strong>{task.details && <p className="care-prose">{task.details}</p>}<p className="secondary-text small-text">{task.kind === "MEDICATION" ? `Лекарство · ${task.medication?.dose ?? ""}${task.startDate ? ` · с ${dateLabel(task.startDate)}` : ""}${task.time ? ` · в ${task.time} (Москва)` : ""}` : task.kind === "ASSESSMENT" ? "Анкета" : "Задача наблюдения"}{task.dueDate ? ` · до ${dateLabel(task.dueDate)}` : ""}</p>{task.report && <p className="care-report"><strong>{reportLabels[task.report.state]}</strong>{task.report.note && <span>{task.report.note}</span>}<span>{dateLabel(task.report.createdAt)} · план v{task.report.planVersion}</span></p>}</li>)}</ol></>}
  </div>;
}
export function PlanHistory({ patientId, open, onClose, onProfileVersion }: { patientId: string; open: boolean; onClose: () => void; onProfileVersion?: (id: string) => void }) {
  const [cursor, setCursor] = useState<string>(); const [selected, setSelected] = useState("");
  const base = `/api/care?patientId=${encodeURIComponent(patientId)}`;
  const history = useCareResource<CareHistory>(`${base}&view=history${cursor ? `&cursor=${cursor}` : ""}`, open && !selected);
  const version = useCareResource<CarePlanData>(`${base}&versionId=${encodeURIComponent(selected)}`, open && !!selected);
  const resource = selected ? version : history;
  return <Drawer open={open} title="История плана наблюдения" onClose={onClose}>
    {selected && <Button variant="quiet" onClick={() => setSelected("")}>К версиям плана</Button>}
    {resource.error && <div role="alert" className="form-error">{resource.error}<Button variant="quiet" onClick={() => void resource.refresh()}>Повторить</Button></div>}
    {resource.loading && !resource.data && <p role="status">Загружаем историю…</p>}
    {selected ? version.data && <><Badge>{version.data.isCurrent ? "Действующий план" : "Архивная версия"} · v{version.data.version}</Badge><p className="hint">Подтвердил: {version.data.confirmedBy} · {dateLabel(version.data.confirmedAt)}. Показаны последние отметки, оставленные в этой или более ранней версии; статус связанной анкеты может измениться позже.</p><PlanContent plan={version.data} />{version.data.clinicalProfileVersionId && onProfileVersion && <Button variant="quiet" onClick={() => onProfileVersion(version.data!.clinicalProfileVersionId!)}>Сведения на момент подтверждения</Button>}</> : history.data?.versions.map(plan => <button type="button" className="assessment-row" key={plan.id} onClick={() => setSelected(plan.id)}><span className="assessment-row-copy"><strong>Версия {plan.version} · {plan.goal}</strong><span>{dateLabel(plan.confirmedAt)} · {plan.confirmedBy}</span></span><ArrowUpRight size={17} aria-hidden="true" /></button>)}
    {!selected && <div className="assessment-pagination">{cursor && <Button variant="quiet" onClick={() => setCursor(undefined)}>К последним версиям</Button>}{history.data?.nextCursor && <Button variant="quiet" onClick={() => setCursor(history.data!.nextCursor!)}>Более ранние</Button>}</div>}
  </Drawer>;
}
