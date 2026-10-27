export const doseUnits = ["мг", "мкг", "г", "мл", "табл.", "капс.", "кап.", "доз.", "ЕД"] as const;
export function splitDose(value: string): { amount: string; unit: string } {
  const text = value.trim();
  if (!text) return { amount: "", unit: "" };
  const match = /^(\d+(?:[.,]\d+)?|[.,]\d+)\s*(.*)$/.exec(text);
  if (match && (!match[2] || doseUnits.some(unit => unit === match[2]))) return { amount: match[1], unit: match[2] };
  return { amount: text, unit: "custom" };
}
