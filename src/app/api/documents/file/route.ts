import { z } from "zod";
import { AppError, checkOrigin, errorResponse, requireActor, requireDoctor, requirePatientAccess } from "@/server/access";
import { parseDocumentFile, maxDocumentBytes } from "@/modules/documents/file-parser";
import { documentInput } from "@/modules/documents/contract";
import { saveDocument } from "@/modules/documents";
export const runtime = "nodejs";
const attempts = new Map<string, { start: number; count: number }>();
export async function POST(request: Request) {
  try {
    checkOrigin(request); const actor = await requireActor(); requireDoctor(actor);
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.startsWith("multipart/form-data;")) throw new AppError(415, "Загрузите файл через форму PDF / DOCX.");
    const limit = maxDocumentBytes + 32768;
    const declared = Number(request.headers.get("content-length")); if (declared > limit) throw new AppError(413, "Выберите файл размером до 5 МБ.");
    const now = Date.now(); for (const [key, value] of attempts) if (now - value.start > 600000) attempts.delete(key);
    const rate = attempts.get(actor.id) ?? { start: now, count: 0 }; if (rate.count >= 20) throw new AppError(429, "Слишком много загрузок. Повторите через несколько минут."); rate.count++; attempts.set(actor.id, rate);
    const reader = request.body?.getReader(); if (!reader) throw new AppError(400, "Выберите файл.");
    const chunks: Uint8Array[] = []; let length = 0;
    for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > limit) { await reader.cancel(); throw new AppError(413, "Выберите файл размером до 5 МБ."); } chunks.push(value); }
    let form: FormData; try { form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": contentType } }).formData(); } catch { throw new AppError(400, "Не удалось прочитать форму загрузки."); }
    const fields = Object.fromEntries(form); const metadata = z.strictObject({ action: z.enum(["preview", "save"]), patientId: z.string().min(1).max(100), title: z.string().optional(), date: z.string().optional(), requestKey: z.string().optional(), file: z.instanceof(File) }).safeParse(fields);
    if (!metadata.success || [...form.keys()].length !== Object.keys(fields).length) throw new AppError(400, "Проверьте поля загрузки.");
    const { file, patientId, action } = metadata.data; await requirePatientAccess(actor, patientId);
    if (file.size > maxDocumentBytes) throw new AppError(413, "Выберите файл размером до 5 МБ.");
    const bytes = new Uint8Array(await file.arrayBuffer()); const parsed = await parseDocumentFile(bytes, file.name);
    const headers = { "Cache-Control": "private, no-store" };
    if (action === "preview") return Response.json(parsed, { headers });
    const input = documentInput.safeParse({ patientId, title: metadata.data.title, date: metadata.data.date || null, requestKey: metadata.data.requestKey, text: parsed.text });
    if (!input.success) throw new AppError(400, "Проверьте название, дату документа и ключ сохранения.");
    return Response.json(await saveDocument(actor, input.data, { ...parsed, bytes }), { headers });
  } catch (error) { return errorResponse((error as { code?: string }).code === "P2002" ? new AppError(409, "Ключ документа уже использован.") : error); }
}
