/** Plain text preserves literal source wording without JSON escaping inside citations. */
export function summarySourceText(value: unknown): string {
  if (value === null || value === undefined) return "Не указано";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.map((item, index) => `${index + 1}. ${summarySourceText(item)}`).join("\n");
  return Object.entries(value).map(([key, item]) => `${key}: ${summarySourceText(item)}`).join("\n");
}
