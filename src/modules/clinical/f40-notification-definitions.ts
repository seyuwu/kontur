import { assessmentDefinitionSchema, type AssessmentDefinition } from "./index";
import { f40Definitions } from "./f40-definitions";
import type { AssessmentNotificationKind, GuidanceSourceId } from "@/lib/assessment-notifications";

type Scenario = { id: string; minimum: number; maximum: number; kind: AssessmentNotificationKind; title: string; recommendation: string; sources?: GuidanceSourceId[] };
const routine = "Сверьте исходные ответы, жалобы и согласованный план наблюдения. Проверьте следующий контакт. Низкий балл сам по себе не подтверждает выздоровление, отсутствие риска или возможность отменить помощь.";
const mild = "Уточните, какие симптомы сохраняются, в каких ситуациях они возникают и мешают ли повседневной жизни. Сопоставьте с предыдущей оценкой той же методики и обсудите дальнейшее наблюдение; по одной сумме лечение не меняют.";
const moderate = "Разберите наиболее выраженные ответы, избегание и влияние симптомов на повседневную жизнь. Согласуйте контакт для уточнения состояния и плана. При клиническом подтверждении ТФР учитывайте консультацию психиатра/психотерапевта по разделу 2.1.";
const high = "Свяжитесь с пациентом для уточнения актуального состояния, ограничений повседневной жизни, сопутствующих состояний и переносимости терапии. Проведите отдельную оценку безопасности. Необходимость консультации и маршрута помощи определяет врач после оценки, а не сумма баллов.";
const scenarios: Record<string, Scenario[]> = {
  "guideline-f40-bai-demo": [
    { id: "bai_low_pdf", minimum: 0, maximum: 9, kind: "ROUTINE", title: "Низкий показатель BAI: плановый разбор", recommendation: routine },
    { id: "bai_mild_pdf", minimum: 10, maximum: 21, kind: "REVIEW", title: "BAI 10–21: уточнить симптомы", recommendation: mild },
    { id: "bai_moderate_pdf", minimum: 22, maximum: 35, kind: "REVIEW", title: "BAI 22–35: обсудить состояние", recommendation: moderate },
    { id: "bai_high_pdf", minimum: 36, maximum: 63, kind: "HIGH", title: "Высокий показатель BAI: требуется разбор", recommendation: high }
  ],
  "guideline-f40-ham-demo": [
    { id: "ham_low_pdf", minimum: 0, maximum: 7, kind: "ROUTINE", title: "HAM-A 0–7: плановый разбор", recommendation: routine },
    { id: "ham_mild_pdf", minimum: 8, maximum: 17, kind: "REVIEW", title: "HAM-A 8–17: уточнить симптомы", recommendation: mild },
    { id: "ham_moderate_pdf", minimum: 18, maximum: 24, kind: "REVIEW", title: "HAM-A 18–24: обсудить состояние", recommendation: moderate },
    { id: "ham_high_pdf", minimum: 25, maximum: 56, kind: "HIGH", title: "Высокий показатель HAM-A: требуется разбор", recommendation: high }
  ],
  "guideline-f40-spras-demo": [
    { id: "spras_low_pdf", minimum: 0, maximum: 29, kind: "ROUTINE", title: "SPRAS 0–29: плановый разбор", recommendation: routine },
    { id: "spras_middle_pdf", minimum: 30, maximum: 79, kind: "REVIEW", title: "SPRAS 30–79: обсудить состояние", recommendation: moderate },
    { id: "spras_high_pdf", minimum: 80, maximum: 140, kind: "HIGH", title: "Высокий показатель SPRAS: требуется разбор", recommendation: high }
  ],
  "guideline-f40-bfne-demo": [
    { id: "bfne_low_pdf", minimum: 12, maximum: 23, kind: "ROUTINE", title: "BFNE 12–23: плановый разбор", recommendation: routine, sources: ["f40-assessment", "nice-social-assessment"] },
    { id: "bfne_middle_pdf", minimum: 24, maximum: 46, kind: "REVIEW", title: "BFNE 24–46: уточнить социальную тревогу", recommendation: "Уточните ситуации страха негативной оценки, избегание, дистресс и влияние на социальную жизнь. Обсудите эти ответы с пациентом. Показатель BFNE не устанавливает диагноз социального тревожного расстройства.", sources: ["f40-interview", "nice-social-assessment"] },
    { id: "bfne_high_pdf", minimum: 47, maximum: 60, kind: "HIGH", title: "Высокий показатель BFNE: требуется разбор", recommendation: "Согласуйте контакт, уточните страх негативной оценки, избегание и степень ограничения повседневной жизни. Оцените необходимость дальнейшего клинического обследования. Вид помощи определяет врач, а не балл BFNE.", sources: ["f40-interview", "nice-social-assessment"] }
  ]
};

