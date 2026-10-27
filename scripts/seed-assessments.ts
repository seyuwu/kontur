import "dotenv/config";
import { publishSeedDefinition } from "../src/modules/assessments/seed-definitions";
import { demoDefinition } from "../src/modules/clinical/demo-definition";
import { f40Definitions } from "../src/modules/clinical/f40-definitions";
import { f40NotificationDefinitions } from "../src/modules/clinical/f40-notification-definitions";
import { db } from "../src/server/db";

if (process.env.DEMO_MODE !== "true") throw new Error("This seed is restricted to demo mode.");
await publishSeedDefinition(demoDefinition);
for (const definition of [...f40Definitions, ...f40NotificationDefinitions]) await publishSeedDefinition(definition);
console.info("Опубликованы учебная анкета связи и 8 бланков из 7 методик КР F40. Все 19 методик доступны в каталоге. Клиническое одобрение не присваивалось.");
await db.$disconnect();
