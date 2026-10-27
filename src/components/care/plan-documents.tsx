"use client";
import { useState } from "react";
import { Copy, Printer } from "lucide-react";
import { Button } from "@/components/ui/primitives";
export function PlanDocuments({ patientId, versionId, doctor = false }: { patientId: string; versionId: string; doctor?: boolean }) {
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(""); const [error, setError] = useState("");
  const base = `/api/care/document?patientId=${encodeURIComponent(patientId)}&versionId=${encodeURIComponent(versionId)}`;
  async function copy() { if (busy) return; setBusy(true); setNotice(""); setError(""); try { const r = await fetch(`${base}&audience=doctor&format=text`, { cache: "no-store" }); if (!r.ok) throw new Error((await r.json()).error ?? "Не удалось подготовить запись."); await navigator.clipboard.writeText(await r.text()); setNotice("Проект записи скопирован. Проверьте его перед включением в документацию."); } catch (e) { setError(e instanceof TypeError ? "Нет связи с сервером или недоступно копирование. Повторите попытку." : (e as Error).message); } finally { setBusy(false); } }
  return <div className="plan-documents"><div className="care-actions">{doctor && <Button variant="quiet" busy={busy} onClick={() => void copy()}><Copy size={15} />Копировать проект записи</Button>}<a className="button button-quiet" href={`${base}&audience=patient`} target="_blank" rel="noopener noreferrer"><Printer size={15} />Памятка для печати<span className="sr-only"> · откроется в новой вкладке</span></a></div>{notice && <p className="hint" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}</div>;
}
