import { z } from "zod";
import { AppError, checkOrigin, errorResponse, requireActor } from "@/server/access";
import { clinicalProfileStamp, getClinicalProfile, getClinicalProfileHistory, saveClinicalProfile } from "@/modules/clinical-profile";
import { profileContentSchema } from "@/modules/clinical-profile/contract";
const id = z.string().min(1).max(100);
const command = z.strictObject({ patientId: id, expectedVersion: z.number().int().nonnegative(), content: profileContentSchema, requestKey: z.string().uuid(), reviewed: z.literal(true) });
export async function GET(request: Request) {
  try { const actor = await requireActor(); const query = z.strictObject({ patientId: id, versionId: id.optional(), view: z.literal("history").optional(), cursor: id.optional() }).safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success || (query.data.view && query.data.versionId) || (query.data.cursor && !query.data.view)) throw new AppError(400, "Проверьте адрес клинических сведений.");
    const { patientId, view, versionId, cursor } = query.data;
    const etag = !view && !versionId ? await clinicalProfileStamp(actor, patientId) : null;
    const headers = { "Cache-Control": "private, no-cache", ...(etag ? { ETag: etag } : {}) };
    if (etag && request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return Response.json(view ? await getClinicalProfileHistory(actor, patientId, cursor) : await getClinicalProfile(actor, patientId, versionId), { headers });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try { checkOrigin(request); const actor = await requireActor(); const body = await request.text(); if (body.length > 360000) throw new AppError(413, "Слишком большой объём сведений.");
    let json: unknown; try { json = JSON.parse(body); } catch { throw new AppError(400, "Проверьте отправленные данные."); }
    const input = command.safeParse(json); if (!input.success) throw new AppError(400, "Проверьте статусы, источники и даты сведений. Для отрицательного ответа нужен источник, для записей — название и источник каждой.");
    return Response.json(await saveClinicalProfile(actor, input.data));
  } catch (error) { return errorResponse(error); }
}
