import { betterAuth } from "better-auth";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { z } from "zod";
import { redeemPatientInvitation } from "@/modules/access";
import { AppError } from "./access";
import { db } from "./db";
import { registrationFields } from "./registration";

export const auth = betterAuth({
  appName: "Контур",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  plugins: [{
    id: "patient-invitation",
    endpoints: {
      signInInvitation: createAuthEndpoint("/sign-in/invitation", {
        method: "POST",
        requireHeaders: true,
        body: z.object({ secret: z.string().trim().regex(/^(?:[a-f0-9]{64}|\d{6})$/) })
      }, async ctx => {
        if (ctx.headers?.get("origin") !== (process.env.APP_ORIGIN ?? "http://localhost:3000")) throw new APIError("FORBIDDEN", { message: "Запрос с этого адреса не разрешён." });
        if (await getSessionFromCtx(ctx)) throw new APIError("CONFLICT", { message: "Вы уже вошли в аккаунт. Обновите страницу." });
        let result;
        try { result = await redeemPatientInvitation(ctx.body.secret, ctx.context.sessionConfig.expiresIn, ctx.headers?.get("user-agent") ?? undefined); }
        catch (error) { if (error instanceof AppError) throw new APIError("BAD_REQUEST", { message: error.message }); throw error; }
        await setSessionCookie(ctx, result);
        return ctx.json({ saved: true });
      })
    },
    rateLimit: [{ pathMatcher: path => path === "/sign-in/invitation", window: 60, max: 12 }]
  }],
  user: { additionalFields: {
    role: { type: "string", defaultValue: "PATIENT", input: false },
    specialty: { type: "string", required: false, input: false }
  } },
  databaseHooks: { user: { create: { before: async (user, context) => {
    if (context?.path !== "/sign-up/email") return;
    return { data: { ...user, ...registrationFields(context.body) } };
  } } } },
  trustedOrigins: [process.env.APP_ORIGIN ?? "http://localhost:3000"],
  session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 30 },
  rateLimit: { enabled: true, storage: "memory", window: 60, max: 60 }
});
