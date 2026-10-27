import {medicationRegimenSchema} from "@/lib/medication-regimen";
import { z } from "zod";
import { appointmentSchema } from "@/lib/appointment";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value >= "1900-01-01" && value <= "2200-12-31";
}, "Проверьте календарную дату.");
export const careDateSchema = date;
export const medicationSchema = z.strictObject({name:z.string().trim().min(2).max(200),dose:z.string().trim().min(1).max(200),regimen:medicationRegimenSchema.optional()});
const task = z.strictObject({ id: z.string().uuid(), kind: z.enum(["ACTION", "ASSESSMENT", "MEDICATION"]), title: z.string().trim().min(2).max(200), details: z.string().trim().max(1500), dueDate: date.nullable(), assignmentId: z.string().min(1).max(100).nullable(), repeat: z.literal("DAILY").optional(), startDate:date.optional(), time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), medication:medicationSchema.optional() }).superRefine((task, ctx) => {
  if ((task.kind === "ASSESSMENT") !== !!task.assignmentId) ctx.addIssue({ code: "custom", message: "Для задачи анкеты требуется назначение; для обычной задачи оно не используется." });
  if (task.repeat && task.kind === "ASSESSMENT") ctx.addIssue({ code: "custom", message: "Ежедневный отчёт недоступен для анкеты." });
  if(task.kind === "MEDICATION" && (!task.medication || !task.startDate || (!task.medication?.regimen && !task.time)))ctx.addIssue({code:"custom",message:"Укажите препарат, дозу, дату начала и время приёма."});
  if(task.kind === "MEDICATION" && task.medication && task.title!==task.medication.name)ctx.addIssue({code:"custom",message:"Название препарата должно совпадать с названием назначения."});
  if(task.kind !== "MEDICATION" && (task.medication || task.time))ctx.addIssue({code:"custom",message:"Препарат и время приёма доступны только для лекарственного назначения."});
  if(task.startDate && task.dueDate && task.startDate>task.dueDate)ctx.addIssue({code:"custom",message:"Дата окончания раньше начала."});
});
export const careContentSchema = z.strictObject({ goal: z.string().trim().min(3).max(500), instructions: z.string().trim().min(3).max(4000), nextContactDate: date.nullable(), appointment: appointmentSchema.nullable().optional(), tasks: z.array(task).max(8) }).superRefine((content, ctx) => {
  if (new Set(content.tasks.map(t => t.id)).size !== content.tasks.length) ctx.addIssue({ code: "custom", message: "Задачи повторяются." });
  const assignments = content.tasks.flatMap(t => t.assignmentId ? [t.assignmentId] : []);
  if (new Set(assignments).size !== assignments.length) ctx.addIssue({ code: "custom", message: "Одно назначение анкеты добавлено несколько раз." });
});
export type CareContent = z.infer<typeof careContentSchema>;
export type CareTaskInput = CareContent["tasks"][number];
export const careReportSchema = z.strictObject({ state: z.enum(["DONE", "NOT_DONE", "NEEDS_HELP"]), note: z.string().trim().max(2000) }).superRefine((report, ctx) => {
  if (report.state === "NEEDS_HELP" && report.note.length < 3) ctx.addIssue({ code: "custom", message: "Опишите вопрос врачу." });
});
