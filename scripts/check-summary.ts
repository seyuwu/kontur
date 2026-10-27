import "dotenv/config";
import { summaryConfiguration, summarizeWithProvider } from "../src/modules/summaries/provider";
import { ExtractionError } from "../src/modules/documents/extractor";
import {mkdir,writeFile} from "node:fs/promises";
const measurements:{run:number;facts:number;durationMs:number}[]=[];
const config = summaryConfiguration();
if (!config.enabled) { console.error(config.reason); process.exitCode = 2; }
else {
  try {
    for (let run = 1; run <= 3; run++) {
      const started = Date.now();
      const sources = [
        { id: "demo_bai", label: "Вымышленная анкета BAI, 21 октября", text: "Учебный пациент. Период: последняя неделя. Программный расчёт BAI: 36.\n" + Array.from({length:21}, (_, i)=>`Пункт ${i+1}: ответ «умеренно», требует сопоставления с периодом анкеты.`).join("\n") },
        { id: "demo_scl", label: "Вымышленная анкета SCL-90-R, 24 октября", text: "Учебная анкета. Программный расчёт GSI: 0,8. Это другая методика, не сравнивать с BAI.\n" + Array.from({length:90}, (_, i)=>`Пункт ${i+1}: ответ «немного».`).join("\n") },
        { id: "demo_message", label: "Вымышленное сообщение", text: '24 октября. Хочу обсудить ответы. Не принимал «препарат».\nСон: "иногда просыпаюсь". Прошу связаться.' },
        { id: "demo_plan", label: "Учебный план", text: "Следующий приём: 28.10.2026. Формат: очно. Данные о назначенной терапии отсутствуют." }
      ];
      const result = await summarizeWithProvider(sources, [{ id: "review_answers", label: "Разобрать ответы", description: "Сверить исходные ответы и уточнить состояние при контакте." }]);
      console.info(JSON.stringify({ run, provider: config.provider, model: config.model, live: true, syntheticOnly: true, validCitations: true, factCount: result.facts.length, selectedActions: result.actionIds.length, durationMs: Date.now()-started }));
      measurements.push({run,facts:result.facts.length,durationMs:Date.now()-started});
      if (!result.facts.length) process.exitCode = 1;
    }
  } catch (e) { console.error(`Проверка обобщений не прошла: ${e instanceof ExtractionError ? e.code : "INVALID_OUTPUT"}. Ключ и ответ провайдера не выводятся.`); process.exitCode = 1; }
  await mkdir("docs/evidence",{recursive:true});await writeFile("docs/evidence/summary-evaluation.json",JSON.stringify({at:new Date().toISOString(),provider:config.provider,model:config.model,syntheticOnly:true,clinicalValidation:false,plannedRequests:3,completedRequests:measurements.length,measurements},null,2));
}
