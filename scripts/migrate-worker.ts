import "dotenv/config";
import { makeWorkerUtils } from "graphile-worker";
const utils = await makeWorkerUtils({ connectionString: process.env.DATABASE_URL });
await utils.migrate();
await utils.release();
console.info("Схема очереди подготовлена.");
