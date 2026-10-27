import { afterEach, describe, expect, it, vi } from "vitest";
import { withSummaryLock } from "../../src/modules/summaries/request-lock";
import { summarySourceText } from "../../src/modules/summaries/source-text";
import { summarizeWithProvider, validateSummary } from "../../src/modules/summaries/provider";
afterEach(()=>vi.unstubAllEnvs());
describe("Summary retry and source fidelity",()=>{
  it("releases the guard immediately after failure and after success",async()=>{
    await expect(withSummaryLock("doctor_retry",async()=>{throw Error("invalid evidence");})).rejects.toThrow("invalid evidence");
    expect(await withSummaryLock("doctor_retry",async()=>"retry now")).toBe("retry now");
    expect(await withSummaryLock("doctor_retry",async()=>"again")).toBe("again");
  });
  it("blocks only overlapping work for the same doctor and releases after rejection",async()=>{
    let finish!:()=>void;const wait=new Promise<void>(resolve=>{finish=resolve;});
    const first=withSummaryLock("doctor_overlap",()=>wait);
    await expect(withSummaryLock("doctor_overlap",async()=>"duplicate")).rejects.toMatchObject({status:429});
    expect(await withSummaryLock("other_doctor",async()=>"independent")).toBe("independent");
    finish();await first;expect(await withSummaryLock("doctor_overlap",async()=>"next")).toBe("next");
  });
  it("keeps literal quotation marks and newlines in source citations instead of JSON escapes",()=>{
    const value={period:"Последняя неделя",answers:[{question:'Мысли: «мне плохо»',answer:'Ответ "иногда"\nуточнить'}],note:"Не принимает препарат."};
    const text=summarySourceText(value);expect(text).toContain('Ответ "иногда"\nуточнить');expect(text).not.toContain('\\"');
    const output={facts:[{text:"Ответ нуждается в уточнении",evidence:[{sourceId:"s",quote:'Ответ "иногда"\nуточнить'}]}],actionIds:[],limitations:[]};
    expect(validateSummary(output,[{id:"s",label:"Учебный источник",text}],[])).toEqual(output);
    expect(()=>validateSummary(output,[{id:"s",label:"JSON",text:JSON.stringify(value)}],[])).toThrow("INVALID_EVIDENCE");
  });
  it("sets a 30-second provider deadline and reports timeout separately",async()=>{
    vi.stubEnv("DEMO_MODE","true");vi.stubEnv("LLM_SUMMARY_ENABLED","true");vi.stubEnv("LLM_SUMMARY_PROVIDER","mistral");vi.stubEnv("MISTRAL_API_KEY","synthetic");vi.stubEnv("MISTRAL_SUMMARY_MODEL","ministral-14b-latest");
    const timeout=vi.spyOn(AbortSignal,"timeout");
    try{
      await expect(summarizeWithProvider([{id:"s",label:"Учебный",text:"Балл: 36"}],[],async()=>{throw new DOMException("timed out","TimeoutError");})).rejects.toThrow("PROVIDER_TIMEOUT");
      expect(timeout).toHaveBeenCalledWith(30000);
    }finally{timeout.mockRestore();}
  });
});
