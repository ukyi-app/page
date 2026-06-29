import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { registerExceptionFilter } from "../../../src/core/http/exception.filter";
import { BadRequestError, RequestTooLargeError } from "../../../src/core/http/http-errors";
import { PageConflictError, PageNotFoundError } from "../../../src/modules/pages/pages.repository";

function appThrowing(err: unknown) {
  const a = new Hono();
  registerExceptionFilter(a);
  a.get("/x", () => { throw err; });
  return a;
}
const get = (a: Hono) => a.fetch(new Request("https://x.test/x"));

describe("exception filter", () => {
  test("RequestTooLargeError -> 413 payload_too_large", async () => {
    const r = await get(appThrowing(new RequestTooLargeError()));
    expect(r.status).toBe(413);
    expect(await r.json()).toEqual({ error: "payload_too_large" });
  });
  test("BadRequestError -> 400 with code", async () => {
    const r = await get(appThrowing(new BadRequestError("invalid_path")));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid_path" });
  });
  test("PageConflictError with current -> 409 conflict + stripped metadata (no html)", async () => {
    const current = { path: "/d", revisionId: 2, contentSha256: "h", updatedAt: "t" };
    const r = await get(appThrowing(new PageConflictError("c", current as any)));
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body).toEqual({ error: "conflict", current });
    expect(body.current).not.toHaveProperty("html");
  });
  test("PageConflictError without current -> 409 conflict only", async () => {
    const r = await get(appThrowing(new PageConflictError("c")));
    expect(await r.json()).toEqual({ error: "conflict" });
  });
  test("PageNotFoundError -> 404 not_found", async () => {
    const r = await get(appThrowing(new PageNotFoundError("x")));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "not_found" });
  });
  test("unknown error -> 503 service_unavailable", async () => {
    const r = await get(appThrowing(new Error("db down")));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "service_unavailable" });
  });
});
