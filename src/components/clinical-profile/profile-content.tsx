"use client";
import type { ClinicalProfile } from "@/lib/clinical-profile";
import { categoryNames, evidenceNames, intakeNames, statusNames, type Evidence, type ProfileCategory } from "@/modules/clinical-profile/contract";
import { dateLabel } from "@/lib/format";
import { Badge } from "@/components/ui/primitives";
const categories: ProfileCategory[] = ["conditions", "allergies", "medications"];
export function EvidenceView({ evidence }: { evidence: Evidence }) {
  return <div><p className="profile-evidence"><strong>{evidenceNames[evidence.kind]}</strong> · {evidence.reference}{evidence.date ? ` · ${dateLabel(evidence.date, { year: "numeric" })}` : " · дата источника не указана"}</p>{evidence.document && <details className="assessment-source"><summary>Фрагмент источника</summary><blockquote className="document-quote">{evidence.document.quote}</blockquote><a className="text-link" href={`/api/documents/source?id=${evidence.document.id}`} target="_blank" rel="noopener noreferrer">Открыть оригинал в новой вкладке</a></details>}</div>;
}
export function ProfileContentView({ profile }: { profile: ClinicalProfile }) {
  return <><div className="profile-attribution"><Badge>{profile.isCurrent ? "Действующая версия" : "Архивная версия"} · {profile.version}</Badge><p>Зафиксировал {profile.savedBy} · {dateLabel(profile.createdAt, { year: "numeric", hour: "2-digit", minute: "2-digit" })}</p></div>
    <p className="hint">Сведения приведены по указанным источникам; противопоказания автоматически не проверяются.</p>
    {categories.map(category => { const section = profile.content[category]; return <section className="profile-category" key={category}><h3>{categoryNames[category]}</h3><p className="profile-status">{statusNames[section.status]}</p>{section.note && <p className="care-prose">{section.note}</p>}{section.evidence && <EvidenceView evidence={section.evidence} />}
      {section.items.map(item => <div className="profile-fact" key={item.id}><strong>{item.title}</strong>{"intake" in item && <p className="profile-intake">{intakeNames[item.intake]}</p>}{"regimen" in item && <p className="care-prose">Режим по источнику: {item.regimen || "не уточнён"}</p>}{"startedOn" in item && (item.startedOn || item.stoppedOn) && <p className="secondary-text small-text">{item.startedOn ? `Начало: ${dateLabel(item.startedOn)}` : "Начало не уточнено"}{item.stoppedOn ? ` · прекращение: ${dateLabel(item.stoppedOn)}` : ""}</p>}{item.details && <p className="care-prose">{item.details}</p>}<EvidenceView evidence={item.evidence} /></div>)}
    </section>; })}
  </>;
}
