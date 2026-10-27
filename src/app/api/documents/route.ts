import { z } from "zod";
import { AppError, checkOrigin, errorResponse, requireActor } from "@/server/access";
import { documentInput } from "@/modules/documents/contract";
import { listDocuments, documentStamp, getDocument, saveDocument, startExtraction, prepareDocumentInput, prepareDocumentProfile } from "@/modules/documents";
const id = z.string().min(1).max(100);
const command = z.discriminatedUnion("action", [z.strictObject({ action: z.literal("save"), ...documentInput.shape }), z.strictObject({ action: z.literal("extract"), patientId: id, id, requestKey: z.string().uuid(), consent: z.literal(true) }), z.strictObject({ action: z.literal("prepare"), ...prepareDocumentInput.shape })]);
export async function GET(request: Request) {
  try { const actor = await requireActor(); const q = z.strictObject({ patientId: id, id: id.optional(), cursor: id.optional(), format: z.literal("text").optional() }).safeParse(Object.fromEntries(new URL(request.url).searchParams)); if (!q.success || (q.data.id && q.data.cursor) || (q.data.format && !q.data.id)) throw new AppError(400, "Проверьте адрес документа."); const { patientId, id: selected, cursor, format } = q.data;
    const etag = selected ? await documentStamp(actor, patientId, selected) : null; const headers = { "Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff", ...(etag ? { ETag: etag } : {}) }; if (etag && request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    const doc = selected ? await getDocument(actor, patientId, selected) : null;
    if (format && doc) return new Response(doc.text, { headers: { ...headers, "Content-Type": "text/plain; charset=utf-8", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" } });
    return Response.json(doc ?? await listDocuments(actor, patientId, cursor), { headers });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try { checkOrigin(request); const actor = await requireActor(); const body = await request.text(); if (body.length > 250000) throw new AppError(413, "Слишком большой документ."); let json: unknown; try { json = JSON.parse(body); } catch { throw new AppError(400, "Проверьте формат документа."); } const d = command.safeParse(json); if (!d.success) throw new AppError(400, "Проверьте поля документа и подтверждение проверки.");
    const { action, ...payload } = d.data;
    if (action === "save") return Response.json(await saveDocument(actor, documentInput.parse(payload)));
    if (action === "extract") return Response.json(await startExtraction(actor, d.data as z.infer<typeof command> & { action: "extract" }));
    return Response.json(await prepareDocumentProfile(actor, prepareDocumentInput.parse(payload)));
  } catch (error) { return errorResponse((error as { code?: string }).code === "P2002" ? new AppError(409, "Ключ документа уже использован. Обновите список и проверьте сохранённую запись.") : error); }
}
