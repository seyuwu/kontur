import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { request } from "@playwright/test";
import { authPost } from "../tests/e2e/auth-request";
import { db } from "../src/server/db";
if (process.env.DEMO_MODE !== "true" || !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL ?? "").hostname)) throw new Error("Read measurement is restricted to the local synthetic environment.");
const client = await request.newContext({ baseURL: "http://localhost:3000", extraHTTPHeaders: { Origin: "http://localhost:3000" } });
let actorId = "";
try {
  const auth = await authPost(client, "/api/auth/sign-up/email", { name: "Учебный замер", email: `measure-${randomUUID()}@synthetic.kontur.demo`, password: randomUUID() }); if (auth.status() !== 200) throw new Error("Could not create synthetic measurement account."); actorId = (await auth.json()).user.id;
  await db.user.update({ where: { id: actorId }, data: { role: "DOCTOR" } });
  const ids = Array.from({ length: 120 }, () => randomUUID());
  await db.patient.createMany({ data: ids.map((id, i) => ({ id, doctorId: actorId, name: `Учебный замер ${i}`, publicId: `MEASURE-${id}`, birthDate: new Date("1990-01-01") })) });
  await db.observation.createMany({ data: ids.flatMap(patientId => Array.from({ length: 35 }, (_, i) => ({ patientId, score: i % 5 + 1, note: "Синтетическая запись для замера", requestKey: randomUUID(), createdAt: new Date(Date.now() - i * 86400000) }))) });
  const endpoints = ["directory", "detail", "history"] as const;
  const samples: { kind: typeof endpoints[number]; durationMs: number; bytes: number; status: number }[] = []; let cursor = 0;
  const concurrency = Number(process.env.MEASURE_CONCURRENCY ?? 8), total = 180, start = performance.now(); if (![1,8,24].includes(concurrency)) throw new Error("Supported local test concurrency is 1, 8 or 24.");
  await Promise.all(Array.from({ length: concurrency }, async () => { for (;;) { const i = cursor++; if (i >= total) return; const kind = endpoints[i % endpoints.length]; const url = kind === "directory" ? "/api/patients?filter=all" : kind === "detail" ? `/api/patients/${ids[i % ids.length]}` : `/api/patients/${ids[i % ids.length]}/history?period=ALL`; const at = performance.now(); const response = await client.get(url); const body = await response.body(); samples.push({ kind, durationMs: performance.now() - at, bytes: body.length, status: response.status() }); } }));
  const quantile = (values: number[], p: number) => Math.round(values.toSorted((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] * 10) / 10;
  const report = { measuredAt: new Date().toISOString(), scope: "Local synthetic read workload; not a production capacity estimate", patients: ids.length, observations: ids.length * 35, concurrency, requests: total, elapsedMs: Math.round(performance.now() - start), errors: samples.filter(s => s.status !== 200).length, endpoints: endpoints.map(kind => { const rows = samples.filter(s => s.kind === kind); return { kind, requests: rows.length, p50Ms: quantile(rows.map(r => r.durationMs), 0.5), p95Ms: quantile(rows.map(r => r.durationMs), 0.95), maxBytes: Math.max(...rows.map(r => r.bytes)) }; }) };
  mkdirSync(".impeccable/review", { recursive: true }); writeFileSync(".impeccable/review/read-measurement.json", JSON.stringify(report, null, 2)); mkdirSync("docs/evidence",{recursive:true}); writeFileSync(`docs/evidence/read-concurrency-${concurrency}.json`,JSON.stringify(report,null,2)); console.info(JSON.stringify(report)); if (report.errors) throw new Error("Some measured requests failed.");
} finally { if (actorId) { await db.patient.deleteMany({ where: { doctorId: actorId } }); await db.auditEvent.deleteMany({ where: { actorId } }); await db.user.deleteMany({ where: { id: actorId } }); } await client.dispose(); await db.$disconnect(); }
