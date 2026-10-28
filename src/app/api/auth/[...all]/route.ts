import { auth } from "@/server/auth";
import { toNextJsHandler } from "better-auth/next-js";
const handlers = toNextJsHandler(auth);
export const GET = handlers.GET;
export async function POST(request: Request) {
  if (new URL(request.url).pathname === "/api/auth/sign-in/invitation") {
    // Short codes share a limiter bucket so spoofed proxy headers cannot bypass it.
    const headers = new Headers(request.headers);
    headers.delete("x-forwarded-for");
    request = new Request(request, { headers });
  }
  return handlers.POST(request);
}
