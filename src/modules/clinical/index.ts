import { z } from "zod";
import { guidanceSourceIds, notificationKinds, notificationPriority } from "@/lib/assessment-notifications";

const identifier = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const option = z.strictObject({ id: identifier, label: z.string().min(1).max(400), points: z.number().int().min(-100).max(100) });
const question = z.strictObject({ id: identifier, title: z.string().min(1).max(800), required: z.boolean(), options: z.array(option).min(2).max(10) });
const action = z.strictObject({ id: identifier, label: z.string().min(1).max(100), description: z.string().min(1).max(1000), kind: z.enum(["REVIEW_ANSWERS", "CONTACT_PATIENT"]), source: z.string().min(1).max(1000), sourceIds: z.array(z.enum(guidanceSourceIds)).min(1).max(6).optional() });
export const assessmentNotificationSchema = z.strictObject({ kind: z.enum(notificationKinds), recommendation: z.string().min(1).max(1200), sourceIds: z.array(z.enum(guidanceSourceIds)).min(1).max(6) });
export const proposedActionsSchema = z.array(action);
const definitionBase = z.strictObject({
  schemaVersion: z.literal(1), code: identifier, version: z.number().int().positive(),
  title: z.string().min(1).max(200), description: z.string().min(1).max(1600), instructions: z.string().min(1).max(1600),
  period: z.string().min(1).max(400), mode: z.enum(["DEMO", "CLINICAL"]), review: z.enum(["DEMO", "DRAFT", "APPROVED"]),
  source: z.strictObject({ title: z.string().min(1).max(400), reference: z.string().min(1).max(1600), validation: z.string().min(1).max(1600), rights: z.string().min(1).max(1000), reviewedBy: z.string().max(400), reviewedAt: z.string().max(100) }),
  questions: z.array(question).min(1).max(80),
  scoring: z.strictObject({ strategy: z.literal("sum"), questionIds: z.array(identifier).min(1).max(80), label: z.string().min(1).max(200), interpretation: z.string().min(1).max(1000) }),
  actions: z.array(action).min(1).max(12),
  rules: z.array(z.strictObject({ id: identifier, title: z.string().min(1).max(200), reason: z.string().min(1).max(1000), when: z.strictObject({ questionId: identifier, optionIds: z.array(identifier).min(1).max(10) }), actionIds: z.array(identifier).min(1).max(12), notification: assessmentNotificationSchema.optional() })).max(20)
 });
