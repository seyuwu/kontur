import "dotenv/config";
import { randomUUID } from "node:crypto";
import { writeFile, rename, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, type Runner } from "graphile-worker";
import { processReviewEmail } from "../modules/notifications";
import { processPush } from "../modules/web-push";
import { processDocumentExtraction } from "../modules/documents/worker";
import { beat, retire, heartbeatIntervalMs } from "../modules/operations";
import { db } from "../server/db";
import {schedulePatientReminders} from "../modules/web-push/reminders";

const instanceId = randomUUID();
const file = process.env.WORKER_HEARTBEAT_FILE ?? join(tmpdir(), "kontur-worker-heartbeat.json");
const runners: Runner[] = [];
let stopping = false, beating = false;
let timer: ReturnType<typeof setInterval> | undefined;
let stopPromise: Promise<void> | undefined;
let reminderTimer:ReturnType<typeof setInterval>|undefined,reminding=false;
async function reminders(){if(stopping||reminding)return;reminding=true;try{await schedulePatientReminders();}catch{console.error("Kontur: patient reminder scheduling failed.");}finally{reminding=false;}}
async function shutdown(failed = false) {
  if (failed) process.exitCode = 1;
  if (stopPromise) return stopPromise;
  stopping = true;
  clearInterval(timer);
  clearInterval(reminderTimer);
  // Withdraw readiness before draining jobs; a deadline prevents hung shutdowns.
  const deadline = setTimeout(() => process.exit(1), 80000); deadline.unref();
  stopPromise = (async () => {
    try { await retire(instanceId); } catch { /* stale rows expire after 45s */ }
    try { if (JSON.parse(await readFile(file, "utf8")).pid === process.pid) await unlink(file); } catch { /* already absent */ }
    const results = await Promise.allSettled(runners.map(r => r.stop()));
    if (results.some(r => r.status === "rejected")) process.exitCode = 1;
    await db.$disconnect(); clearTimeout(deadline);
    console.info("Kontur: workers stopped.");
  })();
  return stopPromise;
}
async function heartbeat() {
  if (stopping || beating) return; beating = true;
  try {
    await beat(instanceId);
    if (stopping) { await retire(instanceId); return; }
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ pid: process.pid, at: Date.now() }), { mode: 0o600 });
    await rename(temporary, file);
  } catch { console.error("Kontur: worker readiness lost."); void shutdown(true); }
  finally { beating = false; }
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { void shutdown(); });
try {
  runners.push(await run({ connectionString: process.env.DATABASE_URL, noHandleSignals: true, concurrency: 1, taskList: {
    document_extract: async payload => { const id = (payload as { extractionId?: string }).extractionId; if (!id || typeof id !== "string") throw new Error("Missing extraction identifier"); await processDocumentExtraction(id); },
    workspace_event: async payload => { if (!(payload as { eventId?: string }).eventId) throw new Error("Missing event identifier"); }
  } }));
  runners.push(await run({ connectionString: process.env.DATABASE_URL, noHandleSignals: true, concurrency: 2, taskList: {
    notification_push: async payload => { const id = (payload as { deliveryId?: string }).deliveryId; if (!id || typeof id !== "string") throw new Error("Missing delivery identifier"); await processPush(id); },
    notification_email: async payload => { const id = (payload as { deliveryId?: string }).deliveryId; if (!id || typeof id !== "string") throw new Error("Missing delivery identifier"); await processReviewEmail(id); }
  } }));
  // A dead pool invalidates the process and its heartbeat.
  for (const runner of runners) void runner.promise.then(() => { if (!stopping) void shutdown(true); }, () => { void shutdown(true); });
  await db.workerHeartbeat.deleteMany({ where: { checkedAt: { lt: new Date(Date.now() - 86400000) } } });
  await heartbeat();
  if(!stopping){void reminders();reminderTimer=setInterval(()=>{void reminders();},60000);}
  if (!stopping) { timer = setInterval(() => { void heartbeat(); }, heartbeatIntervalMs); console.info("Kontur: task and notification queues ready."); }
} catch { console.error("Kontur: worker startup failed."); await shutdown(true); }
