import { z } from "zod";
import { createHash } from "node:crypto";
import { AppError, errorResponse, requireActor, requireDoctor, requirePatientAccess } from "@/server/access";
import { getCareVersion } from "@/modules/care";
import { careDocumentText, careDocumentHtml } from "@/modules/care/document";
export async function GET(request: Request) {
  try { const actor = await requireActor(); const input = z.strictObject({ patientId: z.string().min(1).max(100), versionId: z.string().min(1).max(100), audience: z.enum(["patient", "doctor"]), format: z.enum(["text", "html"]).default("html") }).safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!input.success) throw new AppError(400, "Проверьте адрес памятки."); const { patientId, versionId, audience, format } = input.data;
    if (audience === "doctor") requireDoctor(actor);
    const patient = await requirePatientAccess(actor, patientId); const plan = await getCareVersion(actor, patientId, versionId);
    const text = careDocumentText(plan, { name: patient.name, publicId: patient.publicId, birthDate: patient.birthDate.toISOString() }, audience, process.env.DEMO_MODE === "true");
    const styles = "body{margin:32px auto;padding:0 24px;max-width:800px;font:16px/1.6 system-ui;color:#163b30;background:#fff}h1{font-size:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}p{font-size:13px;color:#475e55}@media print{body{margin:0;padding:0;color:#000}body>p{display:none}h1{font-size:20px}}";
    const html = careDocumentHtml(text, audience === "doctor" ? "Проект записи" : "Памятка пациенту").replace("</title>", `</title><style>${styles}</style>`);
    return new Response(format === "text" ? text : html, { headers: { "Content-Type": `${format === "text" ? "text/plain" : "text/html"}; charset=utf-8`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": `default-src 'none'; style-src 'sha256-${createHash("sha256").update(styles).digest("base64")}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, "Referrer-Policy": "no-referrer" } });
  } catch (error) { return errorResponse(error); }
}
