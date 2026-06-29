import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { ConfigService } from "../../../src/core/config/config.service";
import { AuthGuard } from "../../../src/core/auth/auth.guard";

const hash = createHash("sha256").update("secret").digest("hex");
const cfg = new ConfigService({
  port: 8080, databaseUrl: "x", migrateDatabaseUrl: "x", adminTokenSha256: hash,
  htmlMaxBytes: 100, jsonMaxBytes: 700, dbConnectionTimeoutMs: 2000, dbStatementTimeoutMs: 3000, dbOperationTimeoutMs: 25,
});

function app() {
  const guard = new AuthGuard(cfg);
  const a = new Hono();
  a.use("/p", (c, n) => guard.handle(c, n));
  a.get("/p", (c) => c.json({ ok: true }));
  return a;
}

describe("AuthGuard", () => {
  test("401 without bearer (native body + content-type)", async () => {
    const r = await app().fetch(new Request("https://x.test/p"));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "unauthorized" });
    // native Response.json content-type (c.json 드리프트 방지 — byte-identical)
    expect(r.headers.get("content-type")).toBe(Response.json({}).headers.get("content-type"));
  });
  test("401 with wrong token", async () => {
    expect((await app().fetch(new Request("https://x.test/p", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
  });
  test("passes with correct token", async () => {
    const r = await app().fetch(new Request("https://x.test/p", { headers: { authorization: "Bearer secret" } }));
    expect(await r.json()).toEqual({ ok: true });
  });
});
