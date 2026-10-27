import { requireActor, errorResponse, AppError } from "@/server/access";
import { directoryQuerySchema, getPatientDirectory, readEtag } from "@/modules/patients/directory";
export async function GET(request: Request) {
  try {
    const actor = await requireActor(); const params = new URL(request.url).searchParams;
    const query = directoryQuerySchema.safeParse({ q: params.get("q") ?? "", filter: params.get("filter") ?? "all", cursor: params.get("cursor") ?? undefined });
    if (!query.success) throw new AppError(400, "Проверьте поиск, фильтр или страницу списка.");
    const data = await getPatientDirectory(actor, query.data); const etag = readEtag(data);
    const headers = { "Cache-Control": "private, no-store", ETag: etag, Vary: "Cookie" };
    return request.headers.get("if-none-match") === etag ? new Response(null, { status: 304, headers }) : Response.json(data, { headers });
  } catch (error) { return errorResponse(error); }
}
