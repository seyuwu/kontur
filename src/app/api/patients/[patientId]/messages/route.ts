import { z } from "zod";
import { requireActor, errorResponse, AppError } from "@/server/access";
import { getMessagePage } from "@/modules/communication";
export async function GET(request: Request, context: { params: Promise<{ patientId: string }> }) {
  try {
    const actor = await requireActor(); const { patientId } = await context.params;
    const before = new URL(request.url).searchParams.get("before") ?? undefined;
    if (before && !z.string().min(1).max(100).safeParse(before).success) throw new AppError(400, "Проверьте страницу переписки.");
    return Response.json(await getMessagePage(actor, patientId, before), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
