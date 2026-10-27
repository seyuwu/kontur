import { test, expect } from "@playwright/test";

test("readiness exposes only bounded technical state and disables caching", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(health.headers()["cache-control"]).toBe("no-store");
  const ready = await request.get("/api/ready");
  const state = await ready.json();
  expect(Object.keys(state).sort()).toEqual(["database", "status", "worker"]);
  expect(state.database).toBe("ok");
  expect(["ok", "unavailable"]).toContain(state.worker);
  expect(state.status).toBe(state.worker);
  expect(ready.status()).toBe(state.worker === "ok" ? 200 : 503);
  expect(ready.headers()["cache-control"]).toBe("no-store");
  expect((await request.post("/api/ready")).status()).toBe(405);
});
