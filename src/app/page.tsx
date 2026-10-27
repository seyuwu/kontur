import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
export const dynamic = "force-dynamic";
export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  redirect(user?.role === "DOCTOR" ? "/doctor" : "/patient");
}
