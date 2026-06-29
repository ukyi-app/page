import { describe, expect, test } from "bun:test";
import { error, json } from "../../../src/core/http/responses";

describe("responses", () => {
  test("json sets native Response.json content-type and status", async () => {
    const r = json({ a: 1 }, 201);
    expect(r.status).toBe(201);
    // 구 Response.json과 동일한 content-type (Bun native)
    expect(r.headers.get("content-type")).toBe(Response.json({ a: 1 }).headers.get("content-type"));
    expect(await r.json()).toEqual({ a: 1 });
  });
  test("error wraps code + extra", async () => {
    const r = error("conflict", 409, { current: { path: "/d" } });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "conflict", current: { path: "/d" } });
  });
  test("error default has only the code", async () => {
    expect(await error("not_found", 404).json()).toEqual({ error: "not_found" });
  });
});
