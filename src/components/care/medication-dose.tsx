"use client";
import { useEffect, useRef, useState } from "react";
import { doseUnits, splitDose } from "@/lib/medication-dose";

export function MedicationDose({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [dose, setDose] = useState(() => splitDose(value));
  const lastWritten = useRef(value);
  useEffect(() => { if (value !== lastWritten.current) { setDose(splitDose(value)); lastWritten.current = value; } }, [value]);
  function update(amount: string, unit: string) {
    setDose({ amount, unit });
    const next = unit === "custom" ? amount : [amount, unit].filter(Boolean).join(" ");
    lastWritten.current = next; onChange(next);
  }
  return <div className="medication-dose-fields">
    <label className="field"><span>{dose.unit === "custom" ? "Доза на один приём" : "Количество на один приём"}</span>
      <input required maxLength={180} inputMode={dose.unit === "custom" ? "text" : "decimal"} value={dose.amount}
        pattern={dose.unit === "custom" ? ".*[А-Яа-яA-Za-zµμ%].*" : "([0-9]+([.,][0-9]+)?|[.,][0-9]+)"}
        title={dose.unit === "custom" ? "Укажите дозу вместе с единицей измерения" : "Положительное число"}
        onChange={e => { e.target.setCustomValidity(dose.unit !== "custom" && e.target.value && Number(e.target.value.replace(",", ".")) <= 0 ? "Количество должно быть больше нуля." : ""); update(e.target.value, dose.unit); }} />
    </label>
    <label className="field"><span>Единица</span><select required value={dose.unit} onChange={e => update(dose.unit === "custom" || e.target.value === "custom" ? "" : dose.amount, e.target.value)}>
      <option value="">Выберите</option>{doseUnits.map(unit => <option key={unit} value={unit}>{({ "табл.": "таблетки", "капс.": "капсулы", "кап.": "капли", "доз.": "дозы" } as Record<string, string>)[unit] ?? unit}</option>)}<option value="custom">Своя запись</option>
    </select></label>
  </div>;
}
