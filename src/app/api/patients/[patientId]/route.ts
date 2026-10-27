import { requireActor, errorResponse } from "@/server/access";
import { getPatientDetail, getPatientDetailVersion } from "@/modules/patients";
export async function GET(request: Request, context: { params: Promise<{ patientId: string }> }) {
  try {
    const actor = await requireActor(); const { patientId } = await context.params;
    const etag = await getPatientDetailVersion(actor, patientId);
    const headers = { "Cache-Control": "private, no-store", ETag: etag, Vary: "Cookie" };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return Response.json({ patient: await getPatientDetail(actor, patientId) }, { headers });
  } catch (error) { return errorResponse(error); }
}
