import { FlaskConical, FileCheck2 } from "lucide-react";
import type { AssessmentFormDefinition, AssignmentData } from "@/lib/assessments";
import { dateLabel } from "@/lib/format";

export const assignmentLabels = { ASSIGNED: "Назначена", IN_PROGRESS: "Черновик", COMPLETED: "Отправлена", CANCELLED: "Отменена" };
export function DefinitionNotice({ form }: { form: AssessmentFormDefinition }) {
  return <><div className={`assessment-notice ${form.mode === "DEMO" ? "is-demo" : ""}`}><FlaskConical size={17} aria-hidden="true" /><div><strong>{form.mode === "DEMO" ? "Требует проверки врача" : "Определение инструмента"}</strong><p>{form.mode === "DEMO" ? "Методика и её результаты не прошли клиническую проверку. Не используйте их для диагностики или выбора лечения." : form.description}</p></div></div><details className="assessment-source"><summary>Источник и условия применения · версия {form.version}</summary><dl className="source-meta"><dt>Описание</dt><dd>{form.description}</dd><dt>Источник</dt><dd>{form.source.title}</dd><dt>Основание</dt><dd>{form.source.reference}</dd><dt>Валидация</dt><dd>{form.source.validation}</dd><dt>Условия использования</dt><dd>{form.source.rights}</dd><dt>Период</dt><dd>{form.period}</dd>{form.provenance && <><dt>Границы применения</dt><dd>{form.provenance.limitations}</dd><dt>Предоставленный документ</dt><dd><a className="text-link" href={`/api/clinical-source?id=${form.provenance.sourceId}#page=${form.provenance.pdfPages[0]}`} target="_blank" rel="noopener noreferrer">Открыть PDF, стр. {form.provenance.pdfPages.join(", ")}</a></dd></>}</dl></details></>;
}
export function AssignmentAnswers({ assignment, form }: { assignment: AssignmentData; form: AssessmentFormDefinition }) {
  const submission = assignment.submission;
  if (!submission) return <p className="secondary-text">{assignment.status === "CANCELLED" ? `Назначение отменено: ${assignment.cancellationReason}` : "Пациент ещё не отправил анкету."}</p>;
  return <><div className="assessment-sent"><FileCheck2 size={19} /><div><strong>{form.respondent === "DOCTOR" ? "Врачебная оценка сохранена" : "Ответы отправлены"}</strong><p>{dateLabel(submission.createdAt, { hour: "2-digit", minute: "2-digit", year: "numeric" })}</p></div></div><AnswerList form={form} answers={submission.answers} note={submission.note} /><div className="assessment-result"><strong>{submission.metric.label}: {submission.metric.value}</strong><p>Диапазон: {submission.metric.minimum}–{submission.metric.maximum}. {submission.metric.interpretation}</p></div></>;
}
export function AnswerList({ form, answers, note }: { form: AssessmentFormDefinition; answers: Record<string, string>; note: string }) {
  return <><dl className="assessment-answers">{form.questions.map(q => <div key={q.id}><dt>{q.title}</dt><dd>{q.options.find(o => o.id === answers[q.id])?.label ?? "Нет ответа"}</dd></div>)}</dl>{note && <section className="assessment-comment"><h3>{form.respondent === "DOCTOR" ? "Комментарий врача" : "Комментарий пациента"}</h3><p>{note}</p></section>}</>;
}
