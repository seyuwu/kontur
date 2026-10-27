import type { AssessmentFormDefinition, AssignmentData } from "@/lib/assessments";
export function GuidelineReview({ form, metric }: { form: AssessmentFormDefinition; metric: NonNullable<AssignmentData["submission"]>["metric"] }) {
  const source = form.provenance; if (!source) return null;
  return <section className="guideline-review" aria-label="Показатель и рекомендации врачу">
    <div className="assessment-result"><strong>{metric.label}: {metric.value} из {metric.maximum}</strong><p>{metric.interpretation}</p><p className="secondary-text small-text">Период: {form.period}</p></div>
    <details className="assessment-source"><summary>По рекомендациям: что уточнить</summary><p className="hint">{source.limitations}</p><ul className="guideline-checklist">{source.reviewChecklist.map(item => <li key={item.text}><p>{item.text}</p><a href={`/api/clinical-source?id=${source.sourceId}#page=${item.pdfPage}`} target="_blank" rel="noopener noreferrer">{item.reference} · PDF, стр. {item.pdfPage}</a></li>)}</ul><p className="secondary-text small-text">Справочные пункты для оценки врачом. Открытие источника не означает, что обследование проведено или решение принято.</p></details>
  </section>;
}
