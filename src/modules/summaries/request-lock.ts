import { AppError } from "@/server/access";

const active = new Set<string>();
/** Only overlapping requests are blocked. Failure and success both release immediately. */
export async function withSummaryLock<T>(actorId: string, work: () => Promise<T>): Promise<T> {
  if (active.has(actorId)) throw new AppError(429, "Обобщение уже выполняется. Дождитесь результата этого запроса.");
  active.add(actorId);
  try { return await work(); }
  finally { active.delete(actorId); }
}
