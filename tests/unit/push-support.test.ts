import { describe, expect, it } from "vitest";
import { pushSupportIssue } from "../../src/lib/push";
describe("push capability diagnostics", () => {
  it("explains HTTP before missing APIs caused by an insecure origin", () => {
    expect(pushSupportIssue({ secure: false, notifications: false, serviceWorker: false, pushManager: false, ios: false, standalone: false })).toContain("localhost");
  });
  it("distinguishes an embedded browser from insecure transport", () => {
    expect(pushSupportIssue({ secure: true, notifications: false, serviceWorker: true, pushManager: false, ios: false, standalone: false })).toContain("Chrome");
  });
  it("explains iOS installation before API support", () => {
    expect(pushSupportIssue({ secure: true, notifications: false, serviceWorker: true, pushManager: false, ios: true, standalone: false })).toContain("Домой");
  });
  it("allows a supported desktop browser", () => {
    expect(pushSupportIssue({ secure: true, notifications: true, serviceWorker: true, pushManager: true, ios: false, standalone: false })).toBe("");
  });
});
