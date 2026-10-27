import "dotenv/config";
import { extractDocument, extractionConfiguration, ExtractionError } from "../src/modules/documents/extractor";
import { locateExtraction } from "../src/modules/documents/contract";
const config = extractionConfiguration();
if (!config.enabled) { console.error("Извлечение не настроено. Добавьте ключ в .env; не отправляйте его в чат."); process.exitCode = 2; }
else {
  const source = "Вымышленный учебный документ. Аллергия на учебный препарат Альфа. Препарат Бета ранее принимался; сейчас приём прекращён.";
  const started = Date.now();
  try { const result = locateExtraction(source, await extractDocument(source, config.model, config.provider)); const allergy = result.facts.some(f => f.section === "allergies" && f.polarity === "PRESENT" && f.quote.includes("Аллергия")); const stopped = result.facts.some(f => f.section === "medications" && f.intake === "STOPPED" && f.quote.includes("прекращён")); console.info(JSON.stringify({ provider: config.provider, model: config.model, live: true, syntheticOnly: true, elapsedMs: Date.now() - started, validCitations: true, expectedAllergy: allergy, expectedStoppedMedication: stopped, factCount: result.facts.length })); if (!allergy || !stopped) process.exitCode = 1; }
  catch (e) { console.error(`Учебная проверка не прошла: ${e instanceof ExtractionError ? e.code : "INVALID_OR_UNCITED_OUTPUT"}. Ключ и ответ провайдера не выводятся.`); process.exitCode = 1; }
}
