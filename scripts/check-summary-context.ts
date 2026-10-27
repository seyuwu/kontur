import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { summarizeWithProvider, summaryConfiguration } from "../src/modules/summaries/provider";
const cases = [
  {name:"questionnaires_without_diagnosis",sources:[
    {id:"a",label:"Анкета СТ-С · 24 октября",text:"Период: сейчас. Программный результат: 24. Ответ: часто испытываю напряжение. Учебный пример."},
    {id:"b",label:"Анкета BAI · 25 октября",text:"Период: последняя неделя. Программный результат: 29. Ответ: умеренно выраженное беспокойство. Учебный пример."},
    {id:"c",label:"Клинические сведения",text:"Диагноз не указан. Аллергии и препараты не уточнены."}
  ]},
  {name:"primary_with_comparison",sources:[
    {id:"current",role:"PRIMARY" as const,label:"Текущая анкета BAI · 26 октября",text:"Учебные данные. Период: последняя неделя. Программный результат: 29. Пункт беспокойство: умеренно. Пункт напряжение: сильно."},
    {id:"previous",role:"PREVIOUS" as const,label:"Прошлая анкета BAI · 19 октября",text:"Период: последняя неделя. Программный результат: 35. comparison: comparable=true; previousDate=19 октября; currentDate=26 октября; previousValue=35; currentValue=29; difference=-6. Ответ напряжение: сильно в обеих анкетах. Разница баллов не доказывает клинически значимого изменения."},
    {id:"related",role:"RELATED" as const,label:"Другая анкета СТ-С · 25 октября",text:"Период: сейчас. Программный результат: 24. Ответ напряжение: часто. Другая методика; баллы с BAI не сравнивать."},
    {id:"note",role:"CONTEXT" as const,label:"Заметка врача · текущая карточка",text:"Договорились обсудить сохраняющееся напряжение на приёме 28 октября. Назначения лекарств не указаны."}
  ]}
];
const results=[];
for(const item of cases){const start=Date.now();try{const result=await summarizeWithProvider(item.sources,[]);results.push({name:item.name,durationMs:Date.now()-start,result});console.log(JSON.stringify({name:item.name,facts:result.facts.length,passed:true,durationMs:Date.now()-start}));}catch(e){console.log(JSON.stringify({name:item.name,passed:false,error:e instanceof Error?e.message:"unknown"}));process.exitCode=1;}}
await writeFile("docs/evidence/summary-context-live-2026-10-26.json",JSON.stringify({at:new Date().toISOString(),syntheticOnly:true,clinicalValidation:false,model:summaryConfiguration().model,results},null,2));
