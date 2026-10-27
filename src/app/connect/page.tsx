import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { ConnectForm } from "@/components/auth/connect-form";
export const dynamic = "force-dynamic";
export default async function ConnectPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const user = session ? await db.user.findUnique({ where: { id: session.user.id }, select: { role: true, patient: { select: { doctor: { select: { name: true } } } } } }) : null;
  if (user?.role === "DOCTOR") redirect("/doctor");
  const pending = session ? await db.linkRequest.count({ where: { userId: session.user.id, status: "PENDING", invitation: { revokedAt: null, consumedAt: null, expiresAt: { gt: new Date() } } } }) > 0 : false;
  return <ConnectForm loggedIn={!!session} pending={pending} linkedDoctorName={user?.patient?.doctor.name} />;
}
