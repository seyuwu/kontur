import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { requireActor, errorResponse, AppError } from "@/server/access";
import { f40Source } from "@/modules/clinical/f40-bai-definition";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await requireActor();
    const params = new URL(request.url).searchParams;
    if (params.size !== 1 || params.get("id") !== f40Source.id) throw new AppError(404, "Источник не найден.");
    const bytes = await readFile(join(process.cwd(), "resources", "clinical", "f40-455-2024.pdf"));
    if (createHash("sha256").update(bytes).digest("hex") !== f40Source.sha256) throw new AppError(409, "Контрольная сумма источника не совпала. Обратитесь к администратору.");
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=\"f40-455-2024.pdf\"", "Cache-Control": "private, no-store", "X-Source-SHA256": f40Source.sha256 } });
  } catch (error) { return errorResponse(error); }
}
