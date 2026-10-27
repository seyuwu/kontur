import { describe, expect, it } from "vitest";
import { deploymentValues } from "../../scripts/prepare-deploy.mjs";

describe("independent deployment configuration", () => {
  it("creates independent secrets and a container-only database address", () => {
    const a = deploymentValues("http://localhost:3080"), b = deploymentValues("https://localhost");
    const database = new URL(a.DATABASE_URL);
    expect(database.hostname).toBe("postgres");
    expect(database.password).toBe(a.POSTGRES_PASSWORD);
    expect(a.POSTGRES_PASSWORD).not.toBe(b.POSTGRES_PASSWORD);
    expect(a.BETTER_AUTH_SECRET).not.toBe(b.BETTER_AUTH_SECRET);
    expect(a.DEPLOY_BIND).toBe("127.0.0.1");
    expect(a.ALERT_EMAIL_ENABLED).toBe("false");
    expect(a.WEB_PUSH_ENABLED).toBe("false");
    expect(a.DOCUMENT_EXTRACTION_ENABLED).toBe("false");
  });
  it("keeps the auth and request origin consistent for HTTPS", () => {
    const c = deploymentValues("https://demo.example.org");
    expect(c.APP_ORIGIN).toBe(c.BETTER_AUTH_URL);
    expect(c.SITE_ADDRESS).toBe("demo.example.org");
  });
  it.each(["http://example.org", "http://localhost:3000", "https://u:p@example.org", "https://example.org/patient", "https://example.org?key=secret", "https://example.org/", "https://example.org:8443"])("rejects an inconsistent or unsafe proxy origin: %s", address => {
    expect(() => deploymentValues(address)).toThrow();
  });
});
