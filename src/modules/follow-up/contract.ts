import { z } from "zod";
import { calendarDate } from "@/modules/clinical-profile/contract";
export function calendarDay(date = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
export function shiftDay(day: string, days: number) { return new Date(new Date(`${day}T12:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10); }
export const dailyStates = ["DONE", "PARTIAL", "NOT_DONE", "UNSURE"] as const;
export const dailyLabels = { DONE: "Выполнено", PARTIAL: "Частично", NOT_DONE: "Не выполнено", UNSURE: "Не помню" };
export const dailyInput = z.strictObject({ patientId: z.string().min(1).max(100), planVersionId: z.string().min(1).max(100), taskId: z.string().uuid(), date: calendarDate, revision: z.number().int().nonnegative(), state: z.enum(dailyStates), note: z.string().trim().max(2000), needsContact: z.boolean(), requestKey: z.string().uuid() }).superRefine((v, ctx) => { if (v.needsContact && v.note.length < 3) ctx.addIssue({ code: "custom", message: "Опишите вопрос врачу." }); });
export const concernKinds = { SYMPTOM: "Самочувствие изменилось", POSSIBLE_REACTION: "После приёма препарата", OTHER: "Другая проблема" };
export const impactLabels = { UNKNOWN: "Трудно оценить", LOW: "Почти не мешает", MODERATE: "Мешает обычным делам", STRONG: "Сильно мешает обычным делам" };
export const concernInput = z.strictObject({ patientId: z.string().min(1).max(100), kind: z.enum(["SYMPTOM", "POSSIBLE_REACTION", "OTHER"]), title: z.string().trim().min(3).max(200), description: z.string().trim().min(3).max(3000), startedOn: calendarDate.nullable(), impact: z.enum(["UNKNOWN", "LOW", "MODERATE", "STRONG"]), requestKey: z.string().uuid() });
export const referralCategories = { REQUIRED: "Обязательно", RECOMMENDED: "Желательно" };
export const referralUrgencies = { ROUTINE: "В плановом порядке", SOON: "В ближайшее согласованное время", URGENT: "Срочно по решению врача" };
export const referralStatuses = { CONFIRMED: "Решение подтверждено", SCHEDULED: "Приём согласован", COMPLETED: "Консультация состоялась", CANCELLED: "Отменено врачом" };
export const referralContent = z.strictObject({ category: z.enum(["REQUIRED", "RECOMMENDED"]), urgency: z.enum(["ROUTINE", "SOON", "URGENT"]), reason: z.string().trim().min(3).max(2000), instructions: z.string().trim().min(3).max(3000), source: z.string().trim().min(3).max(1500) });
export const referralProgress = z.strictObject({ status: z.enum(["SCHEDULED", "COMPLETED", "CANCELLED"]), date: calendarDate.nullable(), note: z.string().trim().min(3).max(2000) }).superRefine((v, ctx) => { if (v.status !== "CANCELLED" && !v.date) ctx.addIssue({ code: "custom", message: "Укажите согласованную или фактическую дату консультации." }); if (v.status === "CANCELLED" && v.date) ctx.addIssue({ code: "custom", message: "Для отмены дата консультации не указывается." }); });
