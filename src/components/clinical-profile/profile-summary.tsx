"use client";
import { ArrowUpRight } from "lucide-react";
import type { ClinicalProfile } from "@/lib/clinical-profile";
import { categoryNames, evidenceNames, intakeNames, statusNames, type ProfileCategory } from "@/modules/clinical-profile/contract";
import { dateLabel } from "@/lib/format";
import { Button } from "@/components/ui/primitives";

const categories: ProfileCategory[] = ["conditions", "allergies", "medications"];
export function ProfileSummary({ profile, loading, available, dirty, onOpen }: { profile: ClinicalProfile | null; loading: boolean; available: boolean; dirty: boolean; onOpen: () => void }) {
  return <>
    <div className="surface-header"><h2>Клинические сведения</h2><Button variant="quiet" disabled={!available} onClick={onOpen}>Открыть сведения<ArrowUpRight size={16} aria-hidden="true" /></Button></div>
    <div className="surface-body">
      {loading ? <p role="status">Загружаем сведения…</p> : available ? <>
        <div className="profile-overview-grid">{categories.map(category => {
          const section = profile?.content[category]; const items = section?.items ?? [];
          return <section className="profile-overview-category" key={category} aria-label={categoryNames[category]}>
            <h3>{category === "medications" ? "Препараты" : categoryNames[category]}</h3>
            {section?.status === "KNOWN" ? <ul>{items.slice(0, 3).map(item => { const medication = category === "medications" ? profile?.content.medications.items.find(entry => entry.id === item.id) : undefined; return <li key={item.id}>
              <strong>{item.title}</strong>
              {medication && <span>{intakeNames[medication.intake]}</span>}
              {medication?.regimen && <span>{medication.regimen}</span>}
              <small>{evidenceNames[item.evidence.kind]}{item.evidence.date ? ` · ${dateLabel(item.evidence.date)}` : " · дата не указана"}</small>
            </li>; })}</ul> : <p className="profile-overview-status">{statusNames[section?.status ?? "UNKNOWN"]}</p>}
            {section?.status === "NONE" && section.evidence && <small>{evidenceNames[section.evidence.kind]}{section.evidence.date ? ` · ${dateLabel(section.evidence.date)}` : " · дата не указана"}</small>}
            {items.length > 3 && <Button variant="quiet" onClick={onOpen}>Ещё записей: {items.length - 3}</Button>}
          </section>;
        })}</div>
        <div className="profile-overview-footer"><span>{profile ? `Версия ${profile.version} · ${profile.savedBy} · ${dateLabel(profile.createdAt)}` : "Нет сохранённых сведений. Не уточнено — не значит отсутствует."}</span>{dirty && <span>Есть несохранённый ввод</span>}</div>
      </> : <p className="secondary-text">Сведения недоступны. Обновите данные.</p>}
    </div>
  </>;
}
