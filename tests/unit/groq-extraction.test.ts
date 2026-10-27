import { afterEach, describe, expect, it, vi } from "vitest";
import { extractWithGroq, extractionConfiguration } from "../../src/modules/documents/extractor";
const text = "Учебный документ. Аллергии не сообщались. Другие сведения не уточнялись.";
const output = { facts: [], limitations: ["Вымышленный пример"] };
const envelope = (finish_reason = "stop", content: string | null = JSON.stringify(output), refusal: string | null = null) => Response.json({ choices: [{ finish_reason, message: { content, refusal } }] });
afterEach(() => vi.unstubAllEnvs());
describe("Cloud Groq adapter", () => {
  it("uses the fixed HTTPS endpoint and strict schema, never a local runtime", async () => {
    const request: typeof fetch = async (url, init) => { expect(String(url)).toBe("https://api.groq.com/openai/v1/chat/completions"); const body = JSON.parse(String(init?.body)); expect(body.model).toBe("openai/gpt-oss-20b"); expect(body.response_format.json_schema.strict).toBe(true); expect(body.response_format.json_schema.schema.additionalProperties).toBe(false); expect(body.messages[1].content).toBe(text); expect(init?.redirect).toBe("error"); return envelope(); };
    expect(await extractWithGroq(text, "openai/gpt-oss-20b", request)).toEqual(output);
  });
  it("requires a key, supported model, explicit enable and synthetic mode", () => {
    vi.stubEnv("DOCUMENT_EXTRACTION_PROVIDER", "groq"); vi.stubEnv("DOCUMENT_EXTRACTION_ENABLED", "true"); vi.stubEnv("GROQ_API_KEY", "synthetic-test-key"); vi.stubEnv("DEMO_MODE", "true"); vi.stubEnv("GROQ_EXTRACTION_MODEL", "openai/gpt-oss-20b"); expect(extractionConfiguration().enabled).toBe(true);
    vi.stubEnv("DEMO_MODE", "false"); expect(extractionConfiguration().enabled).toBe(false); vi.stubEnv("DEMO_MODE", "true"); vi.stubEnv("GROQ_API_KEY", ""); expect(extractionConfiguration().enabled).toBe(false);
  });
  it("rejects a long document before sending, never truncates it", async () => { const request = vi.fn(); await expect(extractWithGroq("x".repeat(8001), "openai/gpt-oss-20b", request)).rejects.toMatchObject({ code: "DOCUMENT_TOO_LONG" }); expect(request).not.toHaveBeenCalled(); });
  it("handles quota, partial answers, refusals and malformed content separately", async () => {
    await expect(extractWithGroq(text, "openai/gpt-oss-20b", async () => new Response("not exposed", { status: 429 }))).rejects.toMatchObject({ code: "PROVIDER_LIMIT" });
    await expect(extractWithGroq(text, "openai/gpt-oss-20b", async () => envelope("length"))).rejects.toMatchObject({ code: "INCOMPLETE_OUTPUT" });
    await expect(extractWithGroq(text, "openai/gpt-oss-20b", async () => envelope("stop", null, "refusal"))).rejects.toMatchObject({ code: "PROVIDER_REFUSAL" });
    await expect(extractWithGroq(text, "openai/gpt-oss-20b", async () => envelope("stop", "{}"))).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
  });
});
