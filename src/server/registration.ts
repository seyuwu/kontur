import { z } from "zod";
import { APIError } from "better-auth/api";

const selection = z.object({
  accountType: z.enum(["PATIENT", "DOCTOR"]).default("PATIENT"),
  doctorSpecialty: z.string().trim().max(120).optional(),
  syntheticData: z.boolean().optional()
});

/** Public doctor creation is restricted to the explicitly enabled synthetic demo. */
export function registrationFields(body: unknown) {
  const parsed = selection.safeParse(body);
  if (!parsed.success) throw new APIError("BAD_REQUEST", { message: "Проверьте роль и специальность." });
  const input = parsed.data;
  if (input.accountType === "DOCTOR" && (process.env.DEMO_MODE !== "true" || input.syntheticData !== true)) {
    throw new APIError("FORBIDDEN", { message: "Регистрация врача доступна только для работы с вымышленными данными." });
  }
  return { role: input.accountType, specialty: input.accountType === "DOCTOR" ? input.doctorSpecialty || null : null };
}
