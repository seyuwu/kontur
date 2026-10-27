import { db } from "@/server/db";
import { AppError, errorResponse, requireActor, requireDoctor } from "@/server/access";
import { fingerprint } from "@/modules/assessments/definitions";
import { createHash } from "node:crypto";
export async function GET(request: Request) {
  try { const actor = await requireActor(); requireDoctor(actor); const id = new URL(request.url).searchParams.get("id"); if (!id || id.length > 100) throw new AppError(400, "Проверьте адрес источника."); const doc = await db.clinicalDocument.findFirst({ where: { id, patient: { doctorId: actor.id } }, select: { text: true, checksum: true, sourceBytes: true, sourceName: true, sourceMime: true, sourceChecksum: true } }); if (!doc) throw new AppError(404, "Источник недоступен."); if (fingerprint(doc.text) !== doc.checksum) throw new AppError(409, "Источник изменился. Требуется проверка администратора.");
    if (doc.sourceBytes) {
      if (createHash("sha256").update(doc.sourceBytes).digest("hex") !== doc.sourceChecksum) throw new AppError(409, "Файл изменился. Требуется проверка администратора.");
      return new Response(new Uint8Array(doc.sourceBytes), { headers: { "Content-Type": doc.sourceMime!, "Content-Disposition": `attachment; filename="source.${doc.sourceMime === "application/pdf" ? "pdf" : "docx"}"; filename*=UTF-8''${encodeURIComponent(doc.sourceName!)}`, "Cache-Control": "private, no-store", "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
    }
    return new Response(doc.text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return errorResponse(error); }
}
