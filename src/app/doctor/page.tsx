import { redirect } from "next/navigation";
import { doctorReturn } from "@/lib/login-return";
import { requireActor, AppError } from "@/server/access";
import { getPatientDetail } from "@/modules/patients";
import { directoryQuerySchema, getPatientDirectory } from "@/modules/patients/directory";
import { DoctorWorkspace } from "@/components/doctor/workspace";
export const dynamic = "force-dynamic";
export default async function DoctorPage({ searchParams }: { searchParams: Promise<{ patient?: string; event?: string; tab?: string; q?: string; filter?: string; cursor?: string }> }) {
  const params = await searchParams;
  let actor;
  try { actor = await requireActor(); } catch (e) { if (e instanceof AppError && e.status === 401) redirect(`/login?next=${encodeURIComponent(doctorReturn(params))}`); throw e; }
  if (actor.role !== "DOCTOR") redirect("/patient");
  const parsed = directoryQuerySchema.safeParse({ q: params.q ?? "", filter: params.filter ?? "all", cursor: params.cursor });
  let query = parsed.success ? parsed.data : { q: "", filter: "all" as const }; let notice = parsed.success ? "" : "Параметры поиска сброшены. Введите запрос заново.";
  const directoryPromise = getPatientDirectory(actor, query).catch(error => { if (!(error instanceof AppError) || error.status !== 400) throw error; query = { ...query, cursor: undefined }; notice = error.message; return getPatientDirectory(actor, query); });
  const patientPromise = params.patient ? getPatientDetail(actor, params.patient).catch(error => { if (!(error instanceof AppError) || error.status !== 404) throw error; return undefined; }) : Promise.resolve(undefined);
  const [data, patient] = await Promise.all([directoryPromise, patientPromise]);
  return <DoctorWorkspace initialData={data} initialQuery={query} initialPatient={patient} initialPatientId={params.patient} initialTab={params.tab} initialNotice={notice} />;
}