function withNotifications(original: AssessmentDefinition): AssessmentDefinition {
  const plan = scenarios[original.code];
  const minimum = original.questions.filter(q => original.scoring.questionIds.includes(q.id)).reduce((sum, q) => sum + Math.min(...q.options.map(o => o.points)), 0);
  const maximum = original.questions.filter(q => original.scoring.questionIds.includes(q.id)).reduce((sum, q) => sum + Math.max(...q.options.map(o => o.points)), 0);
  const divisor = original.schemaVersion === 3 && original.scoring.aggregate === "mean" ? original.scoring.questionIds.length : 1;
  const selected: Scenario[] = plan ?? [{ id: "result_received", minimum: minimum / divisor, maximum: maximum / divisor, kind: "REVIEW", title: `${original.title}: получен результат без категории`, recommendation: "Проверьте исходные ответы, период и доступные показатели. Для этой версии инструмента надёжный порог категории не задан: нельзя автоматически назвать состояние хорошим или плохим. Сопоставьте с предыдущей оценкой той же методики и клиническим контекстом.", sources: ["f40-assessment"] }];
  const reference = original.source.reference;
  const actions: AssessmentDefinition["actions"] = [];
  const rules: Extract<AssessmentDefinition, { schemaVersion: 2 }>["rules"] = [];
  for (const scenario of selected) {
    const sourceIds: GuidanceSourceId[] = scenario.sources ?? (scenario.kind === "HIGH" ? ["f40-interview", "f40-safety", "f40-route"] : scenario.kind === "ROUTINE" ? ["f40-assessment", "f40-interview"] : ["f40-assessment", "f40-interview"]);
    const reviewId = `${scenario.id}_review`;
    const contactId = `${scenario.id}_contact`;
    actions.push({ id: reviewId, label: scenario.kind === "ROUTINE" ? "Сверить ответы и план наблюдения" : original.code === "guideline-f40-bai-demo" && scenario.kind === "HIGH" ? "Разобрать показатель и исходные ответы" : "Разобрать ответы и клинический контекст", kind: "REVIEW_ANSWERS", description: scenario.recommendation, source: `${reference}. Разделы 2.1 и 2.5. Выбор действия — учебный процесс приложения, не самостоятельное лечебное назначение.`, sourceIds });
    const actionIds = [reviewId];
    if (scenario.kind !== "ROUTINE") {
      actions.push({ id: contactId, label: "Уточнить состояние при контакте", kind: "CONTACT_PATIENT", description: scenario.kind === "HIGH" ? "Уточните актуальные жалобы и влияние на жизнь при контакте. По результату оценки согласуйте следующий шаг и зафиксируйте его. Открытие переписки не подтверждает состоявшийся контакт." : "Согласуйте контакт для обсуждения ответов и дальнейшего наблюдения. Срок и способ связи определяет врач с учётом контекста.", source: "Раздел 2.1 КР F40; конкретный срок связи и правило доставки в рекомендациях не установлены.", sourceIds });
      actionIds.push(contactId);
    }
    rules.push({ id: scenario.id, title: scenario.title, reason: `Показатель ${scenario.minimum}–${scenario.maximum}. ${plan ? `Диапазон взят из ключа: ${reference}.` : "Категория выраженности не присваивается."} Это учебный сигнал рабочего процесса, не диагноз и не уровень медицинской срочности.`, when: { metric: "TOTAL", minimum: scenario.minimum, maximum: scenario.maximum }, actionIds, notification: { kind: scenario.kind, recommendation: scenario.recommendation, sourceIds } });
  }
  if (original.code === "guideline-f40-scl-demo") {
    const sourceIds: GuidanceSourceId[] = ["f40-safety", "nice-safety"];
    const recommendation = "В пункте о мыслях о самоубийстве выбран ненулевой ответ. Свяжитесь с пациентом, уточните актуальное состояние и безопасность и проведите отдельную клиническую оценку. Не делайте вывод о намерениях или текущей опасности по одному ответу либо общей сумме. Необходимые действия определяются по результату оценки врачом.";
    actions.push({ id: "scl_safety_review", label: "Проверить ответ и оценить безопасность", kind: "REVIEW_ANSWERS", description: recommendation, source: "Пункт 15 SCL-90-R, приложение Г2; отдельная оценка — раздел 2.1 КР F40, PDF стр. 15; NICE NG225, 1.6.1–1.6.6. Уведомление по любому ненулевому ответу — учебное организационное правило приложения, не клинический порог КР.", sourceIds });
    actions.push({ id: "scl_safety_contact", label: "Уточнить актуальное состояние при контакте", kind: "CONTACT_PATIENT", description: "Установите контакт согласованным способом и уточните, актуален ли ответ сейчас. По клинической оценке определите необходимую помощь и зафиксируйте результат. Сервис не заменяет экстренный канал и не гарантирует мгновенную реакцию.", source: "Раздел 2.1 КР F40; NICE NG225, раздел 1.6. Способ и время связи — согласованный процесс клиники.", sourceIds });
    rules.push({ id: "scl_safety_answer", title: "SCL-90-R: уточнить ответ о безопасности", reason: "Ненулевой ответ на пункт 15 о мыслях о самоубийстве. Вопрос относится к последней неделе, включая сегодняшний день. Требуется отдельное уточнение актуального состояния; автоматическая оценка риска не проводится.", when: { questionId: "scl_15", optionIds: ["answer_1", "answer_2", "answer_3", "answer_4"] }, actionIds: ["scl_safety_review", "scl_safety_contact"], notification: { kind: "SAFETY", recommendation, sourceIds } });
  }
  return assessmentDefinitionSchema.parse({ ...original, version: original.version + 1, actions, rules,
    source: { ...original.source, validation: `${original.source.validation} Версия 2 добавляет учебные уведомления по диапазонам. Порог события и действие рабочего процесса требуют клинического согласования.` }
  });
}

/** New immutable versions. Existing assignments retain their original definition. */
export const f40NotificationDefinitions = f40Definitions.map(withNotifications);
