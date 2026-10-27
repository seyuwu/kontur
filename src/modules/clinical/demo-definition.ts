import { assessmentDefinitionSchema } from "./index";

export const demoDefinition = assessmentDefinitionSchema.parse({
  schemaVersion: 1, code: "followup-demo", version: 1, mode: "DEMO", review: "DEMO",
  title: "Связь и понятность следующих шагов",
  description: "Учебная анкета для проверки назначения, ответов и реакции врача. Это не психометрическая шкала и не оценка депрессии или тревоги.",
  instructions: "Ответьте на два вопроса. При желании добавьте комментарий. Ответы станут доступны вашему ведущему врачу после отправки.",
  period: "Ваше мнение сейчас. Клинический период оценки не задан.",
  source: { title: "Учебное определение команды", reference: "followup-demo, версия 1; только вымышленные данные", validation: "Клиническая валидация отсутствует. Не применять для диагностики, оценки риска или выбора терапии.", rights: "Оригинальные учебные формулировки проекта.", reviewedBy: "", reviewedAt: "" },
  questions: [
    { id: "clarity", title: "Понятно ли вам, как связаться с врачом и что делать дальше?", required: true, options: [{ id: "clear", label: "Да, понятно", points: 0 }, { id: "some_questions", label: "Есть вопросы", points: 1 }, { id: "unclear", label: "Нужно объяснить", points: 2 }] },
    { id: "contact", title: "Хотите обсудить вопрос со своим врачом?", required: true, options: [{ id: "no", label: "Сейчас не нужно", points: 0 }, { id: "yes", label: "Да, хочу связаться", points: 0 }] }
  ],
  scoring: { strategy: "sum", questionIds: ["clarity"], label: "Учебная сумма ответов", interpretation: "Технический пример расчёта. Баллы не имеют клинической интерпретации и не определяют срочность." },
  actions: [
    { id: "review_answers", label: "Разобрать ответы", description: "Откройте исходные вопросы, ответы и комментарий. Зафиксируйте результат разбора.", kind: "REVIEW_ANSWERS", source: "Учебный процесс сопровождения: исходные ответы пациента." },
    { id: "contact_patient", label: "Связаться с пациентом", description: "Уточните вопрос пациента через переписку или согласованный канал. Открытие чата ещё не означает выполненный контакт.", kind: "CONTACT_PATIENT", source: "Явная просьба пациента или необходимость объяснить следующие шаги; учебное правило." }
  ],
  rules: [
    { id: "contact_requested", title: "Пациент просит связаться", reason: "Пациент выбрал «Да, хочу связаться». Это просьба о контакте, не автоматический критический сигнал.", when: { questionId: "contact", optionIds: ["yes"] }, actionIds: ["review_answers", "contact_patient"] },
    { id: "clarification_requested", title: "Нужно объяснить следующие шаги", reason: "Пациент отметил, что ему нужно объяснить способ связи и дальнейшие шаги. Учебное правило не оценивает медицинский риск.", when: { questionId: "clarity", optionIds: ["unclear"] }, actionIds: ["review_answers", "contact_patient"] }
  ]
});
