export function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join(""); }
export function age(birthDate: string) {
  const birth = new Date(birthDate); const today = new Date();
  let years = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) years--;
  return years;
}
export function yearsLabel(value: number) { const n = value % 100; return `${value} ${n >= 11 && n <= 14 ? "лет" : value % 10 === 1 ? "год" : value % 10 >= 2 && value % 10 <= 4 ? "года" : "лет"}`; }
export function dateLabel(value: string | null, options: Intl.DateTimeFormatOptions = {}) {
  if (!value) return "Не назначен";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Moscow", ...options }).format(new Date(value));
}
export function timeLabel(value: string) { return dateLabel(value, { day: undefined, month: undefined, hour: "2-digit", minute: "2-digit" }); }
