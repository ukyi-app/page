import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { verifyBearerToken } from "../../../src/core/auth/auth-token";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

describe("verifyBearerToken", () => {
  test("accepts matching bearer token", async () => {
    const request = new Request("https://example.test/api/pages", {
      headers: { authorization: "Bearer secret" },
    });

    expect(await verifyBearerToken(request, digest("secret"))).toBe(true);
  });

  test.each([null, "", "Basic abc", "Bearer wrong"])("rejects invalid auth %s", async (header) => {
    const headers = new Headers();
    if (header != null) headers.set("authorization", header);
    const request = new Request("https://example.test/api/pages", { headers });

    expect(await verifyBearerToken(request, digest("secret"))).toBe(false);
  });
});
