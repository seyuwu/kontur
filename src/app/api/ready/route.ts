import { readiness } from "@/modules/operations";

export async function GET() {
  const state = await readiness();
  return Response.json({ status: state.ready ? "ok" : "unavailable", database: state.database ? "ok" : "unavailable", worker: state.worker ? "ok" : "unavailable" },
    { status: state.ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
