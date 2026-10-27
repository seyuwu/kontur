import "dotenv/config";
import { cp, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const standalone = new URL(".next/standalone/", root);
await access(new URL("server.js", standalone)).catch(() => {
  throw new Error("Сначала выполните npm run build.");
});
await cp(new URL(".next/static", root), new URL(".next/static", standalone), { recursive: true });
try {
  await access(new URL("public", root));
  await cp(new URL("public", root), new URL("public", standalone), { recursive: true });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const server = spawn(process.execPath, [fileURLToPath(new URL("server.js", standalone))], {
  cwd: fileURLToPath(root),
  env: { ...process.env, HOSTNAME: process.env.APP_HOST ?? "0.0.0.0", PORT: process.env.PORT ?? "3000" },
  stdio: "inherit",
  windowsHide: true
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("error", error => { console.error(error.message); process.exitCode = 1; });
server.on("exit", code => { process.exitCode = code ?? 0; });
