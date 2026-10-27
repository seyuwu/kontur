import { createHash, randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { AppError, requireDoctor, requirePatientAccess, type Actor } from "@/server/access";
import type { PatientData, WorkspaceData } from "@/lib/types";
import { readEtag } from "./directory";

const cardInclude = {
  currentPlan: { select: { appointment: true } },
  doctor: { select: { name: true, specialty: true } },
  observations: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30 },
  messages: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, include: { sender: { select: { name: true, role: true } } } },
  events: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20 }
} satisfies import("@/generated/prisma/client").Prisma.PatientInclude;
const owner = (actor: Actor) => actor.role === "DOCTOR" ? { doctorId: actor.id } : { userId: actor.id };
export async function getPatientDetailVersion(actor: Actor, patientId: string) {
  const row = await db.patient.findFirst({ where: { id: patientId, ...owner(actor) }, select: { id: true, updatedAt: true, doctor: { select: { updatedAt: true } } } });
  if (!row) throw new AppError(404, "Карточка не найдена или недоступна.");
  return readEtag([actor.id, actor.role, row]);
}
export async function getPatientDetail(actor: Actor, patientId: string): Promise<PatientData> {
  const patient = await db.patient.findFirst({ where: { id: patientId, ...owner(actor) }, include: { ...cardInclude, _count: { select: { observations: { where: { needsContact: true, acknowledgedAt: null } } } } } });
  if (!patient) throw new AppError(404, "Карточка не найдена или недоступна.");
  const contactRequests = actor.role === "DOCTOR" && patient._count.observations ? await db.observation.findMany({ where: { patientId, patient: owner(actor), needsContact: true, acknowledgedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 20 }) : [];
  const { _count, ...card } = patient;
  return JSON.parse(JSON.stringify({ ...card, note: actor.role === "DOCTOR" ? card.note : "", observations: card.observations.reverse(), messages: card.messages.reverse(), contactRequests, contactRequestCount: _count.observations }));
}

/** Cheap conditional-read stamp: no observations, messages or document bodies. */
export async function getWorkspaceVersion(actor: Actor) {
  if (actor.role === "DOCTOR") throw new AppError(410, "Кабинет врача использует список /api/patients и отдельную карточку пациента.");
  const [patients, requests] = await Promise.all([
    db.patient.findMany({ where: { userId: actor.id }, take: 1, select: { id: true, updatedAt: true, doctor: { select: { updatedAt: true } } } }),
    db.linkRequest.findMany({ where: { status: "PENDING", ...(actor.role === "PATIENT" ? { userId: actor.id } : {}), invitation: { ...(actor.role === "DOCTOR" ? { patient: { doctorId: actor.id } } : {}), consumedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }, orderBy: { id: "asc" }, select: { id: true, createdAt: true, user: { select: { name: true, email: true } }, invitation: { select: { patient: { select: { name: true, publicId: true } } } } } })
  ]);
  return `W/"${createHash("sha256").update(JSON.stringify([actor, patients, requests, process.env.DEMO_MODE])).digest("hex")}"`;
}

export async function getWorkspace(actor: Actor): Promise<WorkspaceData> {
  if (actor.role === "DOCTOR") throw new AppError(410, "Кабинет врача использует отдельный список пациентов.");
  const patients = await db.patient.findMany({
    where: { userId: actor.id }, take: 1, include: cardInclude
  });
  const linkRequests: never[] = [];
  const pendingLink = actor.role === "PATIENT" && await db.linkRequest.count({ where: { userId: actor.id, status: "PENDING", invitation: { consumedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } } }) > 0;
  return JSON.parse(JSON.stringify({ actor, patients: patients.map(p => ({ ...p, note: "", observations: p.observations.reverse(), messages: p.messages.reverse() })), linkRequests, pendingLink, refreshedAt: new Date(), demo: process.env.DEMO_MODE === "true" }));
}
export async function createPatient(actor: Actor, data: { name: string; birthDate: string }) {
  requireDoctor(actor);
  const birthDate = new Date(data.birthDate + "T12:00:00Z");
  if (!Number.isFinite(birthDate.getTime()) || birthDate > new Date() || birthDate.getUTCFullYear() < 1900) throw new AppError(400, "Проверьте дату рождения.");
  return db.$transaction(async tx => {
    const patient = await tx.patient.create({ data: { name: data.name, birthDate, doctorId: actor.id, publicId: "КТ-" + randomUUID().slice(0, 6).toUpperCase(), events: { create: { kind: "created", title: "Карточка создана", detail: "Добавлена ведущим врачом" } } } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "patient.create", targetId: patient.id } });
    return { id: patient.id };
  });
}
export async function saveDoctorNote(actor: Actor, data: { patientId: string; note: string; nextVisit?: string | null }) {
  requireDoctor(actor); await requirePatientAccess(actor, data.patientId);
  return db.$transaction(async tx => {
    const locked = await tx.$queryRaw<{ currentPlanId: string | null }[]>`SELECT "currentPlanId" FROM "Patient" WHERE id = ${data.patientId} AND "doctorId" = ${actor.id} FOR UPDATE`;
    if (!locked.length) throw new AppError(404, "Карточка недоступна.");
    if (locked[0].currentPlanId && data.nextVisit !== undefined) throw new AppError(409, "Дата контакта меняется в новой версии плана наблюдения.");
    await tx.patient.update({ where: { id: data.patientId }, data: { note: data.note, ...(data.nextVisit !== undefined ? { nextVisit: data.nextVisit ? new Date(data.nextVisit) : null,nextVisitHasTime:false,nextVisitRevision:{increment:1} } : {}) } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "patient.note.update", targetId: data.patientId } });
    return { saved: true };
  });
}
