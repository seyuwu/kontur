import { db } from "@/server/db";
import { AppError, requirePatientAccess, type Actor } from "@/server/access";
import type { MessagePage } from "@/lib/types";
import {enqueueContactPush} from "@/modules/web-push";

export async function getMessagePage(actor: Actor, patientId: string, before?: string): Promise<MessagePage> {
  await requirePatientAccess(actor, patientId);
  const cursor = before ? await db.message.findFirst({ where: { id: before, patientId }, select: { id: true, createdAt: true } }) : null;
  if (before && !cursor) throw new AppError(400, "Граница истории недоступна. Обновите переписку.");
  const records = await db.message.findMany({ where: { patientId, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51, select: { id: true, text: true, createdAt: true, readAt: true, senderId: true, sender: { select: { name: true, role: true } } } });
  const rows = records.slice(0, 50);
  return { messages: rows.reverse().map(row => ({ ...row, createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null })), nextCursor: records.length > 50 ? rows[0].id : null };
}

export async function sendMessage(actor: Actor, data: { patientId: string; text: string; requestKey: string; needsContact?:boolean }) {
  const patient=await requirePatientAccess(actor, data.patientId);
  if(data.needsContact && actor.role!=="PATIENT")throw new AppError(403,"Просьбу о контакте отправляет пациент.");
  const result = await db.$transaction(async tx => {
    const message = await tx.message.upsert({ where: { requestKey: data.requestKey }, create: { patientId: data.patientId, text: data.text, requestKey: data.requestKey, senderId: actor.id }, update: {} });
    if (message.patientId !== data.patientId || message.senderId !== actor.id) throw new Error("Idempotency conflict");
    if(message.text!==data.text)throw new AppError(409,"Ключ сообщения уже использован.");
    if(data.needsContact){
      const requestKey=`chat:${message.id}`;
      const old=await tx.observation.findUnique({where:{requestKey}});
      if(!old){const observation=await tx.observation.create({data:{patientId:patient.id,note:data.text.slice(0,2000),needsContact:true,requestKey}});await enqueueContactPush(tx,{id:observation.id,recipientId:patient.doctorId});}
    }
    await tx.patient.update({ where: { id: data.patientId }, data: { updatedAt: new Date() } });
    return { saved: true };
  });
  return result;
}
export async function markMessagesRead(actor: Actor, patientId: string, messageIds: string[]) {
  await requirePatientAccess(actor, patientId);
  await db.$transaction(async tx => {
    const changed = await tx.message.updateMany({ where: { patientId, id: { in: messageIds }, senderId: { not: actor.id }, readAt: null }, data: { readAt: new Date() } });
    if (changed.count) await tx.patient.update({ where: { id: patientId }, data: { updatedAt: new Date() } });
  });
  return { saved: true };
}