const band = z.strictObject({ id: identifier, minimum: z.number().int(), maximum: z.number().int(), label: z.string().min(1).max(400), source: z.string().min(1).max(500) });
export const guidelineProvenanceSchema = z.strictObject({
  sourceId: identifier, sha256: z.string().regex(/^[a-f0-9]{64}$/),
  pdfPages: z.array(z.number().int().min(1).max(10000)).min(1).max(20),
  reference: z.string().min(1).max(400), limitations: z.string().min(1).max(1600),
  minimumAge: z.number().int().min(18).max(120),
  reviewChecklist: z.array(z.strictObject({ text: z.string().min(1).max(800), reference: z.string().min(1).max(400), pdfPage: z.number().int().min(1).max(10000) })).min(1).max(8)
});
const definitionV2Base = definitionBase.extend({
  schemaVersion: z.literal(2),
  scoring: definitionBase.shape.scoring.extend({ bands: z.array(band).min(1).max(20) }),
  rules: z.array(z.strictObject({ ...definitionBase.shape.rules.element.shape, when: z.union([
    definitionBase.shape.rules.element.shape.when,
    z.strictObject({ metric: z.literal("TOTAL"), minimum: z.number().int(), maximum: z.number().int() })
  ]) })).max(20),
  provenance: guidelineProvenanceSchema
});
const metricSpec = z.strictObject({ label: z.string().min(1).max(200), questionIds: z.array(identifier).min(1).max(120), aggregate: z.enum(["sum", "mean", "positive-count", "positive-mean"]) });
const definitionV3Base = definitionBase.extend({
  schemaVersion: z.literal(3), respondent: z.enum(["PATIENT", "DOCTOR"]),
  questions: z.array(question).min(1).max(120),
  scoring: definitionBase.shape.scoring.extend({ questionIds: z.array(identifier).min(1).max(120), aggregate: z.enum(["sum", "mean"]), subscales: z.array(metricSpec).max(20) }),
  rules: definitionV2Base.shape.rules, provenance: guidelineProvenanceSchema
});
const sharedRefinement = (definition: z.infer<typeof definitionBase> | z.infer<typeof definitionV2Base> | z.infer<typeof definitionV3Base>, ctx: z.RefinementCtx) => {
  const unique = (items: string[], label: string) => { if (new Set(items).size !== items.length) ctx.addIssue({ code: "custom", message: `Повторяющийся идентификатор: ${label}` }); };
  unique(definition.questions.map(q => q.id), "вопрос"); unique(definition.actions.map(a => a.id), "действие"); unique(definition.rules.map(r => r.id), "правило"); unique(definition.scoring.questionIds, "расчёт");
  for (const q of definition.questions) unique(q.options.map(o => o.id), q.id);
  for (const id of definition.scoring.questionIds) if (!definition.questions.some(q => q.id === id && q.required)) ctx.addIssue({ code: "custom", message: "Расчёт должен ссылаться на существующий обязательный вопрос." });
  for (const rule of definition.rules) {
    const when = rule.when;
    if ("questionId" in when) {
      const q = definition.questions.find(q => q.id === when.questionId);
      if (!q || when.optionIds.some(id => !q.options.some(o => o.id === id))) ctx.addIssue({ code: "custom", message: "Правило ссылается на неизвестный ответ." });
    }
    if (rule.actionIds.some(id => !definition.actions.some(a => a.id === id))) ctx.addIssue({ code: "custom", message: "Правило ссылается на неизвестное действие." });
  }
  if (definition.mode === "DEMO" && definition.review !== "DEMO") ctx.addIssue({ code: "custom", message: "Учебное определение должно иметь учебный статус." });
  if (definition.mode === "CLINICAL" && definition.review === "APPROVED" && (!definition.source.reviewedBy || !definition.source.reviewedAt)) ctx.addIssue({ code: "custom", message: "Не указана проверка клинического определения." });
};
export const assessmentDefinitionSchema = z.discriminatedUnion("schemaVersion", [
  definitionBase.superRefine(sharedRefinement),
  definitionV3Base.superRefine(sharedRefinement).superRefine((d, ctx) => {
    for (const metric of d.scoring.subscales) {
      if (new Set(metric.questionIds).size !== metric.questionIds.length || metric.questionIds.some(id => !d.questions.some(q => q.id === id && q.required))) ctx.addIssue({ code: "custom", message: "Подшкала ссылается на повторяющийся или неизвестный вопрос." });
    }
    const scored = d.questions.filter(q => d.scoring.questionIds.includes(q.id));
    const divisor = d.scoring.aggregate === "mean" ? scored.length : 1;
    const minimum = scored.reduce((sum, q) => sum + Math.min(...q.options.map(o => o.points)), 0) / divisor;
    const maximum = scored.reduce((sum, q) => sum + Math.max(...q.options.map(o => o.points)), 0) / divisor;
    for (const r of d.rules) if ("metric" in r.when && (r.when.minimum < minimum || r.when.maximum > maximum || r.when.minimum > r.when.maximum)) ctx.addIssue({ code: "custom", message: "Порог события выходит за диапазон инструмента." });
  }),
  definitionV2Base.superRefine(sharedRefinement).superRefine((d, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const scored = d.scoring.questionIds.map(id => d.questions.find(q => q.id === id)).filter(q => q !== undefined);
    const minimum = scored.reduce((sum, q) => sum + Math.min(...q.options.map(o => o.points)), 0);
    const maximum = scored.reduce((sum, q) => sum + Math.max(...q.options.map(o => o.points)), 0);
    if (new Set(d.scoring.bands.map(b => b.id)).size !== d.scoring.bands.length) fail("Повторяющийся диапазон расчёта.");
    let next = minimum;
    for (const b of d.scoring.bands) { if (b.minimum !== next || b.maximum < b.minimum || b.maximum > maximum) fail("Диапазоны должны покрывать весь расчёт без пробелов и пересечений."); next = b.maximum + 1; }
    if (next !== maximum + 1) fail("Диапазоны не покрывают весь расчёт.");
    for (const r of d.rules) if ("metric" in r.when && (r.when.minimum < minimum || r.when.maximum > maximum || r.when.minimum > r.when.maximum)) fail("Порог события выходит за диапазон инструмента.");
  })
]);

