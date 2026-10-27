import { beforeEach, expect, it, vi } from "vitest";
import { demoDefinition } from "../../src/modules/clinical/demo-definition";
const h=vi.hoisted(()=>({
  patient:vi.fn(), submissions:vi.fn(), observations:vi.fn(), messages:vi.fn(), plan:vi.fn(), audit:vi.fn(), profile:vi.fn(), event:vi.fn(), summarize:vi.fn(), upsert:vi.fn(), savedFind:vi.fn(), submissionFind:vi.fn()
}));
vi.mock("@/server/db",()=>{const db={patient:{findFirst:h.patient},assessmentSubmission:{findMany:h.submissions,findFirst:h.submissionFind},observation:{findMany:h.observations},message:{findMany:h.messages},carePlanVersion:{findFirst:h.plan},auditEvent:{create:h.audit},savedSummary:{upsert:h.upsert,findUnique:h.savedFind}};return{db:{...db,$transaction:async(fn:(tx:typeof db)=>unknown)=>fn(db)}};});
vi.mock("@/modules/clinical-profile",()=>({getClinicalProfile:h.profile}));
vi.mock("@/modules/monitoring",()=>({getReviewEvent:h.event}));
vi.mock("@/modules/assessments/definitions",()=>({readDefinition:(record:{content?:unknown})=>record.content ?? demoDefinition}));
vi.mock("@/modules/summaries/provider",async(importOriginal)=>({...await importOriginal<typeof import("../../src/modules/summaries/provider")>(),summaryConfiguration:()=>({enabled:true,model:"synthetic"}),summarizeWithProvider:h.summarize}));
import { ExtractionError } from "../../src/modules/documents/extractor";
import { createSummary } from "../../src/modules/summaries";
import { getSavedSummary } from "../../src/modules/summaries/saved";
const actor={id:"doctor",name:"Учебный врач",email:"doctor@synthetic.test",role:"DOCTOR",specialty:null};
beforeEach(()=>{
  vi.resetAllMocks();
  h.patient.mockResolvedValue({id:"patient",note:"DOCTOR_NOTE_MUST_NOT_BE_SENT",currentPlanId:"plan",clinicalDataVersion:1,updatedAt:new Date("2026-10-24")});
  h.summarize.mockResolvedValue({facts:[],actionIds:[],limitations:[]});
  const current={answers:{clarity:"clear",contact:"no"},note:"Комментарий только к анкете",createdAt:new Date("2026-10-24"),assignment:{definition:{}}};
  h.submissions.mockImplementation(async args => args.where.assignment.id ? [current] : []);
  h.submissionFind.mockResolvedValue({id:"submission"});
  h.profile.mockResolvedValue({current:null});h.plan.mockResolvedValue(null);
  h.observations.mockResolvedValue([]);h.messages.mockResolvedValue([]);
});
it("keeps the selected questionnaire primary, includes general context but never reads chat",async()=>{
  const result=await createSummary(actor,{patientId:"patient",assignmentId:"selected"});
  expect(h.submissions).toHaveBeenCalledWith(expect.objectContaining({where:{assignment:{patientId:"patient",id:"selected"}},take:1}));
  const sources=h.summarize.mock.calls[0][0];
  expect(sources[0].role).toBe("PRIMARY");expect(sources[0].text).toContain(demoDefinition.questions[0].title);
  expect(sources[0].text).toContain("Комментарий только к анкете");
  expect(sources.some((source:{role:string;text:string})=>source.role==="CONTEXT"&&source.text.includes("DOCTOR_NOTE_MUST_NOT_BE_SENT"))).toBe(true);
  expect(h.messages).not.toHaveBeenCalled();expect(h.observations).not.toHaveBeenCalled();
  expect(result.scope).toContain("основной источник");
});
it("does not fall back to other sources when the selected questionnaire is unavailable",async()=>{
  h.submissions.mockResolvedValue([]);
  await expect(createSummary(actor,{patientId:"patient",assignmentId:"unavailable"})).rejects.toMatchObject({status:404});
  expect(h.summarize).not.toHaveBeenCalled();expect(h.messages).not.toHaveBeenCalled();
});
it("summarizes only the selected event and its source questionnaire",async()=>{
  h.event.mockResolvedValue({patientId:"patient",createdAt:"2026-10-24",title:"Учебное событие",reason:"Основание",revision:1,actions:[],source:{form:demoDefinition,answers:{clarity:"clear",contact:"no"},metric:{value:0},note:"Комментарий к событию"}});
  const result=await createSummary(actor,{patientId:"patient",eventId:"event"});
  expect(h.submissions).not.toHaveBeenCalled();
  for(const query of [h.messages,h.observations,h.profile,h.plan])expect(query).not.toHaveBeenCalled();
  expect(h.summarize.mock.calls[0][0]).toHaveLength(1);expect(result.scope).toContain("Только выбранное событие");
});
it("replaces the same saved slot on success and preserves it when regeneration fails",async()=>{
  const selection={patientId:"patient",assignmentId:"selected"};
  const first=await createSummary(actor,selection);
  expect(h.upsert).toHaveBeenLastCalledWith(expect.objectContaining({where:{patientId_doctorId_scopeKey:{patientId:"patient",doctorId:"doctor",scopeKey:"assignment:selected"}},update:{payload:first}}));
  h.summarize.mockResolvedValueOnce({facts:[],actionIds:[],limitations:["Новое обобщение"]});
  const second=await createSummary(actor,selection);expect(second.limitations).toEqual(["Новое обобщение"]);
  expect(h.upsert).toHaveBeenCalledTimes(2);expect(h.upsert.mock.calls[1][0].where).toEqual(h.upsert.mock.calls[0][0].where);
  h.summarize.mockRejectedValueOnce(Error("failed"));await expect(createSummary(actor,selection)).rejects.toMatchObject({status:502});
  expect(h.upsert).toHaveBeenCalledTimes(2);
  h.submissionFind.mockResolvedValue({id:"submission"});h.savedFind.mockResolvedValue({payload:second});
  expect(await getSavedSummary(actor,selection)).toEqual(second);expect(h.summarize).toHaveBeenCalledTimes(3);
  expect(h.savedFind).toHaveBeenCalledWith({where:{patientId_doctorId_scopeKey:{patientId:"patient",doctorId:"doctor",scopeKey:"assignment:selected"}}});
});
it("does not expose stored summaries to patients or another doctor's inaccessible card",async()=>{
  await expect(getSavedSummary({...actor,role:"PATIENT"},{patientId:"patient"})).rejects.toMatchObject({status:403});
  h.patient.mockResolvedValue(null);await expect(getSavedSummary({...actor,id:"other"},{patientId:"patient"})).rejects.toMatchObject({status:404});
  expect(h.savedFind).not.toHaveBeenCalled();
});

