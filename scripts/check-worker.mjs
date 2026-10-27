import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const file = process.env.WORKER_HEARTBEAT_FILE ?? join(tmpdir(), "kontur-worker-heartbeat.json");
try {
  const state = JSON.parse(await readFile(file, "utf8"));
  if (!Number.isInteger(state.pid) || !Number.isFinite(state.at) || Date.now() - state.at > 45000 || state.at > Date.now() + 5000) throw new Error();
  process.kill(state.pid, 0);
} catch { process.exitCode = 1; }
