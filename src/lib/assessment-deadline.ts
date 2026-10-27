export function moscowDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map(key => parts.find(p => p.type === key)!.value).join("-");
}
export function assessmentDateAfter(days: number, now = new Date()): string {
  const date = new Date(`${moscowDate(now)}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}
export function assessmentDueAt(date: string): string { return new Date(`${date}T23:59:59+03:00`).toISOString(); }
