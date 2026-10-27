import { db } from "@/server/db";
import { fingerprint } from "@/modules/assessments/definitions";
import { locateExtraction } from "./contract";
import { extractDocument, extractionConfiguration, ExtractionError } from "./extractor";
export async function processDocumentExtraction(id: string, extractor: (text: string, model: string, provider: string) => Promise<unknown> = extractDocument) {
  const job = await db.documentExtraction.findUnique({ where: { id }, include: { document: { omit: { sourceBytes: true }, include: { patient: { select: { doctorId: true } } } } } });
  if (!job || ["READY", "CANCELLED"].includes(job.status)) return;
  if (job.document.patient.doctorId !== job.createdById || job.inputChecksum !== job.document.checksum || fingerprint(job.document.text) !== job.inputChecksum) { await db.documentExtraction.update({ where: { id }, data: { status: "CANCELLED", errorCode: "SOURCE_OR_ACCESS_CHANGED" } }); return; }
  const config = extractionConfiguration();
  if (extractor === extractDocument && (!config.enabled || config.provider !== job.provider)) { await db.documentExtraction.update({ where: { id }, data: { status: "FAILED", errorCode: "NOT_CONFIGURED" } }); return; }
  if (job.status === "RUNNING" && job.updatedAt.getTime() > Date.now() - 180000) return;
  if (job.attempts >= 2) return;
  const claimed = await db.documentExtraction.updateMany({ where: { id, status: job.status, updatedAt: job.updatedAt, attempts: job.attempts, resultChecksum: null }, data: { status: "RUNNING", attempts: { increment: 1 }, errorCode: null } });
  if (!claimed.count) return;
  try {
    const output = await extractor(job.document.text, job.model, job.provider); const result = locateExtraction(job.document.text, output);
    await db.$transaction(async tx => { const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Patient" WHERE id = ${job.document.patientId} AND "doctorId" = ${job.createdById} FOR UPDATE`; if (!rows.length) { await tx.documentExtraction.update({ where: { id }, data: { status: "CANCELLED", errorCode: "SOURCE_OR_ACCESS_CHANGED" } }); return; }
      const saved = await tx.documentExtraction.updateMany({ where: { id, status: "RUNNING" }, data: { status: "READY", result, resultChecksum: fingerprint(result), errorCode: null } }); if (saved.count) await tx.auditEvent.create({ data: { actorId: job.createdById, action: "document.extract.ready", targetId: id } }); });
  } catch (error) {
    const code = error instanceof ExtractionError ? error.code : error instanceof Error && ["UNCITED_OUTPUT", "INVALID_FACT", "DUPLICATE_FACT"].includes(error.message) ? error.message : "INVALID_OUTPUT";
    await db.documentExtraction.updateMany({ where: { id, status: "RUNNING" }, data: { status: "FAILED", errorCode: code } });
    // Queue retries only transient failures. Schema/citation failures require a deliberate new run.
    if (["PROVIDER_UNAVAILABLE", "PROVIDER_LIMIT"].includes(code)) throw new Error(code);
  }
}
