import {regimenLabel} from "@/lib/medication-regimen";
import { appointmentLabel, readAppointment, visitDate } from "@/lib/appointment";
import type { CarePlanData } from "@/lib/care";
import { dateLabel } from "@/lib/format";
type Identity = { name: string; publicId: string; birthDate: string };
export function careDocumentText(plan: CarePlanData, patient: Identity, audience: "doctor" | "patient", demo: boolean) {
  const lines = [audience === "doctor" ? "Проект записи по подтверждённому плану" : "Памятка по плану наблюдения", `${patient.name} · ${patient.publicId}`, `Дата рождения: ${dateLabel(patient.birthDate, { year: "numeric" })}`, `План · версия ${plan.version}`, `Подтвердил: ${plan.confirmedBy} · ${dateLabel(plan.confirmedAt, { year: "numeric", hour: "2-digit", minute: "2-digit" })}`, "", "Цель", plan.goal, "", "Договорённости", plan.instructions];
  const date = visitDate(plan);
  if (date) lines.push("", `Дата следующего приёма: ${readAppointment(plan.appointment) ? appointmentLabel(readAppointment(plan.appointment)!) : dateLabel(date, { year: "numeric" })}.`);
  if (plan.tasks.length) { lines.push("", "Задачи до контакта"); for (const [i, task] of plan.tasks.entries()) lines.push(`${i + 1}. ${task.title}${task.medication?.regimen ? ` · ${regimenLabel(task.medication.regimen)}` : task.repeat ? " · ежедневно" : ""}${task.dueDate ? ` · до ${dateLabel(task.dueDate)}` : ""}`, ...(task.details ? [task.details] : [])); }
  lines.push("", "Памятка отражает указанную версию плана. Отметки выполнения и последующие изменения сюда не включены.");
  if (audience === "doctor") lines.push("Проект требует проверки перед включением в медицинскую документацию. Диагнозы и назначения из текста автоматически не выводились.");
  if (demo) lines.push("Все данные являются вымышленными.");
  return lines.join("\n");
}
export function careDocumentHtml(text: string, title: string) {
  const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><body><h1>${escape(title)}</h1><p>Для печати используйте меню браузера или Ctrl+P.</p><pre>${escape(text)}</pre></body></html>`;
}
