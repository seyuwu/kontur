import { afterEach, it, expect, vi } from "vitest";
import { extractWithMistral, extractionConfiguration } from "../../src/modules/documents/extractor";
import { summarizeWithProvider, summaryConfiguration } from "../../src/modules/summaries/provider";
afterEach(()=>vi.unstubAllEnvs());
function configure(){vi.stubEnv("DEMO_MODE","true");vi.stubEnv("MISTRAL_API_KEY","synthetic-key");vi.stubEnv("LLM_SUMMARY_PROVIDER","mistral");vi.stubEnv("LLM_SUMMARY_ENABLED","true");vi.stubEnv("MISTRAL_SUMMARY_MODEL","ministral-14b-latest");vi.stubEnv("DOCUMENT_EXTRACTION_PROVIDER","mistral");vi.stubEnv("DOCUMENT_EXTRACTION_ENABLED","true");vi.stubEnv("MISTRAL_EXTRACTION_MODEL","ministral-14b-latest");}
const response=(value:unknown)=>Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}]});
it("routes Mistral summaries to the fixed endpoint with schema, without Groq-only options",async()=>{
  configure();expect(summaryConfiguration().enabled).toBe(true);
  const sources=[{id:"s",label:"Учебная анкета",text:"Балл: 36."}];
  const output={facts:[{text:"36 баллов",evidence:[{sourceId:"s",quote:"Балл: 36."}]}],actionIds:[],limitations:[]};
  const selected={...output,facts:[{text:"36 баллов",evidenceIds:["e1"]}]};
  const request:typeof fetch=async(url,init)=>{expect(url).toBe("https://api.mistral.ai/v1/chat/completions");const body=JSON.parse(String(init?.body));expect(body.model).toBe("ministral-14b-latest");expect(body.max_tokens).toBe(4096);expect(body).not.toHaveProperty("reasoning_effort");expect(body.response_format.json_schema.strict).toBe(true);return response(selected);};
  expect(await summarizeWithProvider(sources,[],request)).toEqual(output);
  await expect(summarizeWithProvider(sources,[],async()=>response({...selected,actionIds:["invented_action"]}))).rejects.toThrow("INVALID_ACTION");
});
it("validates extraction output and refuses real-data mode, oversize input and arbitrary models",async()=>{
  configure();expect(extractionConfiguration().enabled).toBe(true);
  const request:typeof fetch=async(url)=>{expect(url).toBe("https://api.mistral.ai/v1/chat/completions");return response({facts:[],limitations:[]});};
  expect(await extractWithMistral("Учебный текст","ministral-14b-latest",request)).toEqual({facts:[],limitations:[]});
  await expect(extractWithMistral("x".repeat(8001),"ministral-14b-latest",request)).rejects.toThrow("DOCUMENT_TOO_LONG");
  await expect(extractWithMistral("Учебный текст","arbitrary",request)).rejects.toThrow("NOT_CONFIGURED");
  vi.stubEnv("DEMO_MODE","false");expect(extractionConfiguration().enabled).toBe(false);expect(summaryConfiguration().enabled).toBe(false);
  const none=vi.fn();await expect(extractWithMistral("Учебный текст","ministral-14b-latest",none)).rejects.toThrow("NOT_CONFIGURED");expect(none).not.toHaveBeenCalled();
});
it("does not expose provider details or accept partial or malformed responses",async()=>{
  configure();
  await expect(extractWithMistral("Учебный текст","ministral-14b-latest",async()=>new Response("private provider detail",{status:429}))).rejects.toThrow("PROVIDER_LIMIT");
  await expect(extractWithMistral("Учебный текст","ministral-14b-latest",async()=>Response.json({choices:[{finish_reason:"length",message:{content:"{}"}}]}))).rejects.toThrow("INCOMPLETE_OUTPUT");
  await expect(extractWithMistral("Учебный текст","ministral-14b-latest",async()=>response({facts:[{title:"Invalid"}]}))).rejects.toThrow("INVALID_OUTPUT");
});
