const deadline = Date.now() + 60000;
const endpoint = new URL("/api/ready", process.env.READY_ORIGIN ?? "http://localhost:3000");
let ready = false;
while (Date.now() < deadline) {
  try { const r = await fetch(endpoint, { signal: AbortSignal.timeout(2000) }); if (r.ok && (await r.json()).status === "ok") { ready = true; break; } } catch { /* bounded startup retry */ }
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!ready) throw new Error("Application did not become ready within 60 seconds.");
console.info("Application ready.");
