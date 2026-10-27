import { db } from "./db";

export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function requireActor() {
  const [{ headers }, { auth }] = await Promise.all([import("next/headers"), import("./auth")]);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new AppError(401, "Войдите в аккаунт, чтобы продолжить.");
  const actor = await db.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, role: true, specialty: true, email: true } });
  if (!actor) throw new AppError(401, "Сессия завершена. Войдите ещё раз.");
  return actor;
}
export type Actor = Awaited<ReturnType<typeof requireActor>>;
export function requireDoctor(actor: Actor) {
  if (actor.role !== "DOCTOR") throw new AppError(403, "Это действие доступно врачу.");
}
export async function requirePatientAccess(actor: Actor, patientId: string) {
  const patient = await db.patient.findFirst({ where: { id: patientId, ...(actor.role === "DOCTOR" ? { doctorId: actor.id } : { userId: actor.id }) } });
  if (!patient) throw new AppError(404, "Карточка не найдена или недоступна.");
  return patient;
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== (process.env.APP_ORIGIN ?? "http://localhost:3000")) throw new AppError(403, "Запрос с этого адреса не разрешён.");
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Request failed", error instanceof Error ? error.name : "UnknownError");
  return Response.json({ error: "Не удалось выполнить действие. Попробуйте ещё раз." }, { status: 500 });
}
