import { z } from "zod";
import { requireActor, checkOrigin, errorResponse, AppError } from "@/server/access";
import { createPatient, getWorkspace, getWorkspaceVersion, saveDoctorNote } from "@/modules/patients";
import { saveObservation, acknowledgeRequest } from "@/modules/monitoring";
import { sendMessage, markMessagesRead } from "@/modules/communication";
import { createInvitation, requestLink, resolveLink, revokeInvitation } from "@/modules/access";

const id = z.string().min(1).max(100);
const actions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create-patient"), name: z.string().trim().min(2).max(120), birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ action: z.literal("note"), patientId: id, note: z.string().max(6000), nextVisit: z.string().datetime().nullable().optional() }),
  z.object({ action: z.literal("observation"), patientId: id, score: z.number().int().min(1).max(5).nullable().optional(), note: z.string().trim().max(2000), needsContact: z.boolean(), requestKey: z.string().uuid() }),
  z.object({ action: z.literal("message"), patientId: id, text: z.string().trim().min(1).max(4000), requestKey: z.string().uuid(), needsContact:z.boolean().optional() }),
  z.object({ action: z.literal("read-messages"), patientId: id, messageIds: z.array(id).min(1).max(50) }),
  z.object({ action: z.literal("acknowledge"), patientId: id, observationId: id }),
  z.object({ action: z.literal("invite"), patientId: id }),
  z.strictObject({ action: z.literal("revoke-invite"), patientId: id }),
  z.object({ action: z.literal("request-link"), secret: z.string().trim().min(6).max(64) }),
  z.object({ action: z.literal("resolve-link"), requestId: id, approve: z.boolean() })
]);
export async function GET(request: Request) {
  try {
    const actor = await requireActor(); const version = await getWorkspaceVersion(actor);
    const headers = { "Cache-Control": "private, no-store", ETag: version, Vary: "Cookie" };
    if (request.headers.get("if-none-match") === version) return new Response(null, { status: 304, headers });
    return Response.json(await getWorkspace(actor), { headers });
  }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const actor = await requireActor();
    const body = await request.text();
    if (body.length > 20000) throw new AppError(413, "Слишком большой объём данных.");
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { throw new AppError(400, "Проверьте формат отправленных данных."); }
    const input = actions.safeParse(parsed);
    if (!input.success) throw new AppError(400, "Проверьте заполненные поля.");
    const data = input.data;
    switch (data.action) {
      case "create-patient": return Response.json(await createPatient(actor, data));
      case "note": return Response.json(await saveDoctorNote(actor, data));
      case "observation": return Response.json(await saveObservation(actor, data));
      case "message": return Response.json(await sendMessage(actor, data));
      case "read-messages": return Response.json(await markMessagesRead(actor, data.patientId, data.messageIds));
      case "acknowledge": return Response.json(await acknowledgeRequest(actor, data));
      case "invite": return Response.json(await createInvitation(actor, data.patientId));
      case "revoke-invite": return Response.json(await revokeInvitation(actor, data.patientId));
      case "request-link": return Response.json(await requestLink(actor, data.secret));
      case "resolve-link": return Response.json(await resolveLink(actor, data));
    }
  } catch (error) { return errorResponse((error as { code?: string }).code === "P2002" ? new AppError(409, "Связь или запись уже изменена другим запросом. Обновите данные.") : error); }
}
