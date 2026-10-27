import { redirect } from "next/navigation";
import { patientReturn } from "@/lib/login-return";
import { requireActor, AppError } from "@/server/access";
import { getWorkspace } from "@/modules/patients";
import { PatientWorkspace } from "@/components/patient/workspace";
export const dynamic = "force-dynamic";
export default async function PatientPage({ searchParams }: { searchParams: Promise<{ tab?: string; assignment?: string }> }) {
  const params = await searchParams;
  let actor;
  try { actor = await requireActor(); } catch (e) { if (e instanceof AppError && e.status === 401) redirect(`/login?next=${encodeURIComponent(patientReturn(params))}`); throw e; }
  if (actor.role === "DOCTOR") redirect("/doctor");
  const workspace = await getWorkspace(actor);
  if (!workspace.patients.length && !workspace.pendingLink) redirect("/connect");
  return <PatientWorkspace initialData={workspace} initialTab={params.tab} initialAssignment={params.assignment && /^[a-z0-9-]{1,100}$/i.test(params.assignment) ? params.assignment : undefined} />;
}
