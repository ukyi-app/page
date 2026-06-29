import { describe, expect, test } from "bun:test";
import { byteLength, readBoundedJson } from "../../../src/core/http/bounded-json";
import { BadRequestError, RequestTooLargeError } from "../../../src/core/http/http-errors";

function req(body: string | null, headers: Record<string, string> = {}): Request {
  return new Request("https://x.test/", { method: "PUT", body: body ?? undefined, headers });
}

describe("bounded-json", () => {
  test("byteLength counts UTF-8 bytes", () => {
    expect(byteLength('"'.repeat(100))).toBe(100);
  });
  test("parses small JSON", async () => {
    expect(await readBoundedJson(req(JSON.stringify({ a: 1 })), 1000)).toEqual({ a: 1 });
  });
  test("rejects oversized content-length before parsing", async () => {
    const r = req(JSON.stringify({ a: 1 }), { "content-length": "1000000" });
    await expect(readBoundedJson(r, 100)).rejects.toBeInstanceOf(RequestTooLargeError);
  });
  test("rejects oversized streamed body", async () => {
    await expect(readBoundedJson(req("x".repeat(200)), 100)).rejects.toBeInstanceOf(RequestTooLargeError);
  });
  test("missing body -> missing_body", async () => {
    const r = new Request("https://x.test/", { method: "PUT" });
    await expect(readBoundedJson(r, 100)).rejects.toMatchObject({ code: "missing_body" });
  });
  test("invalid json -> invalid_json", async () => {
    await expect(readBoundedJson(req("{"), 100)).rejects.toMatchObject({ code: "invalid_json" });
  });
});
