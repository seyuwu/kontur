import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { AppError, requireDoctor, requirePatientAccess, type Actor } from "@/server/access";
import { fingerprint } from "@/modules/assessments/definitions";
import { emptyProfile, profileContentSchema, type Evidence, type ProfileContent } from "@/modules/clinical-profile/contract";
import type { ClinicalDocument, DocumentExtraction, Prisma } from "@/generated/prisma/client";
import { documentInput, locatedExtractionSchema } from "./contract";
import { extractionConfiguration, extractionPromptVersion } from "./extractor";
import { lockFollowUp } from "@/modules/follow-up/shared";
import type { DocumentData, DocumentPage } from "@/lib/documents";
import type { ParsedFile } from "./file-parser";
function checkedText(row: Pick<ClinicalDocument, "text" | "checksum">) { if (fingerprint(row.text) !== row.checksum) throw new AppError(409, "Исходный документ изменился. Требуется проверка администратора."); return row.text; }
type JobRead = Pick<DocumentExtraction, "id" | "status" | "model" | "provider" | "promptVersion" | "errorCode" | "attempts" | "createdAt" | "updatedAt"> & Partial<Pick<DocumentExtraction, "result" | "resultChecksum">>;
const jobDto = (job: JobRead | null, full = false) => { if (!job) return null; const result = full && job.status === "READY" ? locatedExtractionSchema.parse(job.result) : undefined; if (result && fingerprint(result) !== job.resultChecksum) throw new AppError(409, "Результат извлечения изменился. Требуется проверка администратора."); return { id: job.id, status: job.status, model: job.model, provider: job.provider, promptVersion: job.promptVersion, errorCode: job.errorCode, attempts: job.attempts, createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(), ...(result ? { result } : {}) }; };
export async function listDocuments(actor: Actor, patientId: string, cursor?: string): Promise<DocumentPage> {
  requireDoctor(actor); await requirePatientAccess(actor, patientId);
  if (cursor && !await db.clinicalDocument.findFirst({ where: { id: cursor, patientId }, select: { id: true } })) throw new AppError(400, "Обновите список документов.");
  const rows = await db.clinicalDocument.findMany({ where: { patientId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, title: true, date: true, checksum: true, createdAt: true, extractions: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { id: true, status: true, model: true, provider: true, promptVersion: true, errorCode: true, attempts: true, createdAt: true, updatedAt: true } } } });
  const configuration = extractionConfiguration();
  return { entries: rows.slice(0, 20).map(r => ({ id: r.id, title: r.title, date: r.date, checksum: r.checksum, createdAt: r.createdAt.toISOString(), extraction: jobDto(r.extractions[0] ?? null) })), nextCursor: rows.length > 20 ? rows[19].id : null, extractionEnabled: configuration.enabled, extractionProvider: configuration.enabled ? configuration.provider : null };
}
export async function documentStamp(actor: Actor, patientId: string, id: string) {
  requireDoctor(actor); await requirePatientAccess(actor, patientId); const row = await db.clinicalDocument.findFirst({ where: { id, patientId }, select: { id: true, checksum: true, extractions: { take: 1, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, updatedAt: true } } } });
  if (!row) throw new AppError(404, "Документ недоступен."); return `W/"${fingerprint([actor.id, row])}"`;
}
export async function getDocument(actor: Actor, patientId: string, id: string): Promise<DocumentData> {
  requireDoctor(actor); await requirePatientAccess(actor, patientId);
  const row = await db.clinicalDocument.findFirst({ where: { id, patientId }, omit: { sourceBytes: true }, include: { extractions: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } });
  if (!row) throw new AppError(404, "Документ недоступен.");
  return { id, title: row.title, date: row.date, checksum: row.checksum, createdAt: row.createdAt.toISOString(), text: checkedText(row), extraction: jobDto(row.extractions[0] ?? null, true), file: row.sourceName ? { name: row.sourceName, mime: row.sourceMime!, checksum: row.sourceChecksum!, pages: row.sourcePages, parserVersion: row.parserVersion!, warnings: row.sourceWarnings } : null };
}
export async function saveDocument(actor: Actor, data: z.infer<typeof documentInput>, file?: ParsedFile & { bytes: Uint8Array }) {
  requireDoctor(actor); const hash = file ? fingerprint([actor.id, data, file.checksum, file.name, file.parserVersion]) : fingerprint([actor.id, data]);
  return db.$transaction(async tx => { await lockFollowUp(tx, actor, data.patientId); const existing = await tx.clinicalDocument.findUnique({ where: { requestKey: data.requestKey } }); if (existing) { if (existing.payloadHash !== hash) throw new AppError(409, "Ключ документа уже использован."); return { saved: true, id: existing.id }; }
    const row = await tx.clinicalDocument.create({ data: { ...data, createdById: actor.id, checksum: fingerprint(data.text), payloadHash: hash, ...(file ? { sourceBytes: new Uint8Array(file.bytes), sourceName: file.name, sourceMime: file.mime, sourceChecksum: file.checksum, sourcePages: file.pages, parserVersion: file.parserVersion, sourceWarnings: file.warnings } : {}) } }); await tx.auditEvent.create({ data: { actorId: actor.id, action: "document.save", targetId: row.id } }); return { saved: true, id: row.id }; });
}
export async function startExtraction(actor: Actor, data: { patientId: string; id: string; requestKey: string; consent: true }) {
  requireDoctor(actor);
  return db.$transaction(async tx => {
    await lockFollowUp(tx, actor, data.patientId); const doc = await tx.clinicalDocument.findFirst({ where: { id: data.id, patientId: data.patientId }, omit: { sourceBytes: true } }); if (!doc) throw new AppError(404, "Документ недоступен."); checkedText(doc);
    const repeat = await tx.documentExtraction.findUnique({ where: { requestKey: data.requestKey } }); if (repeat) { if (repeat.documentId !== doc.id || repeat.createdById !== actor.id) throw new AppError(409, "Ключ извлечения уже использован."); return { saved: true, id: repeat.id }; }
    const configuration = extractionConfiguration(); if (!configuration.enabled) throw new AppError(503, "Извлечение фактов не подключено. Документ сохранён и доступен для ручной проверки.");
    if ((configuration.provider === "groq" || configuration.provider === "mistral") && doc.text.length > 8000) throw new AppError(422, "Для извлечения поддерживается до 8 000 символов. Сохранённый документ доступен полностью; разделите его на части либо проверьте вручную.");
    await tx.documentExtraction.updateMany({ where: { documentId: doc.id, OR: [{ status: "RUNNING", updatedAt: { lt: new Date(Date.now() - 180000) } }, { status: "PENDING", updatedAt: { lt: new Date(Date.now() - 600000) } }, { status: { in: ["PENDING", "RUNNING"] }, createdById: { not: actor.id } }] }, data: { status: "CANCELLED", errorCode: "WORKER_INTERRUPTED" } });
    if (await tx.documentExtraction.count({ where: { documentId: doc.id, status: { in: ["PENDING", "RUNNING"] } } })) throw new AppError(409, "Извлечение уже выполняется.");
    const recent = await tx.documentExtraction.count({ where: { documentId: doc.id, createdAt: { gt: new Date(Date.now() - 3600000) } } }); if (recent >= 3) throw new AppError(429, "Для этого документа уже выполнено три запуска за час. Проверьте настройки и повторите позже.");
    const job = await tx.documentExtraction.create({ data: { documentId: doc.id, model: configuration.model, provider: configuration.provider, promptVersion: extractionPromptVersion, inputChecksum: doc.checksum, createdById: actor.id, requestKey: data.requestKey } });
    await tx.$queryRaw`SELECT graphile_worker.add_job('document_extract', ${JSON.stringify({ extractionId: job.id })}::json, max_attempts := 2)`;
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "document.extract.request", targetId: job.id } }); return { saved: true, id: job.id };
  });
}
export const prepareDocumentInput = z.strictObject({ patientId: z.string().min(1).max(100), id: z.string().min(1).max(100), extractionId: z.string().min(1).max(100), expectedVersion: z.number().int().nonnegative(), selected: z.array(z.number().int().min(0).max(29)).min(1).max(30), modes: z.strictObject({ conditions: z.enum(["ADD", "REPLACE", "KEEP"]), allergies: z.enum(["ADD", "REPLACE", "KEEP"]), medications: z.enum(["ADD", "REPLACE", "KEEP"]) }), reviewed: z.literal(true) });
export async function prepareDocumentProfile(actor: Actor, data: z.infer<typeof prepareDocumentInput>) {
  requireDoctor(actor); return db.$transaction(async tx => {
    const patient = await lockFollowUp(tx, actor, data.patientId); const doc = await tx.clinicalDocument.findFirst({ where: { id: data.id, patientId: patient.id } });
    if (!doc) throw new AppError(404, "Документ недоступен."); checkedText(doc);
    const extraction = await tx.documentExtraction.findFirst({ where: { id: data.extractionId, documentId: doc.id, status: "READY", inputChecksum: doc.checksum } }); if (!extraction) throw new AppError(409, "Проверяемый результат извлечения недоступен.");
    const parsed = jobDto(extraction, true)!.result!;
    const previous = patient.currentClinicalProfileId ? await tx.clinicalProfileVersion.findUniqueOrThrow({ where: { id: patient.currentClinicalProfileId } }) : null;
    if ((previous?.version ?? 0) !== data.expectedVersion) throw new AppError(409, "Сведения изменились. Откройте актуальный раздел перед переносом фактов.");
    const baseline = previous ? profileContentSchema.parse(previous.content) : emptyProfile(); const content = structuredClone(baseline);
    if (new Set(data.selected).size !== data.selected.length) throw new AppError(400, "Факты выбраны повторно.");
    const selected = data.selected.map(i => parsed.facts[i]); if (selected.some(f => !f || (f.polarity === "UNCERTAIN" || (f.polarity === "ABSENT" && f.scope === "ITEM")))) throw new AppError(400, "Сомнительные и отсутствующие факты нельзя перенести как подтверждённые сведения.");
    for (const category of ["conditions", "allergies", "medications"] as const) {
      const facts = selected.filter(f => f.section === category); const mode = data.modes[category]; if (!facts.length || mode === "KEEP") continue;
      if (facts.some(f => f.polarity === "ABSENT") && (facts.length !== 1 || (mode !== "REPLACE" && content[category].status !== "UNKNOWN"))) throw new AppError(409, "Отрицательный ответ нельзя объединить с существующими записями. Выберите один факт и явную замену раздела.");
      if (mode === "ADD" && content[category].status === "NONE") throw new AppError(409, "В разделе есть отрицательный ответ. Для противоречащих ему сведений нужна явная замена и проверка врача.");
      const evidence = (f: typeof facts[number]): Evidence => ({ kind: "DOCUMENT", reference: `${doc.title} · проверенный фрагмент`, date: doc.date, document: { id: doc.id, checksum: doc.checksum, start: f.start, end: f.end, quote: f.quote, extractionId: extraction.id } });
      if (facts[0].polarity === "ABSENT") { content[category] = { status: "NONE", note: facts[0].details, evidence: evidence(facts[0]), items: [] }; continue; }
      const items = facts.map(f => ({ id: randomUUID(), title: f.title, details: f.details, evidence: evidence(f), ...(category === "medications" ? { regimen: f.regimen, intake: f.intake, startedOn: f.startedOn, stoppedOn: f.stoppedOn } : {}) }));
      const existing = mode === "ADD" && content[category].status === "KNOWN" ? content[category].items : [];
      const additions = items.filter(i => !existing.some(e => e.evidence.document?.id === doc.id && e.evidence.document.start === i.evidence.document!.start && e.evidence.document.end === i.evidence.document!.end && e.title === i.title));
      // Final validation below checks medication fields, item limits and section invariants.
      Object.assign(content[category], { status: "KNOWN", evidence: null, items: [...existing, ...additions] });
    }
    const checked = profileContentSchema.safeParse(content); if (!checked.success) throw new AppError(400, "Слишком много записей или противоречивые сведения. Сократите выбор и проверьте даты / статусы.");
    if (fingerprint(content) === fingerprint(baseline)) throw new AppError(400, "Выбранные факты не изменяют сведения. Проверьте выбор и режим переноса.");
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "document.prepare-profile", targetId: extraction.id } }); return { content: checked.data, expectedVersion: previous?.version ?? 0, baseline: JSON.stringify(baseline) };
  });
}
export async function verifyDocumentEvidence(tx: Prisma.TransactionClient, patientId: string, content: ProfileContent) {
  const evidence = [content.conditions.evidence, content.allergies.evidence, content.medications.evidence, ...content.conditions.items.map(i => i.evidence), ...content.allergies.items.map(i => i.evidence), ...content.medications.items.map(i => i.evidence)].flatMap(e => e?.document ? [e.document] : []);
  if (!evidence.length) return;
  const docs = await tx.clinicalDocument.findMany({ where: { patientId, id: { in: [...new Set(evidence.map(e => e.id))] } } });
  const jobs = await tx.documentExtraction.findMany({ where: { id: { in: [...new Set(evidence.flatMap(e => e.extractionId ? [e.extractionId] : []))] }, document: { patientId }, status: "READY" } });
  for (const proof of evidence) { const doc = docs.find(d => d.id === proof.id); if (!doc || doc.checksum !== proof.checksum || checkedText(doc).slice(proof.start, proof.end) !== proof.quote) throw new AppError(409, "Фрагмент источника не соответствует сохранённому документу этой карточки.");
    if (proof.extractionId) { const job = jobs.find(j => j.id === proof.extractionId && j.documentId === doc.id && j.inputChecksum === doc.checksum); const output = job ? jobDto(job, true)?.result : null; if (!output?.facts.some(f => f.start === proof.start && f.end === proof.end && f.quote === proof.quote)) throw new AppError(409, "Фрагмент не соответствует результату указанного извлечения."); }
  }
}
