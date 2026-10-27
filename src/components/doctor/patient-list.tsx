"use client";
import type { ReactNode } from "react";
import { Search, ArrowUpRight, CalendarDays, ShieldCheck, Users } from "lucide-react";
import type { PatientFilter, PatientSummary, DirectoryData } from "@/lib/patients";
import { visitLabel } from "@/lib/appointment";
import { age, dateLabel, yearsLabel } from "@/lib/format";
import { Avatar, Badge, Button, EmptyState } from "@/components/ui/primitives";

export type Filter = PatientFilter;

export function PatientList({ patients, filter, search, upcoming, matchedTotal, total, loading, error, nextCursor, page, setFilter, setSearch, onNext, onPrevious, onReset, onRetry, onSelect, reviewInbox }: {
  reviewInbox?: ReactNode; patients: PatientSummary[]; filter: Filter; search: string; upcoming: DirectoryData["upcoming"]; matchedTotal: number; total: number; loading: boolean; error: string; nextCursor?: string | null; page: number;
  setFilter: (filter: Filter) => void; setSearch: (search: string) => void; onNext: (cursor: string) => void; onPrevious: () => void; onReset: () => void; onRetry: () => void;
  onSelect: (patient: Pick<PatientSummary, "id">, messages?: boolean) => void;
}) {
  const matching = patients;
  return <div className="list-layout"><section className="patient-sheet" aria-label="Список пациентов">
    <div className="list-toolbar"><div className="segmented" role="group" aria-label="Фильтр пациентов">
      {([['all', 'Все пациенты'], ['attention', 'Внимание'], ['pending', 'Подключение'], ['messages', 'Сообщения']] as const).map(([id, label]) => <button key={id} type="button" className={filter === id ? "is-active" : ""} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
    </div><label className="search-field"><Search size={15} aria-hidden="true" /><input type="search" maxLength={120} aria-label="Найти пациента" placeholder="Имя или номер карты" value={search} onChange={e => setSearch(e.target.value)} /></label></div>
    {reviewInbox}
    {error && <div className="directory-message form-error" role="alert">{error}<Button variant="quiet" onClick={onRetry}>Повторить</Button>{page > 1 && <Button variant="quiet" onClick={onReset}>К началу списка</Button>}</div>}
    {loading && !matching.length ? <p className="directory-message secondary-text" role="status">Ищем пациентов…</p> : matching.length ? <table className="patient-table" aria-busy={loading}><thead><tr><th>Пациент</th><th>Состояние наблюдения</th><th className="contact-column">Последняя отметка</th><th className="visit-column">Дата следующего приёма</th><th className="table-arrow"><span className="sr-only">Открыть</span></th></tr></thead><tbody>{matching.map((patient, index) => {
      const unread = patient.unreadMessages;
      return <tr key={patient.id} onClick={() => onSelect(patient, filter === "messages")}><td className="patient-name-cell"><button className="patient-name-button" onClick={event => { event.stopPropagation(); onSelect(patient, filter === "messages"); }}><span className="sr-only">Открыть карточку: </span><Avatar name={patient.name} tone={index} /><span><strong>{patient.name}</strong><span>{yearsLabel(age(patient.birthDate))} · {patient.publicId}</span></span></button></td>
      <td>{patient.contactRequests ? <Badge tone="amber">Просит связаться</Badge> : patient.reviewEvents ? <Badge tone="amber">Событие по анкете</Badge> : unread ? <Badge tone="amber">Новое сообщение</Badge> : patient.userId ? <Badge tone="green">На связи</Badge> : <Badge>Ждёт подключения</Badge>}</td>
      <td className="contact-column secondary-text">{patient.lastObservationAt ? dateLabel(patient.lastObservationAt) : "Пока нет данных"}</td><td className="visit-column">{visitLabel(patient.nextVisit,patient.nextVisitHasTime)}</td>
      <td className="table-arrow"><span className="row-arrow" aria-hidden="true"><ArrowUpRight size={16} /></span></td></tr>;
    })}</tbody></table> : !error && <EmptyState icon={<Users size={30} />} title={search ? "Пациент не найден" : page > 1 ? "На этой странице больше нет пациентов" : "В этом списке пока нет пациентов"}>{search ? "Попробуйте другое имя или номер карты." : "Измените фильтр или вернитесь к началу списка."}{page > 1 && <Button variant="secondary" onClick={onReset}>К началу списка</Button>}</EmptyState>}
    <div className="directory-pagination" aria-label="Страницы списка пациентов"><Button variant="quiet" onClick={onPrevious} disabled={page === 1 || loading}>Назад</Button><span className="secondary-text small-text" role="status">Страница {page}</span><Button variant="secondary" onClick={() => nextCursor && onNext(nextCursor)} disabled={!nextCursor || loading}>Дальше</Button></div>
    <div className="table-foot"><ShieldCheck size={13} aria-hidden="true" /><span>На странице {matching.length}. Найдено {matchedTotal} из {total}.</span></div>
  </section><aside className="list-aside" aria-label="Ближайшие приёмы и помощь"><section className="aside-section"><div className="aside-title"><h2>Ближайшие приёмы</h2><CalendarDays size={15} /></div>{upcoming.map(patient => <button type="button" key={patient.id} className="schedule-item" onClick={() => onSelect(patient)}><span className="schedule-date">{visitLabel(patient.nextVisit,patient.nextVisitHasTime)}</span><span><strong>{patient.name}</strong></span><ArrowUpRight size={15} aria-hidden="true" /></button>)}{!upcoming.length && <p className="secondary-text small-text">Приёмы ещё не назначены.</p>}</section>
  </aside></div>;
}
