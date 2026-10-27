import {z} from "zod";
import {AppError,requireActor,errorResponse} from "@/server/access";
import {exportPatient} from "@/modules/integrations";
import {serializeExchange} from "@/modules/integrations/serialize";
export async function GET(request:Request){
  try{
    const actor=await requireActor();
    const query=z.strictObject({patientId:z.string().min(1).max(100),cursor:z.string().min(1).max(100).optional(),format:z.enum(["json","csv"]).default("json")}).safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if(!query.success)throw new AppError(400,"Укажите пациента и формат json или csv.");
    const result=serializeExchange(await exportPatient(actor,query.data),query.data.format);
    return new Response(result.body,{headers:{"Content-Type":result.contentType,"Content-Disposition":`attachment; filename="kontur-patient-v1.${result.extension}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  }catch(error){return errorResponse(error);}
}
