import "dotenv/config";
import {randomUUID,createHash} from "node:crypto";
import {readFile,writeFile,mkdir,rm} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {db} from "../src/server/db";
import {demoDefinition} from "../src/modules/clinical/demo-definition";
import {evaluateAssessment,assessmentDefinitionSchema} from "../src/modules/clinical";
const url=new URL(process.env.DATABASE_URL??"");if(process.env.DEMO_MODE!=="true"||!["localhost","127.0.0.1"].includes(url.hostname))throw Error("Local synthetic environment required.");
const code=`extension-${randomUUID()}`,file=`.local/${code}.json`,core="src/modules/clinical/index.ts";
const digest=async()=>createHash("sha256").update(await readFile(core)).digest("hex");
const original=await digest();
try{
  await mkdir(".local",{recursive:true});const definition=structuredClone(demoDefinition);definition.code=code;definition.title="Синтетическая новая методика";definition.questions[0].options[2].points=7;
  const parsed=assessmentDefinitionSchema.parse(definition);if(evaluateAssessment(parsed,{clarity:"unclear",contact:"no"}).metric.value!==7)throw Error("New scale scoring failed.");
  await writeFile(file,JSON.stringify(definition));
  const publish=()=>spawnSync(process.execPath,["node_modules/tsx/dist/cli.mjs","scripts/publish-assessment.ts",file],{windowsHide:true,stdio:"pipe",env:process.env}).status;
  if(publish()!==0)throw Error("Publication failed.");if(publish()!==0)throw Error("Idempotent publication failed.");
  definition.questions[0].title="Изменённое определение без новой версии";await writeFile(file,JSON.stringify(definition));if(publish()===0)throw Error("Immutable definition was overwritten.");
  definition.version=2;await writeFile(file,JSON.stringify(definition));if(publish()!==0)throw Error("New version failed.");
  const report={at:new Date().toISOString(),syntheticOnly:true,newScalePublished:true,newScaleScore:7,idempotent:true,overwriteRejected:true,newVersionPublished:true,coreUnchanged:await digest()===original};
  if(!report.coreUnchanged)throw Error("Scoring core changed.");await mkdir("docs/evidence",{recursive:true});await writeFile("docs/evidence/extensibility.json",JSON.stringify(report,null,2));console.info(JSON.stringify(report));
}finally{await db.assessmentDefinition.deleteMany({where:{code}});await rm(file,{force:true});await db.$disconnect();}
