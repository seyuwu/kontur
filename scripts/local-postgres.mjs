import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const local = resolve(root, ".local");
mkdirSync(local, { recursive: true });
const envPath = resolve(root, ".env");
if (!existsSync(envPath)) {
  const password = randomBytes(24).toString("hex");
  writeFileSync(envPath, `DATABASE_URL=postgresql://kontur:${password}@127.0.0.1:55432/kontur\nBETTER_AUTH_SECRET=${randomBytes(40).toString("hex")}\nBETTER_AUTH_URL=http://localhost:3000\nAPP_ORIGIN=http://localhost:3000\nDEMO_MODE=true\nDEMO_PASSWORD=${randomBytes(14).toString("base64url")}\n`);
}
const envText = readFileSync(envPath, "utf8");
const databaseUrl = new URL(envText.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim() ?? "");
if (databaseUrl.hostname !== "127.0.0.1" || databaseUrl.port !== "55432") throw new Error("Local helper only manages the project database on 127.0.0.1:55432.");
const bin = process.env.POSTGRES_BIN ?? (process.platform === "win32" ? "E:/programs/postgre/bin" : "/usr/lib/postgresql/17/bin");
const exe = (name) => resolve(bin, name + (process.platform === "win32" ? ".exe" : ""));
if (!existsSync(exe("pg_ctl"))) throw new Error("Set POSTGRES_BIN to a local PostgreSQL bin directory, or use infra/compose.yaml.");
const data = resolve(local, "postgres");
const environment = { ...process.env, PGPASSWORD: decodeURIComponent(databaseUrl.password) };
function run(name, args, allowFailure = false) {
  const result = spawnSync(exe(name), args, { env: environment, encoding: "utf8", windowsHide: true, timeout: 120000 });
  if (result.status !== 0 && !allowFailure) throw new Error(result.stderr || result.stdout || result.error?.message || `${name} failed`);
  return result;
}
if (!existsSync(resolve(data, "PG_VERSION"))) {
  const passwordFile = resolve(local, "pg-password");
  writeFileSync(passwordFile, decodeURIComponent(databaseUrl.password));
  try { run("initdb", ["-D", data, "-U", databaseUrl.username, "--pwfile=" + passwordFile, "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--encoding=UTF8", "--locale=C"]); }
  finally { unlinkSync(passwordFile); }
}
if (run("pg_ctl", ["-D", data, "status"], true).status !== 0) {
  run("pg_ctl", ["-D", data, "-l", resolve(local, "postgres.log"), "-o", "-h 127.0.0.1 -p 55432", "-w", "start"]);
}
const created = run("createdb", ["-h", "127.0.0.1", "-p", "55432", "-U", databaseUrl.username, "kontur"], true);
if (created.status !== 0 && !created.stderr.includes("already exists")) {
  const check = run("psql", ["-h", "127.0.0.1", "-p", "55432", "-U", databaseUrl.username, "-d", "kontur", "-c", "SELECT 1"], true);
  if (check.status !== 0) throw new Error(created.stderr);
}
console.info("Локальная PostgreSQL готова: 127.0.0.1:55432. Данные: .local/postgres. Секреты сохранены в .env.");
