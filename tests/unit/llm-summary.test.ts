import { afterEach, describe, expect, it, vi } from "vitest";
import { summarizeWithGroq, validateSummary, summaryConfiguration, bindSummaryEvidence, summaryFragments } from "../../src/modules/summaries/provider";
const sources = [{ id: "s1", label: "Анкета", text: "Период: последняя неделя. Балл: 36. Не принимал препарат." }];
const actions = [{ id: "review", label: "Разобрать ответы", description: "Сверить с исходными данными" }];
const valid = { facts: [{ text: "В анкете 36 баллов", evidence: [{ sourceId: "s1", quote: "Балл: 36." }] }], actionIds: ["review"], limitations: ["Это учебные данные."] };
afterEach(() => vi.unstubAllEnvs());
describe("Groq summary boundary", () => {
  it("requires an enabled synthetic-data contour and key", async () => {
    vi.stubEnv("DEMO_MODE","false"); vi.stubEnv("GROQ_API_KEY","synthetic"); vi.stubEnv("LLM_SUMMARY_ENABLED","true");
    const request = vi.fn(); await expect(summarizeWithGroq(sources,actions,request)).rejects.toThrow("NOT_CONFIGURED"); expect(request).not.toHaveBeenCalled();
    vi.stubEnv("DEMO_MODE","true"); vi.stubEnv("GROQ_API_KEY",""); expect(summaryConfiguration().enabled).toBe(false);
  });
  it("rejects invented citations, cross-source quotes and actions", () => {
    expect(validateSummary(valid,sources,actions)).toEqual(valid);
    expect(() => validateSummary({...valid, actionIds:["prescribe_drug"]},sources,actions)).toThrow("INVALID_ACTION");
    expect(() => validateSummary({...valid, facts:[{text:"Факт",evidence:[{sourceId:"other_patient",quote:"Балл: 36."}]}]},sources,actions)).toThrow("INVALID_EVIDENCE");
    expect(() => validateSummary({...valid, facts:[{text:"Факт",evidence:[{sourceId:"s1",quote:"Балл: 50."}]}]},sources,actions)).toThrow("INVALID_EVIDENCE");
  });
  it("uses the fixed Groq endpoint and validates the structured output", async () => {
    vi.stubEnv("DEMO_MODE","true"); vi.stubEnv("GROQ_API_KEY","synthetic"); vi.stubEnv("LLM_SUMMARY_ENABLED","true");
    const request=vi.fn(async(url,init) => { expect(url).toBe("https://api.groq.com/openai/v1/chat/completions"); const body=JSON.parse(String(init?.body)); expect(body.response_format.json_schema.strict).toBe(true); expect(body.messages[0].content).toContain("недоверенные"); return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({...valid,facts:[{text:valid.facts[0].text,evidenceIds:["e1"]}]})}}]}); }) as unknown as typeof fetch;
    expect(await summarizeWithGroq(sources,actions,request)).toEqual({...valid,facts:[{text:valid.facts[0].text,evidence:[{sourceId:"s1",quote:sources[0].text}]}]});
  });
  it("binds references to original text without asking the model to retype quotes", () => {
    const original = [{id:"a",label:"Первая",text:'Не принимал «препарат».\n  Дата: 24.10.2026.'}, {id:"b",label:"Вторая",text:"Балл: 36."}];
    const selected = {facts:[{text:"Факт",evidenceIds:["e2"]}],actionIds:[],limitations:[]};
    expect(bindSummaryEvidence(selected,original,[]).facts[0].evidence).toEqual([{sourceId:"b",quote:"Балл: 36."}]);
    expect(bindSummaryEvidence({...selected,facts:[{text:"Факт",evidenceIds:["e1"]}]},original,[]).facts[0].evidence[0].quote).toBe(original[0].text);
    expect(()=>bindSummaryEvidence({...selected,facts:[{text:"Факт",evidenceIds:["other_patient"]}]},original,[])).toThrow("INVALID_EVIDENCE");
    const long = [{id:"long",label:"Длинный",text:"Ответ  \n".repeat(700)}];
    const fragments = summaryFragments(long);
    expect(fragments.map(f=>f.quote).join("")).toBe(long[0].text);
    expect(fragments.every(f=>f.quote.length<=900)).toBe(true);
  });
  it("rejects truncation and provider errors without returning unverified prose", async () => {
    vi.stubEnv("DEMO_MODE","true"); vi.stubEnv("GROQ_API_KEY","synthetic"); vi.stubEnv("LLM_SUMMARY_ENABLED","true");
    await expect(summarizeWithGroq(sources,actions,async()=>Response.json({choices:[{finish_reason:"length",message:{content:"{}"}}]}))).rejects.toThrow("INCOMPLETE_OUTPUT");
    await expect(summarizeWithGroq(sources,actions,async()=>new Response("secret provider detail",{status:429}))).rejects.toThrow("PROVIDER_LIMIT");
  });
});

it("does not accept an empty summary when questionnaire answers are available",async()=>{
  vi.stubEnv("DEMO_MODE","true");vi.stubEnv("LLM_SUMMARY_PROVIDER","mistral");vi.stubEnv("MISTRAL_API_KEY","synthetic");vi.stubEnv("LLM_SUMMARY_ENABLED","true");
  await expect(summarizeWithGroq([{id:"current",label:"Текущая анкета",text:"Балл: 29. Ответ: умеренно."}],[],async()=>Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({facts:[],actionIds:[],limitations:["Нет диагноза, анализ невозможен"]})}}]}))).rejects.toThrow("EMPTY_OUTPUT");
});

it("keeps questionnaire facts and drops standalone context instead of failing the whole summary",async()=>{
  vi.stubEnv("DEMO_MODE","true");vi.stubEnv("LLM_SUMMARY_PROVIDER","mistral");vi.stubEnv("MISTRAL_API_KEY","synthetic");vi.stubEnv("LLM_SUMMARY_ENABLED","true");
  const result=await summarizeWithGroq([{id:"current",role:"PRIMARY",label:"Текущая анкета",text:"Балл: 29"},{id:"context",role:"CONTEXT",label:"Заметка",text:"Дата приёма: 28 октября"}],[],async()=>Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({facts:[{text:"В анкете 29 баллов",evidenceIds:["e1"]},{text:"Назначен приём",evidenceIds:["e2"]},{text:"Разница не считается клинически значимой",evidenceIds:["e1"]}],actionIds:[],limitations:[]})}}]}));
  expect(result.facts).toHaveLength(1);expect(result.facts[0].evidence[0].sourceId).toBe("current");
});

it("retries an empty response once and returns the checked second response",async()=>{
  vi.stubEnv("DEMO_MODE","true");vi.stubEnv("LLM_SUMMARY_PROVIDER","mistral");vi.stubEnv("MISTRAL_API_KEY","synthetic");vi.stubEnv("LLM_SUMMARY_ENABLED","true");
  const request=vi.fn().mockResolvedValueOnce(Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({facts:[],actionIds:[],limitations:[]})}}]})).mockResolvedValueOnce(Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({facts:[{text:"Балл: 29",evidenceIds:["e1"]}],actionIds:[],limitations:[]})}}]}));
  const result=await summarizeWithGroq([{id:"s",label:"Анкета",text:"Балл: 29"}],[],request);
  expect(request).toHaveBeenCalledTimes(2);expect(result.facts[0].text).toBe("Балл: 29");
});
