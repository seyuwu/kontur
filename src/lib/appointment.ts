import { z } from "zod";

export const appointmentSchema = z.strictObject({
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).refine(value => {
    const date = new Date(`${value}:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 16) === value && value >= "1900" && value < "2201";
  }, "Проверьте дату и время приёма."),
  format: z.enum(["UNSPECIFIED", "IN_PERSON", "PHONE", "VIDEO"]),
  location: z.string().trim().max(500),
  timezone: z.literal("Europe/Moscow")
}).superRefine((value, ctx) => {
  if (["IN_PERSON","VIDEO"].includes(value.format) && !value.location) ctx.addIssue({ code: "custom", path: ["location"], message: value.format === "VIDEO" ? "Укажите ссылку или порядок подключения." : "Укажите место приёма." });
});
export type Appointment = z.infer<typeof appointmentSchema>;
/** Older plans may contain two dates. Keep the agreed appointment date for display. */
export function visitDate(plan: { nextContactDate?: string | null; appointment?: unknown }): string | null {
  return readAppointment(plan.appointment)?.at.slice(0, 10) ?? plan.nextContactDate ?? null;
}
export const appointmentFormats = { UNSPECIFIED: "Приём", IN_PERSON: "Очный приём", PHONE: "Телефонный приём", VIDEO: "Видеоприём" };
export function readAppointment(value: unknown): Appointment | null { const parsed = appointmentSchema.safeParse(value); return parsed.success ? parsed.data : null; }
export function appointmentLabel(value: Appointment) {
  return `${appointmentFormats[value.format]} — ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: value.timezone }).format(new Date(`${value.at}:00+03:00`))} (МСК)`;
}

export function visitLabel(value:string|null,hasTime=false) {
  if (!value) return "Не назначен";
  return new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"short",...(hasTime?{hour:"2-digit",minute:"2-digit"}:{}),timeZone:"Europe/Moscow"}).format(new Date(value)) + (hasTime ? " МСК" : "");
}
export function visitTimeValue(value:string|null) {
  return value ? new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",hourCycle:"h23",timeZone:"Europe/Moscow"}).format(new Date(value)) : "";
}

export function visitDateValue(value:string|null) {
  return value ? new Intl.DateTimeFormat("sv-SE",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:"Europe/Moscow"}).format(new Date(value)) : "";
}
