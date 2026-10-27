import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, writeFile, stat, chmod } from "node:fs/promises";
import { resolve } from "node:path";

const base = ["compose", "--env-file", ".local/deploy/.env", "-f", "infra/deploy/compose.yaml"];
const token = randomUUID().replaceAll("-", "");
const temporary = `kontur_restore_${token}`, remote = `/tmp/kontur_backup_${token}.dump`;
if (!/^kontur_restore_[a-f0-9]{32}$/.test(temporary) || !/^\/tmp\/kontur_backup_[a-f0-9]{32}\.dump$/.test(remote)) throw new Error("Invalid temporary target.");
const directory = resolve(".local/backups");
await mkdir(directory, { recursive: true, mode: 0o700 });
const name = `container-${new Date().toISOString().replaceAll(":", "-")}-${token}.dump`;
const partial = resolve(directory, name + ".partial"), target = resolve(directory, name);
const started = Date.now();
async function docker(args) {
  return new Promise((res, rej) => {
    const p = spawn("docker", [...base, ...args], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let output = ""; p.stdout.on("data", chunk => { if (output.length < 65536) output += chunk.toString(); });
    // Database errors can include row contents; don't echo raw diagnostic output.
    p.stderr.resume(); p.once("error", () => rej(new Error("Docker unavailable for backup.")));
    p.once("exit", code => code === 0 ? res(output) : rej(new Error(`Container backup step failed: ${args[0]}.`)));
  });
}
const exec = (...args) => docker(["exec", "-T", "postgres", ...args]);
let restoreCreated = false, restored = null;
try {
  await exec("pg_dump", "-U", "kontur", "-d", "kontur", "--format=custom", "--no-owner", "--no-acl", "-f", remote);
  await docker(["cp", `postgres:${remote}`, partial]);
  await chmod(partial, 0o600);
  const hash = createHash("sha256"); for await (const chunk of createReadStream(partial)) hash.update(chunk);
  if (process.argv.includes("--verify")) {
    await exec("createdb", "-U", "kontur", "--template=template0", temporary); restoreCreated = true;
    await exec("pg_restore", "-U", "kontur", "-d", temporary, "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", remote);
    const result = await exec("psql", "-U", "kontur", "-d", temporary, "-A", "-t", "-c", 'SELECT json_build_object(\'patients\',(SELECT count(*) FROM "Patient"),\'submissions\',(SELECT count(*) FROM "AssessmentSubmission"),\'plans\',(SELECT count(*) FROM "CarePlanVersion"),\'migrations\',(SELECT count(*) FROM "_prisma_migrations"))');
    restored = JSON.parse(result.trim());
  }
  await rename(partial, target);
  const manifest = { format: 1, file: name, createdAt: new Date().toISOString(), sha256: hash.digest("hex"), bytes: (await stat(target)).size, durationMs: Date.now() - started, restoreVerified: restored !== null, restoredCounts: restored, scope: "Consistent pg_dump snapshot; restore/loadability check, not a comparison with a concurrently changing source." };
  await writeFile(target + ".json", JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.info(JSON.stringify({ backup: `.local/backups/${name}`, restoreVerified: manifest.restoreVerified, durationMs: manifest.durationMs }));
} finally {
  if (restoreCreated) await exec("dropdb", "-U", "kontur", temporary);
  await exec("rm", "--", remote).catch(() => {});
}
