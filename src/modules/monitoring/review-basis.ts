import { db } from "@/server/db";
import { AppError, type Actor } from "@/server/access";
import type { Patient, Prisma, ReviewBasisVersion } from "@/generated/prisma/client";
import { fingerprint } from "@/modules/assessments/definitions";
import { profileContentSchema, categoryNames } from "@/modules/clinical-profile/contract";
import { reviewBasisSchema, reviewContextSchema, workflowCatalogue, type ReviewBasisContent, type ReviewContext } from "./action-catalogue";
import type { ProposedAction } from "@/modules/clinical";

export const catalogueHash = fingerprint(workflowCatalogue);
type Reader = Pick<Prisma.TransactionClient, "patient" | "observation" | "message" | "assessmentSubmission" | "clinicalProfileVersion" | "carePlanVersion" | "careDailyReport" | "patientConcern">;
export async function lockReviewPatient(tx: Prisma.TransactionClient, actor: Actor, patientId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Patient" WHERE id = ${patientId} AND "doctorId" = ${actor.id} FOR UPDATE`;
  if (!rows.length) throw new AppError(404, "Карточка недоступна.");
  return tx.patient.findUniqueOrThrow({ where: { id: patientId } });
}
export async function reviewContext(reader: Reader, patient: Patient, definitionChecksum: string): Promise<ReviewContext> {
  const [profile, plan, observation, submission, message, daily, concern] = await Promise.all([
    patient.currentClinicalProfileId ? reader.clinicalProfileVersion.findFirst({ where: { id: patient.currentClinicalProfileId, patientId: patient.id } }) : null,
    patient.currentPlanId ? reader.carePlanVersion.findFirst({ where: { id: patient.currentPlanId, patientId: patient.id }, select: { id: true, version: true, goal: true } }) : null,
    reader.observation.findFirst({ where: { patientId: patient.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, score: true, note: true, needsContact: true, createdAt: true } }),
    reader.assessmentSubmission.findFirst({ where: { assignment: { patientId: patient.id } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, createdAt: true, assignment: { select: { definition: { select: { title: true, mode: true } } } } } }),
    reader.message.findFirst({ where: { patientId: patient.id, sender: { role: "PATIENT" } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, text: true, createdAt: true } }),
    reader.careDailyReport.findFirst({ where: { task: { patientId: patient.id } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, date: true, state: true, note: true, createdAt: true, task: { select: { title: true } } } }),
    reader.patientConcern.findFirst({ where: { patientId: patient.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, title: true, description: true, createdAt: true } })
  ]);
  const content = profile ? profileContentSchema.parse(profile.content) : null;
  const unknowns = (Object.keys(categoryNames) as (keyof typeof categoryNames)[]).filter(key => !content || content[key].status === "UNKNOWN").map(key => `${categoryNames[key]}: не уточнено`);
  const unclearIntake = content?.medications.items.filter(m => m.intake === "UNKNOWN").length ?? 0;
  if (unclearIntake) unknowns.push(`Не уточнён статус приёма в ${unclearIntake} записях о препаратах`);
  const token = fingerprint([patient.id, patient.doctorId, patient.clinicalDataVersion, patient.userId, patient.currentClinicalProfileId, patient.currentPlanId, message?.id ?? null, definitionChecksum, catalogueHash]);
  return reviewContextSchema.parse({ schemaVersion: 1, token, clinicalDataVersion: patient.clinicalDataVersion, linked: !!patient.userId, unknowns,
    profile: profile ? { id: profile.id, version: profile.version } : null, plan,
    latestObservation: observation ? { ...observation, createdAt: observation.createdAt.toISOString() } : null,
    latestSubmission: submission ? { id: submission.id, title: submission.assignment.definition.title, mode: submission.assignment.definition.mode, createdAt: submission.createdAt.toISOString() } : null,
    latestMessage: message ? { ...message, createdAt: message.createdAt.toISOString() } : null,
    latestDailyReport: daily ? { id: daily.id, date: daily.date, title: daily.task.title, state: daily.state, note: daily.note, createdAt: daily.createdAt.toISOString() } : null,
    latestConcern: concern ? { ...concern, createdAt: concern.createdAt.toISOString() } : null });
}
export async function currentReviewContext(patientId: string, actor: Actor, checksum: string) {
  const patient = await db.patient.findFirst({ where: { id: patientId, doctorId: actor.id } });
  if (!patient) throw new AppError(404, "Карточка недоступна.");
  return reviewContext(db, patient, checksum);
}
export function basisData(record: ReviewBasisVersion) {
  const content = reviewBasisSchema.parse(record.content);
  if (fingerprint(content) !== record.contentHash || content.context.token !== record.contextToken) throw new AppError(409, "Сохранённое основание изменилось. Требуется проверка администратора.");
  return { id: record.id, version: record.version, createdAt: record.createdAt.toISOString(), createdBy: record.createdByName, ...content };
}
export async function createBasis(tx: Prisma.TransactionClient, actor: Actor, eventId: string, context: ReviewContext, actions: ProposedAction[], checksum: string) {
  const previous = await tx.reviewBasisVersion.findFirst({ where: { eventId }, orderBy: { version: "desc" }, select: { version: true } });
  const content: ReviewBasisContent = reviewBasisSchema.parse({ schemaVersion: 1, context, actions, definitionChecksum: checksum, catalogue: { ...workflowCatalogue, checksum: catalogueHash } });
  return tx.reviewBasisVersion.create({ data: { eventId, version: (previous?.version ?? 0) + 1, content, contentHash: fingerprint(content), contextToken: context.token, createdById: actor.id, createdByName: actor.name } });
}
