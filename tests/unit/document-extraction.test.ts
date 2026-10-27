import { describe, expect, it } from "vitest";
import { locateExtraction, extractionSchema } from "../../src/modules/documents/contract";
import { extractWithOpenAI } from "../../src/modules/documents/extractor";
const source = "Учебный текст. 🧪 Ранее принимал препарат Бета; сейчас приём прекращён. Аллергии не сообщались.";
const fact = { section: "medications", polarity: "PRESENT", scope: "ITEM", title: "Препарат Бета", details: "Прежний приём", quote: "Ранее принимал препарат Бета; сейчас приём прекращён.", intake: "STOPPED", regimen: "", startedOn: null, stoppedOn: null };
const output = { facts: [fact], limitations: ["Учебный пример"] };
describe("Извлечение как непроверенные кандидаты с источниками", () => {
  it("вычисляет точные границы цитаты локально, включая Unicode", () => { const result = locateExtraction(source, output); const f = result.facts[0]; expect(source.slice(f.start, f.end)).toBe(fact.quote); expect(f.intake).toBe("STOPPED"); });
  it("отклоняет отсутствующий и неоднозначный фрагмент", () => { expect(() => locateExtraction(source, { ...output, facts: [{ ...fact, quote: "Нет в источнике" }] })).toThrow("UNCITED_OUTPUT"); expect(() => locateExtraction(source + source, output)).toThrow("UNCITED_OUTPUT"); });
  it("не превращает отсутствие фактов в отрицательный ответ", () => { expect(locateExtraction(source, { facts: [], limitations: [] }).facts).toEqual([]); expect(extractionSchema.safeParse({ facts: [{ ...fact, startedOn: "2026-02-30" }], limitations: [] }).success).toBe(false); });
  it("проверяет противоречивые даты и повторяющиеся факты", () => { expect(() => locateExtraction(source, { ...output, facts: [{ ...fact, startedOn: "2026-10-10", stoppedOn: "2026-10-01" }] })).toThrow("INVALID_FACT"); expect(() => locateExtraction(source, { ...output, facts: [fact, fact] })).toThrow("DUPLICATE_FACT"); });
  it("отправляет строгую схему и разбирает завершённый ответ без внешнего вызова", async () => {
    const mock: typeof fetch = async (_input, init) => { const body = JSON.parse(String(init?.body)); expect(body.store).toBe(false); expect(body.text.format.type).toBe("json_schema"); expect(body.text.format.strict).toBe(true); expect(body.text.format.schema.additionalProperties).toBe(false); expect(body.input[0].content[0].text).toBe(source); return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] }); };
    expect(await extractWithOpenAI(source, "synthetic-model", mock)).toEqual(output);
  });
  it("отдельно обрабатывает отказ и незавершённый результат", async () => {
    const refused: typeof fetch = async () => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "synthetic" }] }] }); const incomplete: typeof fetch = async () => Response.json({ status: "incomplete", output: [] });
    await expect(extractWithOpenAI(source, "synthetic-model", refused)).rejects.toMatchObject({ code: "PROVIDER_REFUSAL" }); await expect(extractWithOpenAI(source, "synthetic-model", incomplete)).rejects.toMatchObject({ code: "INCOMPLETE_OUTPUT" });
  });
  it("не выводит ошибку провайдера как результат извлечения", async () => { const failed: typeof fetch = async () => new Response("synthetic upstream failure", { status: 429 }); await expect(extractWithOpenAI(source, "synthetic-model", failed)).rejects.toMatchObject({ code: "PROVIDER_LIMIT" }); });
});