it("automatic generation reuses unchanged sources without another provider request",async()=>{
  const input={patientId:"patient",assignmentId:"selected"};
  h.submissionFind.mockResolvedValue({id:"submission"});
  h.summarize.mockImplementation(async sources => ({facts:[{text:"Учебный ответ",evidence:[{sourceId:sources[0].id,quote:sources[0].text.slice(0,100)}]}],actionIds:[],limitations:[]}));
  const first=await createSummary(actor,input,true);
  h.savedFind.mockResolvedValue({payload:first});
  expect(await createSummary(actor,input,true)).toEqual(first);
  expect(h.summarize).toHaveBeenCalledTimes(1);
  h.submissions.mockResolvedValue([{answers:{clarity:"clear",contact:"no"},note:"Исправленный ответ",createdAt:new Date("2026-10-24"),assignment:{definition:{}}}]);
  const next=await createSummary(actor,input,true);
  expect(next.sourceFingerprint).not.toEqual(first.sourceFingerprint);
  expect(h.summarize).toHaveBeenCalledTimes(2);
});
it("does not save a summary if its source changes during the request",async()=>{
  h.summarize.mockImplementationOnce(async()=>{
    h.submissions.mockResolvedValue([{answers:{clarity:"clear",contact:"no"},note:"Изменено во время запроса",createdAt:new Date("2026-10-24"),assignment:{definition:{}}}]);
    return {facts:[],actionIds:[],limitations:[]};
  });
  await expect(createSummary(actor,{patientId:"patient",assignmentId:"selected"})).rejects.toMatchObject({status:409});
  expect(h.upsert).not.toHaveBeenCalled();
});

