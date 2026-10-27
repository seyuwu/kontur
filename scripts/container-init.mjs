import { spawn } from "node:child_process";
const task = process.argv[2];
if (!["migrate", "seed"].includes(task)) throw new Error("Choose migrate or seed.");
async function run(args) {
  const status = await new Promise((resolve, reject) => { const child = spawn(process.execPath, args, { stdio: "inherit", windowsHide: true }); child.once("error", reject); child.once("exit", code => resolve(code)); });
  if (status !== 0) throw new Error("Deployment initialization failed; application was not started.");
}
if (task === "migrate") { await run(["node_modules/prisma/build/index.js", "migrate", "deploy"]); await run(["--import", "tsx", "scripts/migrate-worker.ts"]); }
else {
  if (process.env.DEMO_MODE !== "true" || (process.env.DEMO_PASSWORD?.length ?? 0) < 16) throw new Error("Seed requires explicit demo mode and a separate strong demo password.");
  await run(["--import", "tsx", "scripts/seed.ts"]);
}
