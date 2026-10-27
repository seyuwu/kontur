import { z } from "zod";
import { AppError, errorResponse, requireActor } from "@/server/access";
import { getPatientHistory } from "@/modules/patients/history";
export async function GET(request: Request, context: { params: Promise<{ patientId: string }> }) {
  try { const actor = await requireActor(); const { patientId } = await context.params;
    const q = z.strictObject({ period: z.enum(["7", "30", "90", "ALL"]).optional(), cursor: z.string().min(1).max(1200).optional() }).safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!q.success || patientId.length > 100) throw new AppError(400, "Проверьте период истории.");
    return Response.json(await getPatientHistory(actor, patientId, q.data.period, q.data.cursor), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
