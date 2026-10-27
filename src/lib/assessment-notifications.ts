export const notificationKinds = ["ROUTINE", "REVIEW", "HIGH", "SAFETY"] as const;
export type AssessmentNotificationKind = typeof notificationKinds[number];
// Order in the review queue only, not a clinical urgency or suicide-risk score.
export const notificationPriority: Record<AssessmentNotificationKind, number> = { ROUTINE: 1, REVIEW: 2, HIGH: 3, SAFETY: 4 };
export function kindFromPriority(priority: number): AssessmentNotificationKind | undefined {
  return notificationKinds.find(kind => notificationPriority[kind] === priority);
}
export const notificationLabels: Record<AssessmentNotificationKind, string> = {
  ROUTINE: "Плановый разбор", REVIEW: "Новый результат", HIGH: "Высокий показатель шкалы", SAFETY: "Уточнить безопасность"
};
export const guidanceSourceIds = ["f40-assessment", "f40-interview", "f40-safety", "f40-route", "nice-social-assessment", "nice-active-monitoring", "nice-safety"] as const;
export type GuidanceSourceId = typeof guidanceSourceIds[number];
export const guidanceSources: Record<GuidanceSourceId, { title: string; reference: string; scope: string; url: string }> = {
  "f40-assessment": { title: "КР «Тревожно-фобические расстройства», ID 455, 2024", reference: "Раздел 2.5, PDF стр. 20", scope: "Индивидуальный выбор шкал и оценка симптомов и их динамики. Источник предоставлен пользователем; актуальность редакции и цифровой перенос требуют проверки.", url: "/api/clinical-source?id=f40-455-2024#page=20" },
  "f40-interview": { title: "КР F40 · клиническое обследование", reference: "Раздел 2.1, PDF стр. 14–15", scope: "Связь тревоги с ситуациями, избегание, влияние на жизнь и сопутствующие состояния. Балл анкеты не устанавливает диагноз.", url: "/api/clinical-source?id=f40-455-2024#page=14" },
  "f40-safety": { title: "КР F40 · оценка суицидального риска врачом", reference: "Раздел 2.1, PDF стр. 15", scope: "Отдельная клиническая оценка; сумма анкеты и страх смерти её не заменяют.", url: "/api/clinical-source?id=f40-455-2024#page=15" },
  "f40-route": { title: "КР F40 · организация помощи", reference: "Раздел 6, PDF стр. 45", scope: "При выборе маршрута врач учитывает ограничения повседневной жизни, сопутствующие состояния и переносимость терапии. Автоматического направления или решения о госпитализации нет.", url: "/api/clinical-source?id=f40-455-2024#page=45" },
  "nice-social-assessment": { title: "NICE CG159 · Social anxiety disorder", reference: "Рекомендации 1.2.4–1.2.8", scope: "Дополнительный справочник для взрослых с возможным социальным тревожным расстройством: страх, избегание, дистресс и влияние на функционирование. Не источник порогов BFNE или других анкет.", url: "https://www.nice.org.uk/Guidance/CG159/chapter/recommendations#assessment-of-adults-with-possible-social-anxiety-disorder" },
  "nice-active-monitoring": { title: "NICE CG113 · Generalised anxiety disorder and panic disorder", reference: "Рекомендации 1.2.6, 1.2.10", scope: "Дополнительный контекст при подозрении или установленном ГТР: оценка симптомов и функционирования. Не заменяет рекомендации F40 и не задаёт пороги наших уведомлений.", url: "https://www.nice.org.uk/guidance/cg113/chapter/recommendations" },
  "nice-safety": { title: "NICE NG225 · Self-harm: assessment, management and preventing recurrence", reference: "Рекомендации 1.6.1–1.6.6", scope: "При оценке самоповреждения шкалы не должны использоваться для прогнозирования суицида или решения об отказе в помощи. Оцениваются потребности и безопасность человека.", url: "https://www.nice.org.uk/guidance/ng225/chapter/Recommendations#risk-assessment-tools-and-scales" }
};
