import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";

/** Exercise the real auth limiter; wait only for its advertised retry interval. */
export async function authPost(client: APIRequestContext, path: string, data: object, headers?: Record<string, string>): Promise<APIResponse> {
  for (let attempt = 0; ; attempt++) {
    const response = await client.post(path, { data, headers });
    if (response.status() !== 429 || attempt === 2) return response;
    const seconds = Number(response.headers()["x-retry-after"] ?? response.headers()["retry-after"]);
    expect(seconds).toBeGreaterThan(0); expect(seconds).toBeLessThanOrEqual(60);
    await new Promise(resolve => setTimeout(resolve, seconds * 1000 + 100));
  }
}
