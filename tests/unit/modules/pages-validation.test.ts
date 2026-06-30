import { describe, expect, test } from "bun:test";
import {
  asRecord, parseContentType, parseExpectedContentSha256, parsePath,
  parsePositiveRevisionId, parseRequiredExpectedContentSha256,
} from "../../../src/modules/pages/pages.validation";

describe("pages.validation", () => {
  test("parsePath rejects non-canonical -> invalid_path", () => {
    expect(() => parsePath("demo")).toThrow();
    try { parsePath("demo"); } catch (e: any) { expect(e.code).toBe("invalid_path"); }
    expect(parsePath("/demo")).toBe("/demo");
  });
  test("asRecord rejects arrays/null -> invalid_body", () => {
    for (const v of [null, [], "x", 1]) {
      try { asRecord(v); throw new Error("no throw"); } catch (e: any) { expect(e.code).toBe("invalid_body"); }
    }
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
  });
  test("revisionId must be positive integer", () => {
    for (const v of [0, -1, 1.5, "1", undefined]) {
      try { parsePositiveRevisionId(v); throw new Error("no throw"); } catch (e: any) { expect(e.code).toBe("invalid_revision_id"); }
    }
    expect(parsePositiveRevisionId(3)).toBe(3);
  });
  test("parseContentType defaults to html and rejects unknown values", () => {
    expect(parseContentType(undefined)).toBe("html");
    expect(parseContentType(null)).toBe("html");
    expect(parseContentType("html")).toBe("html");
    expect(parseContentType("markdown")).toBe("markdown");
    for (const v of ["md", "HTML", "text", 1, {}, true]) {
      try { parseContentType(v); throw new Error("no throw"); } catch (e: any) { expect(e.code).toBe("invalid_content_type"); }
    }
  });
  test("expectedContentSha256 optional vs required", () => {
    expect(parseExpectedContentSha256(undefined)).toBeUndefined();
    try { parseRequiredExpectedContentSha256(undefined); throw new Error("no throw"); } catch (e: any) { expect(e.code).toBe("invalid_expected_content_sha256"); }
    expect(parseExpectedContentSha256("A".repeat(64))).toBe("a".repeat(64));
    try { parseExpectedContentSha256("not-a-sha"); throw new Error("no throw"); } catch (e: any) { expect(e.code).toBe("invalid_expected_content_sha256"); }
  });
});
