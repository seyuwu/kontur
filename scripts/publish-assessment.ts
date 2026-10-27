import "dotenv/config";
import {readFile} from "node:fs/promises";
import {assessmentDefinitionSchema} from "../src/modules/clinical";
import {publishDefinition} from "../src/modules/assessments/definitions";
import {db} from "../src/server/db";
try{
  const file=process.argv[2];if(!file)throw Error("Usage: npm run assessment:publish -- path/to/definition.json");
  const url=new URL(process.env.DATABASE_URL??"");if(process.env.DEMO_MODE!=="true"||!["localhost","127.0.0.1"].includes(url.hostname))throw Error("This helper publishes only local synthetic definitions.");
  const raw=await readFile(file,"utf8");if(raw.length>200000)throw Error("Definition is too large.");const definition=assessmentDefinitionSchema.parse(JSON.parse(raw));
  if(definition.mode!=="DEMO"||definition.review!=="DEMO")throw Error("Clinical approval cannot be assigned by this helper.");
  const record=await publishDefinition(definition);console.info(JSON.stringify({code:record.code,version:record.version,checksum:record.checksum,published:true,coreChanged:false}));
}finally{await db.$disconnect();}