export type AssessmentDefinition = z.infer<typeof assessmentDefinitionSchema>;
export type AssessmentAnswers = Record<string, string>;
export type ProposedAction = z.infer<typeof action>;
export type AssessmentEvaluation = ReturnType<typeof evaluateAssessment>;

export class AssessmentInputError extends Error {}
export function validateAnswers(definition: AssessmentDefinition, answers: AssessmentAnswers, complete: boolean) {
  for (const [id, answer] of Object.entries(answers)) {
    const q = definition.questions.find(q => q.id === id);
    if (!q || !q.options.some(o => o.id === answer)) throw new AssessmentInputError("Один из ответов не соответствует версии анкеты. Проверьте форму.");
  }
  if (complete) {
    const missing = definition.questions.filter(q => q.required && !answers[q.id]);
    if (missing.length) throw new AssessmentInputError(`Ответьте на обязательные вопросы: ${missing.map(q => q.title).join("; ")}`);
  }
}

/** Pure, bounded evaluation: no network, database, LLM or executable rules. */
export function evaluateAssessment(definition: AssessmentDefinition, answers: AssessmentAnswers) {
  validateAnswers(definition, answers, true);
  const scored = definition.scoring.questionIds.map(id => definition.questions.find(q => q.id === id)!);
  const aggregate = (values: number[], strategy: "sum" | "mean" | "positive-count" | "positive-mean") => strategy === "positive-count" ? values.filter(v => v > 0).length : strategy === "positive-mean" ? (values.some(v => v > 0) ? values.reduce((a, b) => a + b, 0) / values.filter(v => v > 0).length : null) : values.reduce((a, b) => a + b, 0) / (strategy === "mean" ? values.length : 1);
  const strategy = definition.schemaVersion === 3 ? definition.scoring.aggregate : "sum";
  const value = aggregate(scored.map(q => q.options.find(o => o.id === answers[q.id])!.points), strategy)!;
  const minimum = aggregate(scored.map(q => Math.min(...q.options.map(o => o.points))), strategy) ?? 0;
  const maximum = aggregate(scored.map(q => Math.max(...q.options.map(o => o.points))), strategy)!;
  const matching = definition.rules.filter(r => "questionId" in r.when ? r.when.optionIds.includes(answers[r.when.questionId]) : value >= r.when.minimum && value <= r.when.maximum);
  // New notification policies create one event per submission; a safety-related
  // answer supersedes the score category. Legacy independent rules stay intact.
  const classified = matching.filter(r => r.notification).sort((a, b) => notificationPriority[b.notification!.kind] - notificationPriority[a.notification!.kind]);
  const selected = [...matching.filter(r => !r.notification), ...classified.slice(0, 1)];
  const findings = selected.map(r => ({ ruleId: r.id, title: r.title, reason: r.reason, actions: r.actionIds.map(id => definition.actions.find(a => a.id === id)!), ...(r.notification ? { notification: r.notification } : {}) }));
  const band = definition.schemaVersion === 2 ? definition.scoring.bands.find(b => value >= b.minimum && value <= b.maximum) : null;
  let interpretation = band ? `${band.label}. ${definition.scoring.interpretation} Источник диапазона: ${band.source}` : definition.scoring.interpretation;
  if (definition.schemaVersion === 3) interpretation += " " + definition.scoring.subscales.map(m => {
    const result = aggregate(m.questionIds.map(id => definition.questions.find(q => q.id === id)!.options.find(o => o.id === answers[id])!.points), m.aggregate);
    return `${m.label}: ${result === null ? "не определён (нет положительных ответов)" : Math.round(result * 1000) / 1000}.`;
  }).join(" ");
  return { schemaVersion: definition.schemaVersion, code: definition.code, version: definition.version, mode: definition.mode, metric: { label: definition.scoring.label, value, minimum, maximum, interpretation }, findings };
}


export function assessmentApplies(definition: AssessmentDefinition, birthDate: Date, at = new Date()) {
  if (definition.schemaVersion === 1) return true;
  let age = at.getUTCFullYear() - birthDate.getUTCFullYear();
  if (at.getUTCMonth() < birthDate.getUTCMonth() || (at.getUTCMonth() === birthDate.getUTCMonth() && at.getUTCDate() < birthDate.getUTCDate())) age--;
  return age >= definition.provenance.minimumAge;
}
