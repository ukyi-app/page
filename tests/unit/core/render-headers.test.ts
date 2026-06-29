import { describe, expect, test } from "bun:test";
import { renderHeaders } from "../../../src/core/render/render-headers";

describe("renderHeaders", () => {
  test("uses a network-closed sandbox CSP", () => {
    const headers = renderHeaders();
    const csp = headers.get("content-security-policy") || "";

    expect(headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("worker-src 'none'");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).not.toContain("allow-top-navigation");
  });
});