it("compares only older questionnaires of the same version and computes delta in code",async()=>{
  const current={answers:{clarity:"clear",contact:"no"},note:"Текущая",createdAt:new Date("2026-10-24"),assignment:{definition:{}}};
  const previous={...current,answers:{clarity:"unclear",contact:"no"},createdAt:new Date("2026-10-20")};
  const different={...previous,assignment:{definition:{content:{...demoDefinition,version:2}}}};
  h.submissions.mockImplementation(async args => args.where.assignment.id ? [current] : typeof args.where.assignment.definitionCode === "string" ? [previous,different] : []);
  const result=await createSummary(actor,{patientId:"patient",assignmentId:"selected"});
  const history=result.sources.filter(s=>s.role==="PREVIOUS");
  expect(history).toHaveLength(2);
  expect(history[0].text).toContain("difference: -2");expect(history[0].text).toContain("changedAnswerCount: 1");
  expect(history[1].text).toContain("comparable: false");expect(history[1].text).not.toContain("difference:");
  expect(result.facts.some(f=>f.text.includes("Разница: -2"))).toBe(true);
  expect(result.facts.some(f=>f.text.includes("Числовое сравнение не выполнено"))).toBe(true);
  expect(h.submissions).toHaveBeenCalledWith(expect.objectContaining({where:{assignment:{patientId:"patient",definitionCode:demoDefinition.code},assignmentId:{not:"selected"},createdAt:{lt:current.createdAt}},take:3}));
});
it("refreshes an empty saved summary even if its fingerprint still matches",async()=>{
  const input={patientId:"patient",assignmentId:"selected"};h.submissionFind.mockResolvedValue({id:"submission"});
  const first=await createSummary(actor,input,true);h.savedFind.mockResolvedValue({payload:first});
  await createSummary(actor,input,true);expect(h.summarize).toHaveBeenCalledTimes(2);
});

it("shows an explicitly labelled factual questionnaire summary when the model returns incomplete output",async()=>{
  h.summarize.mockRejectedValueOnce(new ExtractionError("INCOMPLETE_OUTPUT"));
  const result=await createSummary(actor,{patientId:"patient",assignmentId:"selected"});
  expect(result.generation).toBe("RULES");expect(result.facts.length).toBeGreaterThan(0);
  expect(result.facts[0].text).toContain(demoDefinition.title);
  expect(result.facts[0].text).toContain("0");expect(result.retryAfter).toBeDefined();
  h.savedFind.mockResolvedValue({payload:result});
  expect(await createSummary(actor,{patientId:"patient",assignmentId:"selected"},true)).toEqual(result);
  expect(h.summarize).toHaveBeenCalledTimes(1);
  h.savedFind.mockResolvedValue({payload:{...result,retryAfter:"2000-01-01T00:00:00.000Z"}});
  await createSummary(actor,{patientId:"patient",assignmentId:"selected"},true);
  expect(h.summarize).toHaveBeenCalledTimes(2);
});

it("preserves a valid saved model summary when a manual replacement is incomplete",async()=>{
  h.summarize.mockImplementationOnce(async sources=>({facts:[{text:"Сохранённый факт",evidence:[{sourceId:sources[0].id,quote:sources[0].text.slice(0,100)}]}],actionIds:[],limitations:[]}));
  const input={patientId:"patient",assignmentId:"selected"};
  const first=await createSummary(actor,input);h.savedFind.mockResolvedValue({payload:first});
  h.summarize.mockRejectedValueOnce(new ExtractionError("EMPTY_OUTPUT"));
  expect(await createSummary(actor,input)).toEqual(first);expect(h.upsert).toHaveBeenCalledTimes(1);
});
