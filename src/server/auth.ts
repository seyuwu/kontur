import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { db } from "./db";
import { registrationFields } from "./registration";

export const auth = betterAuth({
  appName: "Контур",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
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
