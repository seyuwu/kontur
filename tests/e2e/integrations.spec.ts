import "dotenv/config";
import {randomUUID} from "node:crypto";
import {test,expect,request,type APIRequestContext} from "@playwright/test";
import {db} from "../../src/server/db";
import {authPost} from "./auth-request";
import {exchangeSchema} from "../../src/modules/integrations/contract";
test("v1 export is bounded, scoped to the doctor, audited and usable as JSON and CSV",async()=>{
  const origin="http://localhost:3000",clients:APIRequestContext[]=[],ids:string[]=[];let patientId="";
  try{
    for(const role of ["DOCTOR","DOCTOR","PATIENT"]){const api=await request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});clients.push(api);const r=await authPost(api,"/api/auth/sign-up/email",{name:"Учебный экспорт",email:`exchange-${randomUUID()}@synthetic.kontur.demo`,password:randomUUID()});expect(r.status()).toBe(200);const id=(await r.json()).user.id;ids.push(id);if(role==="DOCTOR")await db.user.update({where:{id},data:{role}});}
    const [doctor,other,patient]=clients;patientId=(await db.patient.create({data:{doctorId:ids[0],userId:ids[2],name:"=Учебное имя",publicId:`EXCHANGE-${randomUUID()}`,birthDate:new Date("1990-01-01")}})).id;
    const url=`/api/integrations/v1/export?patientId=${patientId}`;
    const anon=await request.newContext({baseURL:origin});expect((await anon.get(url)).status()).toBe(401);await anon.dispose();expect((await other.get(url)).status()).toBe(404);expect((await patient.get(url)).status()).toBe(403);
    const json=await doctor.get(url);expect(json.status()).toBe(200);expect(json.headers()["cache-control"]).toContain("no-store");const snapshot=exchangeSchema.parse(await json.json());expect(snapshot.patient.id).toBe(patientId);expect(snapshot.contractVersion).toBe("1.0");expect(JSON.stringify(snapshot)).not.toMatch(/session|password|token|privateKey/);
    const csv=await doctor.get(url+"&format=csv");expect(csv.status()).toBe(200);expect(csv.headers()["content-type"]).toContain("text/csv");expect(await csv.text()).toContain("'=Учебное имя");
    expect((await doctor.get(url+"&format=xml")).status()).toBe(400);expect((await doctor.get(url+"&cursor=unrelated")).status()).toBe(400);expect((await doctor.get("/api/integrations/v1/schema")).status()).toBe(200);expect(await db.auditEvent.count({where:{actorId:ids[0],targetId:patientId,action:"integration.export.v1"}})).toBe(2);
  }finally{if(patientId)await db.patient.deleteMany({where:{id:patientId}});await db.auditEvent.deleteMany({where:{actorId:{in:ids}}});await db.user.deleteMany({where:{id:{in:ids}}});await Promise.all(clients.map(c=>c.dispose()));await db.$disconnect();}
});
