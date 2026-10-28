import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { AppError, requireDoctor, requirePatientAccess, type Actor } from "@/server/access";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export async function createInvitation(actor: Actor, patientId: string) {
  requireDoctor(actor); await requirePatientAccess(actor, patientId);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
    const token = randomBytes(32).toString("hex"); const code = String(randomInt(100000, 1000000));
  const expiresAt = await db.$transaction(async tx => {
    const locked = await tx.$queryRaw<{ id: string; userId: string | null }[]>`SELECT id, "userId" FROM "Patient" WHERE id = ${patientId} AND "doctorId" = ${actor.id} FOR UPDATE`;
    if (!locked.length) throw new AppError(404, "Карточка недоступна.");
    const expiresAt = new Date(Date.now() + (locked[0].userId ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000));
    await tx.linkRequest.updateMany({ where: { status: "PENDING", invitation: { patientId, consumedAt: null, revokedAt: null } }, data: { status: "REJECTED", resolvedAt: new Date() } });
    await tx.invitation.updateMany({ where: { patientId, consumedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.invitation.create({ data: { patientId, tokenHash: hash(token), codeHash: hash(code), expiresAt } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: locked[0].userId ? "invitation.login-create" : "invitation.create", targetId: patientId } });
    return expiresAt;
  });
  return { code, expiresAt: expiresAt.toISOString(), url: `${process.env.APP_ORIGIN ?? "http://localhost:3000"}/connect#${token}` };
    } catch (error) { if ((error as { code?: string }).code !== "P2002") throw error; }
  }
  throw new AppError(503, "Не удалось выпустить уникальный код. Повторите попытку.");
}
export async function redeemPatientInvitation(secret: string, expiresIn: number, userAgent?: string) {
  return db.$transaction(async tx => {
    const where = { OR: [{ tokenHash: hash(secret) }, { codeHash: hash(secret) }], consumedAt: null, revokedAt: null, expiresAt: { gt: new Date() } };
    const invitation = await tx.invitation.findFirst({ where });
    if (!invitation) throw new AppError(400, "Код неверный или срок приглашения истёк. Попросите врача создать новое.");
    const locked = await tx.$queryRaw<{ id: string; userId: string | null }[]>`SELECT id, "userId" FROM "Patient" WHERE id = ${invitation.patientId} FOR UPDATE`;
    if (!locked.length || !await tx.invitation.findFirst({ where: { ...where, id: invitation.id, expiresAt: { gt: new Date() } } })) throw new AppError(400, "Приглашение больше не действует. Попросите врача создать новое.");
    let user;
    if (locked[0].userId) {
      user = await tx.user.findUniqueOrThrow({ where: { id: locked[0].userId } });
      if (user.role !== "PATIENT") throw new AppError(403, "Вход по коду доступен только пациенту.");
      await tx.invitation.update({ where: { id: invitation.id }, data: { consumedAt: new Date() } });
    } else {
      if (await tx.linkRequest.count({ where: { invitationId: invitation.id } })) throw new AppError(400, "По этому коду уже отправлен запрос. Попросите врача выдать новый код.");
      const id = randomUUID();
      user = await tx.user.create({ data: { id, name: "Пациент", email: `invitation-${id}@accounts.kontur.invalid`, emailVerified: false, role: "PATIENT" } });
      await tx.linkRequest.create({ data: { invitationId: invitation.id, userId: user.id } });
    }
    const session = await tx.session.create({ data: { id: randomUUID(), token: randomBytes(32).toString("hex"), userId: user.id, expiresAt: new Date(Date.now() + expiresIn * 1000), userAgent } });
    await tx.auditEvent.create({ data: { actorId: user.id, action: "invitation.sign-in", targetId: invitation.patientId } });
    return { user, session };
  });
}
export async function requestLink(actor: Actor, secret: string) {
  if (actor.role !== "PATIENT") throw new AppError(403, "Подключение доступно из аккаунта пациента.");
  if (await db.patient.findUnique({ where: { userId: actor.id } })) throw new AppError(409, "У вас уже есть ведущий врач. Смена связи требует отдельного согласования.");
  const attempts = await db.auditEvent.count({ where: { actorId: actor.id, action: "invitation.attempt", createdAt: { gt: new Date(Date.now() - 15 * 60 * 1000) } } });
  if (attempts >= 12) throw new AppError(429, "Слишком много попыток. Повторите через 15 минут.");
  await db.auditEvent.create({ data: { actorId: actor.id, action: "invitation.attempt", targetId: actor.id } });
  const invitation = await db.invitation.findFirst({ where: { OR: [{ tokenHash: hash(secret) }, { codeHash: hash(secret) }], consumedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, include: { patient: { include: { doctor: { select: { name: true } } } } } });
  if (!invitation) throw new AppError(400, "Код неверный или срок приглашения истёк. Попросите врача создать новое.");
  await db.linkRequest.upsert({ where: { invitationId_userId: { invitationId: invitation.id, userId: actor.id } }, create: { invitationId: invitation.id, userId: actor.id }, update: {} });
  return { doctorName: invitation.patient.doctor.name, pending: true };
}
export async function revokeInvitation(actor: Actor, patientId: string) {
  requireDoctor(actor);
  return db.$transaction(async tx => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Patient" WHERE id = ${patientId} AND "doctorId" = ${actor.id} FOR UPDATE`;
    if (!locked.length) throw new AppError(404, "Карточка недоступна.");
    const active = await tx.invitation.findMany({ where: { patientId, consumedAt: null, revokedAt: null }, select: { id: true } });
    await tx.invitation.updateMany({ where: { id: { in: active.map(i => i.id) } }, data: { revokedAt: new Date() } });
    await tx.linkRequest.updateMany({ where: { invitationId: { in: active.map(i => i.id) }, status: "PENDING" }, data: { status: "REJECTED", resolvedAt: new Date() } });
    if (active.length) await tx.auditEvent.create({ data: { actorId: actor.id, action: "invitation.revoke", targetId: patientId } });
    return { saved: true };
  });
}
export async function resolveLink(actor: Actor, data: { requestId: string; approve: boolean }) {
  requireDoctor(actor);
  return db.$transaction(async tx => {
    const request = await tx.linkRequest.findFirst({ where: { id: data.requestId, status: "PENDING", invitation: { patient: { doctorId: actor.id } } }, include: { invitation: { include: { patient: true } } } });
    if (!request) throw new AppError(404, "Запрос уже обработан или недоступен.");
    const invitation = request.invitation;
    const locked = await tx.$queryRaw<{ id: string; name: string }[]>`SELECT id, name FROM "Patient" WHERE id = ${invitation.patientId} AND "doctorId" = ${actor.id} FOR UPDATE`;
    if (!locked.length) throw new AppError(404, "Карточка недоступна.");
    if (data.approve) {
      if (invitation.revokedAt || invitation.consumedAt || invitation.expiresAt < new Date()) throw new AppError(409, "Приглашение больше не действует.");
      const consumed = await tx.invitation.updateMany({ where: { id: invitation.id, consumedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (!consumed.count) throw new AppError(409, "Приглашение уже использовано.");
      if (await tx.patient.findUnique({ where: { userId: request.userId } })) throw new AppError(409, "Аккаунт уже подключён к другой карточке.");
      const linked = await tx.patient.updateMany({ where: { id: invitation.patientId, doctorId: actor.id, userId: null }, data: { userId: request.userId } });
      if (!linked.count) throw new AppError(409, "Карточка уже подключена.");
      // The temporary account name is replaced only after the doctor confirms the link.
      await tx.user.updateMany({ where: { id: request.userId, role: "PATIENT", name: "Пациент" }, data: { name: locked[0].name } });
      await tx.patientEvent.create({ data: { patientId: invitation.patientId, kind: "connection", title: "Пациент подключён", detail: "Связь подтверждена ведущим врачом" } });
      await tx.linkRequest.updateMany({ where: { invitationId: invitation.id, id: { not: request.id }, status: "PENDING" }, data: { status: "REJECTED", resolvedAt: new Date() } });
    }
    await tx.linkRequest.update({ where: { id: request.id }, data: { status: data.approve ? "APPROVED" : "REJECTED", resolvedAt: new Date() } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: data.approve ? "link.approve" : "link.reject", targetId: invitation.patientId } });
    return { saved: true };
  });
}
