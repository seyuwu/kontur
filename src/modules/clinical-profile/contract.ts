import { z } from "zod";

export const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= "1900-01-01" && value <= "2200-12-31";
}, "Проверьте календарную дату.");
export const documentEvidenceSchema = z.strictObject({ id: z.string().min(1).max(100), checksum: z.string().regex(/^[a-f0-9]{64}$/), start: z.number().int().min(0).max(60000), end: z.number().int().min(1).max(60000), quote: z.string().min(1).max(2000), extractionId: z.string().min(1).max(100).optional() }).refine(v => v.end > v.start && v.end - v.start === v.quote.length, "Проверьте границы фрагмента источника.");
export const evidenceSchema = z.strictObject({ kind: z.enum(["PATIENT_REPORT", "DOCUMENT", "CLINICIAN"]), reference: z.string().trim().min(3, "Укажите, где получены сведения.").max(500), date: calendarDate.nullable(), document: documentEvidenceSchema.optional() }).refine(v => !v.document || v.kind === "DOCUMENT", "Фрагмент документа допускается только для документального источника.");
const item = z.strictObject({ id: z.string().uuid(), title: z.string().trim().min(2, "Укажите название записи.").max(200), details: z.string().trim().max(1500), evidence: evidenceSchema });
const medication = item.extend({ regimen: z.string().trim().max(500), intake: z.enum(["TAKING", "STOPPED", "UNKNOWN"]), startedOn: calendarDate.nullable(), stoppedOn: calendarDate.nullable() }).superRefine((item, ctx) => {
  if (item.startedOn && item.stoppedOn && item.stoppedOn < item.startedOn) ctx.addIssue({ code: "custom", message: "Дата прекращения раньше начала приёма." });
  if (item.intake !== "STOPPED" && item.stoppedOn) ctx.addIssue({ code: "custom", message: "Дата прекращения допускается только для прекращённого приёма." });
});
function section<T extends z.ZodType>(schema: T) {
  return z.strictObject({ status: z.enum(["UNKNOWN", "NONE", "KNOWN"]), note: z.string().trim().max(1000), evidence: evidenceSchema.nullable(), items: z.array(schema).max(20) }).superRefine((value, ctx) => {
    if (value.status === "KNOWN" && !value.items.length) ctx.addIssue({ code: "custom", message: "Добавьте сведения или выберите другой статус." });
    if (value.status !== "KNOWN" && value.items.length) ctx.addIssue({ code: "custom", message: "Для этого статуса список должен быть пустым." });
    if ((value.status === "NONE") !== !!value.evidence) ctx.addIssue({ code: "custom", message: "Укажите источник отрицательного ответа; источники отдельных записей указываются в самих записях." });
  });
}
export const profileContentSchema = z.strictObject({ schemaVersion: z.literal(1), conditions: section(item), allergies: section(item), medications: section(medication) }).superRefine((value, ctx) => {
  const ids = [...value.conditions.items, ...value.allergies.items, ...value.medications.items].map(i => i.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Записи не должны повторяться." });
});
export type ProfileContent = z.infer<typeof profileContentSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type ProfileCategory = "conditions" | "allergies" | "medications";
export const categoryNames = { conditions: "Состояния и ограничения", allergies: "Аллергии и реакции", medications: "Текущие и прежние препараты" } as const;
export const statusNames = { UNKNOWN: "Не уточнено", NONE: "По источнику не сообщалось", KNOWN: "Есть сведения" } as const;
export const evidenceNames = { PATIENT_REPORT: "Со слов пациента", DOCUMENT: "Из документа", CLINICIAN: "Наблюдение врача" } as const;
export const intakeNames = { TAKING: "Принимает по источнику", STOPPED: "Приём прекращён по источнику", UNKNOWN: "Статус приёма не уточнён" } as const;
export function emptyProfile(): ProfileContent { return { schemaVersion: 1, conditions: { status: "UNKNOWN", note: "", evidence: null, items: [] }, allergies: { status: "UNKNOWN", note: "", evidence: null, items: [] }, medications: { status: "UNKNOWN", note: "", evidence: null, items: [] } }; }
/** State switches keep local inputs reversible; only the selected branch is saved. */
export function canonicalProfile(content: ProfileContent): ProfileContent {
  const normalize = <T extends { status: string; evidence: Evidence | null; items: unknown[] }>(section: T): T => ({ ...section, evidence: section.status === "NONE" ? section.evidence : null, items: section.status === "KNOWN" ? section.items : [] });
  return { schemaVersion: 1, conditions: normalize(content.conditions), allergies: normalize(content.allergies), medications: normalize(content.medications) };
}
