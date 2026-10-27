import { requirePushActor } from "@/modules/web-push/access";
import { z } from "zod";
import { auth } from "@/server/auth";
import { AppError, requireActor, requireDoctor, checkOrigin, errorResponse } from "@/server/access";
import { pushSettings, registerDevice, disableDevice, testPush, acknowledgePush } from "@/modules/web-push";
const id = z.string().min(1).max(100);
const commands = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("connect"), label: z.string().trim().min(1).max(60), subscription: z.unknown() }),
  z.strictObject({ action: z.literal("disconnect"), deviceId: id }),
  z.strictObject({ action: z.literal("test"), deviceId: id, requestKey: z.string().uuid() }),
  z.strictObject({ action: z.literal("shown"), deliveryId: id })
]);
async function context(request: Request) {
  const actor = await requireActor(); await requirePushActor(actor);
  const session = await auth.api.getSession({ headers: request.headers }); if (!session || session.user.id !== actor.id) throw new AppError(401, "Войдите в аккаунт снова.");
  return { actor, sessionId: session.session.id };
}
export async function GET(request: Request) {
  try { return Response.json(await pushSettings(await context(request)), { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request); const ctx = await context(request); const raw = await request.text(); if (raw.length > 5000) throw new AppError(413, "Слишком большой запрос.");
    let json: unknown; try { json = JSON.parse(raw); } catch { throw new AppError(400, "Проверьте запрос."); }
    const parsed = commands.safeParse(json); if (!parsed.success) throw new AppError(400, "Проверьте настройки уведомлений."); const data = parsed.data;
    switch (data.action) {
      case "connect": return Response.json(await registerDevice(ctx, data));
      case "disconnect": return Response.json(await disableDevice(ctx, data.deviceId));
      case "test": return Response.json(await testPush(ctx, data.deviceId, data.requestKey));
      case "shown": return Response.json(await acknowledgePush(ctx, data.deliveryId));
    }
  } catch (error) { return errorResponse((error as { code?: string }).code === "P2002" ? new AppError(409, "Подписка уже используется. Обновите настройки.") : error); }
}
