import { Activity } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? "brand-compact" : ""}`}><span className="brand-mark"><Activity size={23} strokeWidth={1.7} aria-hidden="true" /></span><div><span className="brand-name">контур</span>{!compact && <span className="brand-description">Сопровождение пациента</span>}</div></div>;
}
