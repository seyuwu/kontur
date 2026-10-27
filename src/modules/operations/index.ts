import { db } from "@/server/db";

export const heartbeatIntervalMs = 10000;
export const heartbeatMaxAgeMs = 45000;

/** This is a process/DB readiness signal, not proof of external delivery. */
export async function readiness() {
  try {
    const [worker] = await db.$queryRaw<{ ready: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM "WorkerHeartbeat"
        WHERE "checkedAt" > clock_timestamp() - INTERVAL '45 seconds') AS ready`;
    return { ready: worker.ready, database: true, worker: worker.ready };
  } catch { return { ready: false, database: false, worker: false }; }
}

export async function beat(id: string) {
  await db.$executeRaw`INSERT INTO "WorkerHeartbeat" (id, "checkedAt") VALUES (${id}, clock_timestamp())
    ON CONFLICT (id) DO UPDATE SET "checkedAt" = clock_timestamp()`;
}

export async function retire(id: string) { await db.workerHeartbeat.deleteMany({ where: { id } }); }
