"use client";
import { useState } from "react";
import catalogue from "@/modules/clinical/f40-catalogue.json";
import type { FormDefinition } from "@/lib/assessments";
import { Button, Badge } from "@/components/ui/primitives";
export function MethodCatalogue({ definitions, assignableIds, onSelect }: { definitions: FormDefinition[]; assignableIds: string[]; onSelect: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const found = catalogue.filter(item => `${item.title} Г${item.appendix}`.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru")));
  return <details className="assessment-source"><summary>Все методики из рекомендаций · {catalogue.length}</summary><label className="field"><span>Найти методику</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Название, сокращение или приложение" /></label>
    <p className="hint">Для части методик доступно только описание; ограничения указаны ниже.</p>
    {found.map(item => <article key={item.appendix} className="decision-entry"><h3>Г{item.appendix}. {item.title}</h3><Badge>{item.status === "AVAILABLE" ? "Доступна для заполнения" : item.status === "SOURCE_CONFLICT" ? "Нужна сверка источника" : "Описание методики"}</Badge><p className="secondary-text small-text">{item.respondent === "DOCTOR" ? "Заполняет врач" : "Опросник / психологическое обследование"} · PDF, стр. {item.pages[0]}–{item.pages.at(-1)}</p><p>{item.limitation}</p>
      {item.codes.map(code => { const definition = definitions.find(d => d.form.code === code && assignableIds.includes(d.id)); return definition ? <Button key={code} variant="secondary" onClick={() => onSelect(definition.id)}>{definition.form.respondent === "DOCTOR" ? "Добавить врачебную оценку" : "Назначить"} · {definition.form.title}</Button> : <p key={code} className="secondary-text small-text">Определение ещё не опубликовано или недоступно для возраста пациента.</p>; })}
      <details className="assessment-source"><summary>Описание и ключ из PDF</summary><p style={{ whiteSpace: "pre-wrap" }}>{item.sourceText}</p><a className="text-link" href={`/api/clinical-source?id=f40-455-2024#page=${item.pages[0]}`} target="_blank" rel="noopener noreferrer">Открыть исходный PDF</a></details>
    </article>)}
    {!found.length && <p>Методики не найдены.</p>}
  </details>;
}
