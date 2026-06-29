import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Context } from "hono";
import { container } from "tsyringe";
import { Controller, Get, Post, Put, UseGuard, type CanActivate } from "../../../src/core/http/decorators";
import { RouterFactory } from "../../../src/core/http/router.factory";

class DenyUnlessHeader implements CanActivate {
  handle = async (c: Context, next: () => Promise<void>) => {
    if (c.req.header("x-ok") !== "1") return c.json({ error: "unauthorized" }, 401);
    await next();
  };
}

@Controller("/api/pages")
@UseGuard(DenyUnlessHeader)
class AdminCtrl {
  @Put("") save(c: Context) { return c.json({ ok: "save" }); }
  @Get("") meta(c: Context) { return c.json({ ok: "meta" }); }
  @Get("/revisions") revs(c: Context) { return c.json({ ok: "revs" }); }
  @Post("/rollback") rollback(c: Context) { return c.json({ ok: "rollback" }); }
}

@Controller("")
class HealthCtrl {
  @Get("/health") health(c: Context) { return c.json({ ok: true }); }
}

@Controller("")
class RenderCtrl {
  @Get("*") render(c: Context) { return c.json({ rendered: c.req.path }); }
}

function build(): Hono {
  const child = container.createChildContainer();
  const app = new Hono();
  RouterFactory.register(app, [child.resolve(AdminCtrl), child.resolve(HealthCtrl), child.resolve(RenderCtrl)], child);
  return app;
}
function reqOf(path: string, method = "GET", headers: Record<string, string> = {}) {
  return new Request(`https://x.test${path}`, { method, headers });
}

describe("RouterFactory ordering invariants", () => {
  test("guard runs before admin handlers (401 without header)", async () => {
    const r = await build().fetch(reqOf("/api/pages", "PUT"));
    expect(r.status).toBe(401);
  });
  test("admin exact routes win over render wildcard (with auth)", async () => {
    const r = await build().fetch(reqOf("/api/pages", "GET", { "x-ok": "1" }));
    expect(await r.json()).toEqual({ ok: "meta" });
  });
  test("authed unknown admin subpath -> 405 (not render 404)", async () => {
    const r = await build().fetch(reqOf("/api/pages/foo", "GET", { "x-ok": "1" }));
    expect(r.status).toBe(405);
    expect(await r.json()).toEqual({ error: "method_not_allowed" });
  });
  test("unauthed unknown admin subpath -> 401 (guard first)", async () => {
    const r = await build().fetch(reqOf("/api/pages/foo", "GET"));
    expect(r.status).toBe(401);
  });
  test("authed wrong method on exact admin path -> 405", async () => {
    const r = await build().fetch(reqOf("/api/pages/rollback", "GET", { "x-ok": "1" }));
    expect(r.status).toBe(405);
  });
  test("GET /health -> handler", async () => {
    expect(await (await build().fetch(reqOf("/health"))).json()).toEqual({ ok: true });
  });
  test("non-GET /health -> 405", async () => {
    expect((await build().fetch(reqOf("/health", "POST"))).status).toBe(405);
  });
  test("GET arbitrary path -> render wildcard", async () => {
    expect(await (await build().fetch(reqOf("/demo"))).json()).toEqual({ rendered: "/demo" });
  });
  test("non-GET arbitrary path -> 405 (global fallback)", async () => {
    expect((await build().fetch(reqOf("/demo", "POST"))).status).toBe(405);
  });
});
