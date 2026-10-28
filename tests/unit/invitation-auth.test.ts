import { beforeEach, expect, it, vi } from "vitest";

const { post } = vi.hoisted(() => ({ post: vi.fn(async (_request: Request) => Response.json({ saved: true })) }));
vi.mock("../../src/server/auth", () => ({ auth: {} }));
vi.mock("better-auth/next-js", () => ({ toNextJsHandler: () => ({ POST: post, GET: vi.fn() }) }));
import { POST } from "../../src/app/api/auth/[...all]/route";

beforeEach(() => post.mockClear());
it("does not let supplied proxy headers split the short-code limiter bucket", async () => {
  for (const address of ["192.0.2.1", "192.0.2.2", "192.0.2.3, 127.0.0.1"]) {
    await POST(new Request("http://localhost:3000/api/auth/sign-in/invitation", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", "X-Forwarded-For": address }, body: JSON.stringify({ secret: "000000" })
    }));
    const forwarded = post.mock.calls.at(-1)![0];
    expect(forwarded.headers.get("x-forwarded-for")).toBeNull();
    expect(forwarded.headers.get("origin")).toBe("http://localhost:3000");
    expect(await forwarded.json()).toEqual({ secret: "000000" });
  }
});
it("preserves the normal email authentication request", async () => {
  const request = new Request("http://localhost:3000/api/auth/sign-in/email", { method: "POST", headers: { "X-Forwarded-For": "192.0.2.1" }, body: "{}" });
  await POST(request);
  expect(post).toHaveBeenCalledWith(request);
  expect(request.headers.get("x-forwarded-for")).toBe("192.0.2.1");
});
