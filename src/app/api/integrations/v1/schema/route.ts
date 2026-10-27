import {z} from "zod";
import {requireActor,requireDoctor,errorResponse} from "@/server/access";
import {exchangeSchema} from "@/modules/integrations/contract";
export async function GET(){try{requireDoctor(await requireActor());return Response.json(z.toJSONSchema(exchangeSchema),{headers:{"Cache-Control":"private, no-store"}});}catch(error){return errorResponse(error);}}
