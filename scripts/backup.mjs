import "dotenv/config";
import { Client } from "pg";
import { randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, closeSync, writeFileSync, createReadStream, renameSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
const database = new URL(process.env.DATABASE_URL ?? "");
if (!['localhost', '127.0.0.1'].includes(database.hostname) || database.port !== "55432" || database.pathname !== "/kontur") throw new Error("This helper only backs up the local kontur database on port 55432.");
const bin = process.env.POSTGRES_BIN ?? (process.platform === "win32" ? "E:/programs/postgre/bin" : "/usr/lib/postgresql/18/bin");
const exe = name => resolve(bin, name + (process.platform === "win32" ? ".exe" : ""));
for (const name of ['pg_dump', 'pg_restore', 'createdb', 'dropdb']) if (!existsSync(exe(name))) throw new Error("Set POSTGRES_BIN to the matching PostgreSQL bin directory.");
const environment = { ...process.env, PGHOST: database.hostname, PGPORT: database.port, PGUSER: decodeURIComponent(database.username), PGPASSWORD: decodeURIComponent(database.password), PGDATABASE: "kontur" };
async function run(name, args) {
  await new Promise((resolveTask, reject) => { const child = spawn(exe(name), args, { env: environment, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] }); child.on('error', () => reject(new Error(`${name} could not start.`))); child.on('exit', code => code === 0 ? resolveTask() : reject(new Error(`${name} failed with exit code ${code}.`))); });
}
const root = resolve(".local/backups"); mkdirSync(root, { recursive: true });
const name = new Date().toISOString().replaceAll(":", "-") + "-" + randomUUID(); const file = resolve(root, name + ".dump.partial");
const descriptor = openSync(file, "wx", 0o600); closeSync(descriptor);
const countsSql = `SELECT json_build_object('users', (SELECT count(*) FROM "User"),'patients', (SELECT count(*) FROM "Patient"),'observations', (SELECT count(*) FROM "Observation"),'messages', (SELECT count(*) FROM "Message"),'submissions', (SELECT count(*) FROM "AssessmentSubmission"),'plans', (SELECT count(*) FROM "CarePlanVersion"),'profiles', (SELECT count(*) FROM "ClinicalProfileVersion"),'bases', (SELECT count(*) FROM "ReviewBasisVersion"),'receipts', (SELECT count(*) FROM "ReviewMessageExecution"),'dailyReports', (SELECT count(*) FROM "CareDailyReport"),'concerns', (SELECT count(*) FROM "PatientConcern"),'referrals', (SELECT count(*) FROM "Referral"),'referralUpdates', (SELECT count(*) FROM "ReferralUpdate"),'documents', (SELECT count(*) FROM "ClinicalDocument"),'extractions', (SELECT count(*) FROM "DocumentExtraction"),'deliveries', (SELECT count(*) FROM "NotificationDelivery"),'deliveryAttempts', (SELECT count(*) FROM "NotificationAttempt"),'savedSummaries', (SELECT count(*) FROM "SavedSummary"),'careTasks', (SELECT count(*) FROM "CareTask"),'carePlanTasks', (SELECT count(*) FROM "CarePlanTask"),'careTaskReports', (SELECT count(*) FROM "CareTaskReport"),'pushDevices', (SELECT count(*) FROM "PushDevice"),'pushDeliveries', (SELECT count(*) FROM "PushDelivery"),'patientReminders', (SELECT count(*) FROM "PatientReminder")) AS counts`;
const criticalTables = ["User","Session","Account","Verification","PushDevice","PushDelivery","Patient","SavedSummary","PatientReminder","Observation","Message","Invitation","LinkRequest","PatientEvent","AuditEvent","AssessmentDefinition","AssessmentAssignment","AssessmentSubmission","ReviewEvent","ReviewBasisVersion","ReviewMessageExecution","CarePlanDraft","CarePlanVersion","CareTask","CarePlanTask","CareTaskReport","ClinicalProfileVersion","CareDailyReport","PatientConcern","Referral","ReferralUpdate","ClinicalDocument","DocumentExtraction","NotificationDelivery","NotificationAttempt","WorkerHeartbeat"];
async function contentDigests(client) {
  const result = {};
  for (const table of criticalTables) { const row = (await client.query(`SELECT count(*)::int AS count, md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY to_jsonb(t)::text), '')) AS digest FROM "${table}" t`)).rows[0]; result[table] = row; }
  return result;
}
const source = new Client({ connectionString: process.env.DATABASE_URL }); const started = Date.now(); let expected; let expectedContent;
try { await source.connect(); await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); const snapshot = (await source.query("SELECT pg_export_snapshot() AS id")).rows[0].id; expected = (await source.query(countsSql)).rows[0].counts; expectedContent = await contentDigests(source);
  await run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", `--snapshot=${snapshot}`, `--file=${file}`]); await source.query("COMMIT");
} finally { await source.end(); }
const digest = createHash('sha256'); for await (const chunk of createReadStream(file)) digest.update(chunk);
const manifest = { format: 1, file: name + ".dump", createdAt: new Date().toISOString(), sha256: digest.digest("hex"), durationMs: Date.now() - started, expected, contentDigests: expectedContent, restore: null };
if (process.argv.includes("--verify")) {
  const temporary = "kontur_restore_" + randomUUID().replaceAll("-", "");
  if (!/^kontur_restore_[a-f0-9]{32}$/.test(temporary) || temporary === database.pathname.slice(1)) throw new Error("Invalid temporary restore database.");
  let created = false; const restoreStarted = Date.now();
  try { await run("createdb", ["--template=template0", temporary]); created = true;
    await run("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl", `--dbname=${temporary}`, file]);
    const targetUrl = new URL(database); targetUrl.pathname = '/' + temporary; const target = new Client({ connectionString: targetUrl.toString() });
    try { await target.connect(); const actual = (await target.query(countsSql)).rows[0].counts; if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Restored row counts differ from the exported snapshot."); const content = await contentDigests(target); if (JSON.stringify(content) !== JSON.stringify(expectedContent)) throw new Error("Restored critical data content differs from snapshot."); manifest.restore = { contentMatches: true, verifiedAt: new Date().toISOString(), durationMs: Date.now() - restoreStarted, countsMatch: true }; } finally { await target.end(); }
  } finally { if (created) await run("dropdb", ["--if-exists", temporary]); }
}
renameSync(file, resolve(root, name + ".dump"));
writeFileSync(resolve(root, name + ".json"), JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
console.info(JSON.stringify({ backup: '.local/backups/' + name + '.dump', durationMs: manifest.durationMs, restoreVerified: !!manifest.restore, restoreDurationMs: manifest.restore?.durationMs ?? null }));
