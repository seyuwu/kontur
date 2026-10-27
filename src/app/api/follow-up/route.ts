import { z } from "zod";
import { AppError, checkOrigin, errorResponse, requireActor } from "@/server/access";
import { dailyInput, concernInput, referralContent, referralProgress } from "@/modules/follow-up/contract";
import { dailyJournal, reportDaily } from "@/modules/follow-up/daily";
import { concerns, submitConcern, reviewConcern } from "@/modules/follow-up/concerns";
import { referrals, referral, confirmReferral, progressReferral } from "@/modules/follow-up/referrals";
const id = z.string().min(1).max(100); const basis = { basisToken: z.string().regex(/^[a-f0-9]{64}$/), requestKey: z.string().uuid(), reviewed: z.literal(true) };
const commands = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("daily-report"), ...dailyInput.shape }),
  z.strictObject({ action: z.literal("concern"), ...concernInput.shape }),
  z.strictObject({ action: z.literal("review-concern"), patientId: id, id }),
  z.strictObject({ action: z.literal("confirm-referral"), patientId: id, content: referralContent, ...basis }),
  z.strictObject({ action: z.literal("progress-referral"), patientId: id, id, revision: z.number().int().positive(), progress: referralProgress, ...basis })
]);
export async function GET(request: Request) {
  try { const actor = await requireActor(); const q = z.strictObject({ patientId: id, view: z.enum(["daily", "concerns", "referrals", "referral"]), id: id.optional(), planVersionId: id.optional(), cursor: id.optional(), status: z.enum(["ACTIVE", "ALL"]).optional(), beforeRevision: z.coerce.number().int().positive().optional() }).safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!q.success) throw new AppError(400, "Проверьте адрес наблюдения."); const { patientId, view, id: selected, cursor, beforeRevision, planVersionId, status } = q.data;
    if ((status && view !== "referrals") || (view === "referral") !== !!selected || (beforeRevision && view !== "referral") || (cursor && !["concerns", "referrals"].includes(view)) || (planVersionId && view !== "daily")) throw new AppError(400, "Проверьте параметры истории.");
    return Response.json(view === "daily" ? await dailyJournal(actor, patientId, planVersionId) : view === "concerns" ? await concerns(actor, patientId, cursor) : view === "referrals" ? await referrals(actor, patientId, cursor, status) : await referral(actor, patientId, selected!, beforeRevision), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try { checkOrigin(request); const actor = await requireActor(); const body = await request.text(); if (body.length > 24000) throw new AppError(413, "Слишком большой объём данных."); let json: unknown; try { json = JSON.parse(body); } catch { throw new AppError(400, "Проверьте формат данных."); }
    const input = commands.safeParse(json); if (!input.success) throw new AppError(400, "Проверьте поля, источник и подтверждение врача."); const d = input.data;
    switch (d.action) {
      case "daily-report": { const { action: _, ...payload } = d; const checked = dailyInput.safeParse(payload); if (!checked.success) throw new AppError(400, "Опишите вопрос врачу."); return Response.json(await reportDaily(actor, checked.data)); }
      case "concern": { const { action: _, ...payload } = d; return Response.json(await submitConcern(actor, payload)); }
      case "review-concern": return Response.json(await reviewConcern(actor, d.patientId, d.id));
      case "confirm-referral": return Response.json(await confirmReferral(actor, d));
      case "progress-referral": return Response.json(await progressReferral(actor, d));
    }
  } catch (error) { return errorResponse((error as { code?: string }).code === "P2002" ? new AppError(409, "Ключ уже использован или запись изменилась. Обновите данные.") : error); }
}
