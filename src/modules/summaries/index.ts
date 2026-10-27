import { createHash } from "node:crypto";
import { withSummaryLock } from "./request-lock";
import { summarySourceText } from "./source-text";
import { visitDate } from "@/lib/appointment";
import { db } from "@/server/db";
import { AppError, requireDoctor, requirePatientAccess, type Actor } from "@/server/access";
import { getClinicalProfile } from "@/modules/clinical-profile";
import { readDefinition } from "@/modules/assessments/definitions";
import { evaluateAssessment } from "@/modules/clinical";
import { getReviewEvent } from "@/modules/monitoring";
import { ExtractionError } from "@/modules/documents/extractor";
import { summaryConfiguration, summaryInstructions, summarizeWithProvider, type SummarySource, type SummaryAction, type SummaryOutput } from "./provider";
import { z } from "zod";
import { getSavedSummary, savedSummarySchema, summaryScopeKey, type SummarySelection } from "./saved";

export async function collectSummarySources(actor: Actor, input: SummarySelection) {
  requireDoctor(actor);
  const patient = await requirePatientAccess(actor, input.patientId);
  summaryScopeKey(input);
  const scoped = !!(input.assignmentId || input.eventId);
  const sources: SummarySource[] = [];
  let actions: SummaryAction[] = [];
  const baseline: SummaryOutput["facts"] = [];
  const comparisons: SummaryOutput["facts"] = [];
  const add = (label: string, text: string, role?: SummarySource["role"]) => { sources.push({ id: `source_${sources.length + 1}`, label, text, ...(role ? {role} : {}) }); };
  const addBaseline = (title:string, date:string, period:string, metric:{label:string;value:number}, source:SummarySource) => {
    baseline.push({text:`${title} · ${date}. ${metric.label}: ${metric.value}. Период: ${period}`,evidence:[{sourceId:source.id,quote:source.text.slice(0,900)}]});
  };
  const [profile, observations, submissions, plan, messages] = await Promise.all([
    scoped ? null : getClinicalProfile(actor, patient.id),
    scoped ? [] : db.observation.findMany({ where: { patientId: patient.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5 }),
    input.eventId ? [] : db.assessmentSubmission.findMany({ where: { assignment: { patientId: patient.id, ...(input.assignmentId ? { id: input.assignmentId } : {}) } }, include: { assignment: { include: { definition: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: input.assignmentId ? 1 : 5 }),
    !scoped && patient.currentPlanId ? db.carePlanVersion.findFirst({ where: { id: patient.currentPlanId, patientId: patient.id }, select: { version: true, goal: true, instructions: true, nextContactDate: true, appointment: true, confirmedAt: true, tasks:{orderBy:{position:"asc"},take:20,select:{task:{select:{kind:true,title:true,details:true,medication:true,startDate:true,time:true,repeat:true,dueDate:true}}}} } }) : null,
    scoped ? [] : db.message.findMany({ where: { patientId: patient.id, sender: { role: "PATIENT" } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5, select: { text: true, createdAt: true } })
  ]);
  if (input.assignmentId && !submissions.length) throw new AppError(404, "Отправленная анкета недоступна.");
  if (input.assignmentId) {
    const current = submissions[0];
    const definition = readDefinition(current.assignment.definition);
    const answers = z.record(z.string(), z.string()).parse(current.answers);
    const metric = evaluateAssessment(definition, answers).metric;
    const renderedAnswers = (form: typeof definition, values: Record<string,string>) => form.questions.map(q => ({question:q.title,answer:q.options.find(o => o.id === values[q.id])?.label}));
    add(`Текущая анкета · ${definition.title} · v${definition.version} · ${current.createdAt.toISOString()}`, summarySourceText({period:definition.period,metric,answers:renderedAnswers(definition,answers),note:current.note,limitations:definition.schemaVersion === 1 ? definition.source.validation : definition.provenance.limitations}), "PRIMARY");
    addBaseline(definition.title,current.createdAt.toISOString().slice(0,10),definition.period,metric,sources[0]);
    const [previous, related, contextProfile, contextPlan] = await Promise.all([
      db.assessmentSubmission.findMany({where:{assignment:{patientId:patient.id,definitionCode:definition.code},assignmentId:{not:input.assignmentId},createdAt:{lt:current.createdAt}},include:{assignment:{include:{definition:true}}},orderBy:[{createdAt:"desc"},{id:"desc"}],take:3}),
      db.assessmentSubmission.findMany({where:{assignment:{patientId:patient.id,definitionCode:{not:definition.code}},createdAt:{lte:current.createdAt}},include:{assignment:{include:{definition:true}}},orderBy:[{createdAt:"desc"},{id:"desc"}],take:2}),
      getClinicalProfile(actor,patient.id),
      patient.currentPlanId ? db.carePlanVersion.findFirst({where:{id:patient.currentPlanId,patientId:patient.id},select:{version:true,goal:true,instructions:true,nextContactDate:true,appointment:true,confirmedAt:true,tasks:{orderBy:{position:"asc"},take:20,select:{task:{select:{kind:true,title:true,details:true,medication:true,startDate:true,time:true,repeat:true,dueDate:true}}}}}}) : null
    ]);
    for (const old of previous) {
      const form = readDefinition(old.assignment.definition);
      const oldAnswers = z.record(z.string(),z.string()).parse(old.answers);
      const oldMetric = evaluateAssessment(form,oldAnswers).metric;
      const comparable = form.code === definition.code && form.version === definition.version && JSON.stringify(form.scoring) === JSON.stringify(definition.scoring);
      const changed = comparable ? form.questions.filter(q => oldAnswers[q.id] !== answers[q.id]).map(q => ({question:q.title,previous:q.options.find(o => o.id === oldAnswers[q.id])?.label,current:q.options.find(o => o.id === answers[q.id])?.label})) : [];
      add(`Прошлая анкета · ${form.title} · v${form.version} · ${old.createdAt.toISOString()}`,summarySourceText({period:form.period,metric:oldMetric,note:old.note,comparison:{comparable,previousDate:old.createdAt.toISOString(),currentDate:current.createdAt.toISOString(),...(comparable ? {previousValue:oldMetric.value,currentValue:metric.value,difference:Math.round((metric.value-oldMetric.value)*1000)/1000,changedAnswerCount:changed.length,changedAnswers:changed.slice(0,12),limit:"Показаны до 12 изменившихся ответов; разница баллов не доказывает клинически значимого изменения."} : {reason:"Разные версии или правила расчёта; числовое сравнение недоступно."})}}),"PREVIOUS");
      const previousSource = sources.at(-1)!;
      const difference = Math.round((metric.value-oldMetric.value)*1000)/1000;
      const date = (value:Date) => value.toLocaleDateString("ru-RU",{timeZone:"Europe/Moscow"});
      comparisons.push({
        text:comparable ? `${definition.title}: ${date(old.createdAt)} — ${oldMetric.value}; ${date(current.createdAt)} — ${metric.value}. Разница: ${difference > 0 ? "+" : ""}${difference}. Клиническую значимость оценивает врач.` : `${definition.title}: результаты от ${date(old.createdAt)} и ${date(current.createdAt)} получены по разным версиям или правилам расчёта. Числовое сравнение не выполнено.`,
        evidence:[{sourceId:sources[0].id,quote:sources[0].text.slice(0,900)},{sourceId:previousSource.id,quote:previousSource.text.slice(0,900)}]
      });
    }
    for (const other of related) {
      const form = readDefinition(other.assignment.definition);
      const values = z.record(z.string(),z.string()).parse(other.answers);
      add(`Другая анкета · ${form.title} · v${form.version} · ${other.createdAt.toISOString()}`,summarySourceText({period:form.period,metric:evaluateAssessment(form,values).metric,answers:renderedAnswers(form,values).slice(0,12),note:other.note,limit:"Показаны до 12 ответов. Другая методика: не сравнивать баллы и категории с текущей."}),"RELATED");
    }
    if (contextProfile?.current) for (const [category,section] of Object.entries(contextProfile.current.content)) {
      if (typeof section === "object") add(`Общие сведения · ${category} · версия ${contextProfile.current.version}`,summarySourceText(section),"CONTEXT");
    }
    if (contextPlan) add(`Текущий план · версия ${contextPlan.version}`,summarySourceText({goal:contextPlan.goal,instructions:contextPlan.instructions,nextVisitDate:visitDate(contextPlan),appointment:contextPlan.appointment,confirmedAt:contextPlan.confirmedAt,tasks:contextPlan.tasks}),"CONTEXT");
    if (patient.note) add("Заметка врача · текущая карточка",patient.note,"CONTEXT");
    add("Границы контекста",`Прошлых анкет той же методики: ${previous.length} (не более 3). Других анкет до даты текущей: ${related.length} (не более 2). Переписка не включена. Общие сведения и план отражают текущую карточку, а не обязательно дату анкеты.`,"CONTEXT");
  }
  if (profile?.current) {
    for (const [category, section] of Object.entries(profile.current.content)) {
      if (typeof section !== "object") continue;
      add(`Клинические сведения · ${category} · версия ${profile.current.version}`, summarySourceText(section));
    }
  }
  for (const o of observations) add(`Самоотчёт · ${o.createdAt.toISOString()}`, `${o.note}\nПросьба связаться: ${o.needsContact ? "да" : "нет"}.`);
  for (const m of messages) add(`Сообщение пациента · ${m.createdAt.toISOString()}`, m.text);
  for (const s of input.assignmentId ? [] : submissions) {
    const definition = readDefinition(s.assignment.definition);
    const answers = z.record(z.string(), z.string()).parse(s.answers);
    const result = evaluateAssessment(definition, answers);
    add(`${definition.title} · v${definition.version} · ${s.createdAt.toISOString()}`, summarySourceText({ period: definition.period, metric: result.metric, answers: definition.questions.map(q => ({ question: q.title, answer: q.options.find(o => o.id === answers[q.id])?.label })), note: s.note, limitations: definition.schemaVersion !== 1 ? definition.provenance.limitations : definition.source.validation }));
    addBaseline(definition.title,s.createdAt.toISOString().slice(0,10),definition.period,result.metric,sources.at(-1)!);
  }
  if (plan) add(`План наблюдения · версия ${plan.version}`, summarySourceText({ version: plan.version, goal: plan.goal, instructions: plan.instructions, nextVisitDate: visitDate(plan), appointment:plan.appointment, confirmedAt: plan.confirmedAt, tasks:plan.tasks }));
  if (!scoped && patient.note) add("Заметка врача", patient.note);
  let eventRevision: number | undefined;
  if (input.eventId) {
    const event = await getReviewEvent(actor, input.eventId);
    if (event.patientId !== patient.id) throw new AppError(404, "Событие недоступно для этой карточки.");
    add(`Событие · ${event.createdAt}`, summarySourceText({ title: event.title, reason: event.reason, period: event.source.form.period, metric: event.source.metric, answers: event.source.form.questions.map(q => ({ question: q.title, answer: q.options.find(o => o.id === event.source.answers[q.id])?.label })), note: event.source.note }));
    addBaseline(event.source.form.title,event.createdAt.slice(0,10),event.source.form.period,event.source.metric,sources.at(-1)!);
    actions = event.actions.map(a => ({ id: a.id, label: a.label, description: a.description }));
    eventRevision = event.revision;
  }
  if (!sources.length) throw new AppError(422, "Пока нет сведений для обобщения.");
  const fingerprint = createHash("sha256").update(JSON.stringify({sources, actions, model: summaryConfiguration().model, instructions:summaryInstructions})).digest("hex");
  return {patient, sources, actions, comparisons, baseline, eventRevision, fingerprint};
}

export async function getSummaryState(actor: Actor, input: SummarySelection) {
  const saved = await getSavedSummary(actor, input);
  try {
    const {fingerprint} = await collectSummarySources(actor, input);
    return {saved, fingerprint, stale: !saved?.facts.length || saved?.sourceFingerprint !== fingerprint || (saved.generation === "RULES" && (!saved.retryAfter || Date.parse(saved.retryAfter) <= Date.now()))};
  } catch (error) {
    if (error instanceof AppError && error.status === 422) return {saved:null, fingerprint: null, stale: false};
    throw error;
  }
}

export async function createSummary(actor: Actor, input: SummarySelection, automatic = false) {
  requireDoctor(actor);
  await requirePatientAccess(actor, input.patientId);
  summaryScopeKey(input);
  const config = summaryConfiguration();
  if (!config.enabled) throw new AppError(503, config.reason);
  return withSummaryLock(actor.id, async () => {
  const {patient, sources, actions, comparisons, baseline, eventRevision, fingerprint} = await collectSummarySources(actor, input);
  if (automatic) {
    const saved = await getSavedSummary(actor, input);
    if (saved?.facts.length && saved.sourceFingerprint === fingerprint && (saved.generation !== "RULES" || (saved.retryAfter && Date.parse(saved.retryAfter) > Date.now()))) return saved;
  }
  let result: SummaryOutput;
  let generation: "MODEL" | "RULES" = "MODEL";
  try { result = await summarizeWithProvider(sources, actions); }
  catch (e) {
    const code = e instanceof ExtractionError ? e.code : "INVALID_OUTPUT";
    console.warn("Summary failed", { code, provider: config.provider, model: config.model, sourceCount: sources.length });
    if (baseline.length && ["INCOMPLETE_OUTPUT","EMPTY_OUTPUT","NO_PRIMARY_FACTS","FILTERED_OUTPUT"].includes(code)) {
      const previous = await getSavedSummary(actor,input);
      if (previous?.facts.length && previous.generation !== "RULES" && previous.sourceFingerprint === fingerprint) return previous;
      result = {facts:baseline,actionIds:[],limitations:[]};
      generation = "RULES";
    } else {
    const messages: Record<string, string> = {
      PROVIDER_LIMIT: "Сервис обобщения временно ограничил запросы. Попробуйте через несколько секунд.",
      PROVIDER_TIMEOUT: "Обобщение не завершилось за 30 секунд. Попробуйте ещё раз.",
      PROVIDER_UNAVAILABLE: "Нет связи с сервисом обобщения. Можно повторить запрос.",
      CONTEXT_TOO_LONG: "Слишком много данных. Откройте отдельную анкету для обобщения.",
      INVALID_EVIDENCE: "Не удалось сверить обобщение с источниками. Попробуйте ещё раз.",
      INVALID_ACTION: "Обобщение содержит неподтверждённое действие. Попробуйте ещё раз.",
      INCOMPLETE_OUTPUT: "Сервис вернул неполное обобщение. Попробуйте ещё раз.",
      PROVIDER_REJECTED: "Сервис отклонил запрос обобщения. Проверьте доступ к выбранной модели.",
      PROVIDER_REFUSAL: "Сервис не смог обобщить эти сведения. Можно повторить запрос."
    };
    throw new AppError(code === "PROVIDER_LIMIT" ? 429 : code === "PROVIDER_TIMEOUT" ? 504 : 502, messages[code] ?? "Не удалось получить обобщение в нужном формате. Попробуйте ещё раз.");
    }
  }
  const latestSources = await collectSummarySources(actor, input);
  if (latestSources.fingerprint !== fingerprint) throw new AppError(409, "Данные изменились. Обобщение будет обновлено.");
  const latest = await requirePatientAccess(actor, patient.id);
  if (latest.clinicalDataVersion !== patient.clinicalDataVersion || latest.updatedAt.getTime() !== patient.updatedAt.getTime()) throw new AppError(409, "За время обобщения данные изменились. Запросите актуальную сводку.");
  if (input.eventId && (await getReviewEvent(actor, input.eventId)).revision !== eventRevision) throw new AppError(409, "Событие изменилось. Запросите актуальное обобщение.");
  const output = savedSummarySchema.parse({ ...result, generation, ...(generation === "RULES" ? {retryAfter:new Date(Date.now()+60000).toISOString()} : {}), sourceFingerprint: fingerprint, facts:[...result.facts.slice(0,12-comparisons.length),...comparisons], actions: actions.filter(a => result.actionIds.includes(a.id)), sources, generatedAt: new Date().toISOString(), clinicalDataVersion: patient.clinicalDataVersion, model: config.model, scope: input.assignmentId ? "Текущая анкета — основной источник; до 3 прошлых результатов той же методики, до 2 других анкет не позднее текущей, общие сведения и текущий план. Переписка не включена." : input.eventId ? "Только выбранное событие и анкета, на основании которой оно создано." : "До 5 последних самоотчётов, анкет и сообщений пациента, текущие подтверждённые сведения и план. Полная история не включена." });
  await db.$transaction(async tx => {
    if (!await tx.patient.findFirst({where:{id:patient.id,doctorId:actor.id},select:{id:true}})) throw new AppError(404,"Карточка недоступна.");
    const key = {patientId:patient.id,doctorId:actor.id,scopeKey:summaryScopeKey(input)};
    await tx.savedSummary.upsert({where:{patientId_doctorId_scopeKey:key},create:{...key,payload:output},update:{payload:output}});
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "summary.generate", targetId: patient.id } });
  });
  return output;
  });
}
