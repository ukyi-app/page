import { describe, expect, test } from "bun:test";
import { canonicalizePagePath, isReservedPath } from "../../src/path";

describe("canonicalizePagePath", () => {
  test.each([
    ["/demo", "/demo"],
    ["/demo/page-1", "/demo/page-1"],
    ["/demo_page", "/demo_page"],
  ])("accepts %s", (input, expected) => {
    expect(canonicalizePagePath(input)).toBe(expected);
  });

  test.each(["", "/", "demo", "/API", "/a//b", "/a/../b", "/a?x=1", "/a#x", "/한글", "/a%2fb", "/a/"])(
    "rejects %s",
    (input) => {
      expect(() => canonicalizePagePath(input)).toThrow();
    },
  );

  test.each(["/api", "/api/pages", "/healthz", "/readyz", "/metrics", "/favicon.ico", "/robots.txt"])(
    "marks %s as reserved",
    (path) => {
      expect(isReservedPath(path)).toBe(true);
    },
  );
});
