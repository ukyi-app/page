import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { Hono } from "hono";
import type { Pool } from "pg";
import type { AppConfig } from "../../src/core/config/config";
import { PageRepository } from "../../src/modules/pages/pages.repository";
import { AppModule } from "../../src/app.module";
import { buildApp } from "../../src/core/app-factory";
import { PAGES_REPOSITORY } from "../../src/modules/pages/pages.contract";
import { createMigratorTestPool, createTestPool } from "./helpers";

const adminToken = "secret";
const adminHash = createHash("sha256").update(adminToken).digest("hex");

let pool: Pool;
let server: Hono;

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 8080,
    databaseUrl: "postgres://test",
    migrateDatabaseUrl: "postgres://test",
    adminTokenSha256: adminHash,
    htmlMaxBytes: 1_048_576,
    jsonMaxBytes: 6_307_840,
    dbConnectionTimeoutMs: 2_000,
    dbStatementTimeoutMs: 3_000,
    dbOperationTimeoutMs: 3_500,
    ...overrides,
  };
}

beforeEach(async () => {
  pool = await createTestPool();
  server = await createApp({
    config: testConfig(),
    pages: new PageRepository(pool),
  });
});

afterEach(async () => {
  await pool.end();
});

function req(path: string, init?: RequestInit): Request {
  return new Request(`https://page.test${path}`, init);
}

// 테스트 seam: buildApp을 실제 PageRepository override + skipMigration으로 감싸 Hono 앱을 반환.
async function createApp(deps: { config: AppConfig; pages: PageRepository }): Promise<Hono> {
  const { app } = await buildApp(AppModule, {
    config: deps.config,
    providerOverrides: [{ provide: PAGES_REPOSITORY, useValue: deps.pages }],
    skipMigration: true,
  });
  return app;
}

function adminJson(body: unknown): RequestInit {
  return {
    method: "PUT",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("server routes with Postgres", () => {
  test("rejects every admin route without a valid bearer token", async () => {
    const cases: Array<{ path: string; init?: RequestInit }> = [
      { path: "/api/pages", init: { method: "PUT", headers: { "content-type": "application/json" }, body: "{" } },
      { path: "/api/pages?path=/demo" },
      { path: "/api/pages/revisions?path=/demo" },
      { path: "/api/pages/rollback", init: { method: "POST", headers: { "content-type": "application/json" }, body: "{" } },
    ];

    for (const authorization of [undefined, "Bearer wrong"]) {
      for (const candidate of cases) {
        const headers = new Headers(candidate.init?.headers);
        if (authorization) headers.set("authorization", authorization);
        const response = await server.fetch(req(candidate.path, { ...candidate.init, headers }));

        expect(response.status).toBe(401);
      }
    }
  });

  test("creates, renders, updates, lists revisions, and rolls back", async () => {
    const create = await server.fetch(req("/api/pages", adminJson({ path: "/demo", html: "v1" })));
    const created = (await create.json()) as any;
    const update = await server.fetch(
      req(
        "/api/pages",
        adminJson({
          path: "/demo",
          html: "v2",
          expectedContentSha256: created.contentSha256,
        }),
      ),
    );
    const updated = (await update.json()) as any;

    expect(create.status).toBe(200);
    expect(update.status).toBe(200);
    expect(await (await server.fetch(req("/demo"))).text()).toBe("v2");

    const metadata = await server.fetch(
      req("/api/pages?path=/demo", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
    );
    expect(((await metadata.json()) as any).contentSha256).toBe(updated.contentSha256);

    const revisions = await server.fetch(
      req("/api/pages/revisions?path=/demo", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
    );
    expect(((await revisions.json()) as any).revisions).toHaveLength(2);

    const rollback = await server.fetch(
      req("/api/pages/rollback", {
        method: "POST",
        headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          path: "/demo",
          revisionId: created.revisionId,
          expectedContentSha256: updated.contentSha256,
        }),
      }),
    );

    expect(rollback.status).toBe(200);
    expect(await (await server.fetch(req("/demo"))).text()).toBe("v1");
  });

  test("soft delete lifecycle: list, disable, source, restore over HTTP", async () => {
    const bearer = { authorization: `Bearer ${adminToken}` };
    await server.fetch(req("/api/pages", adminJson({ path: "/demo", html: "<h1>hi</h1>" })));

    expect((await server.fetch(req("/demo"))).status).toBe(200);

    const del = await server.fetch(req("/api/pages?path=/demo", { method: "DELETE", headers: bearer }));
    expect(del.status).toBe(200);
    const delBody = (await del.json()) as { disabledAt: string | null; purgeAfter: string | null };
    expect(delBody.disabledAt).not.toBeNull();
    expect(delBody.purgeAfter).toBeTruthy();

    // 렌더·메타데이터는 404, source는 원본 유지
    expect((await server.fetch(req("/demo"))).status).toBe(404);
    expect((await server.fetch(req("/api/pages?path=/demo", { headers: bearer }))).status).toBe(404);
    const src = await server.fetch(req("/api/pages/source?path=/demo", { headers: bearer }));
    expect(src.status).toBe(200);
    expect(((await src.json()) as { html: string }).html).toBe("<h1>hi</h1>");

    // 목록은 비활성 포함
    const list = (await (await server.fetch(req("/api/pages/list", { headers: bearer }))).json()) as {
      pages: Array<{ path: string; disabledAt: string | null }>;
    };
    expect(list.pages.find((p) => p.path === "/demo")?.disabledAt).not.toBeNull();

    // restore → 다시 공개
    const restore = await server.fetch(
      req("/api/pages/restore", {
        method: "POST",
        headers: { ...bearer, "content-type": "application/json" },
        body: JSON.stringify({ path: "/demo" }),
      }),
    );
    expect(restore.status).toBe(200);
    expect(await (await server.fetch(req("/demo"))).text()).toBe("<h1>hi</h1>");
  });

  test("DELETE on a missing page returns 404", async () => {
    const del = await server.fetch(
      req("/api/pages?path=/missing", { method: "DELETE", headers: { authorization: `Bearer ${adminToken}` } }),
    );
    expect(del.status).toBe(404);
  });

  test("returns stable errors for bad requests and conflicts", async () => {
    const invalidJson = await server.fetch(
      req("/api/pages", {
        method: "PUT",
        headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(invalidJson.status).toBe(400);

    const reserved = await server.fetch(req("/api/pages", adminJson({ path: "/health", html: "bad" })));
    expect(reserved.status).toBe(400);

    const created = (await (await server.fetch(req("/api/pages", adminJson({ path: "/demo", html: "v1" })))).json()) as any;
    const conflict = await server.fetch(
      req(
        "/api/pages",
        adminJson({
          path: "/demo",
          html: "v2",
          expectedContentSha256: "0".repeat(64),
        }),
      ),
    );

    expect(created.contentSha256).toBeTruthy();
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).not.toHaveProperty("html");
  });

  test("returns stable 400 for authenticated empty admin bodies", async () => {
    const put = await server.fetch(
      req("/api/pages", {
        method: "PUT",
        headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
      }),
    );
    const rollback = await server.fetch(
      req("/api/pages/rollback", {
        method: "POST",
        headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
      }),
    );

    expect(put.status).toBe(400);
    expect(await put.json()).toEqual({ error: "missing_body" });
    expect(rollback.status).toBe(400);
    expect(await rollback.json()).toEqual({ error: "missing_body" });
  });

  test("rejects malformed rollback bodies with stable 400 errors", async () => {
    const cases: Array<{ body: unknown; error: string }> = [
      { body: { path: "demo", revisionId: 1, expectedContentSha256: "a".repeat(64) }, error: "invalid_path" },
      { body: { path: "/demo", expectedContentSha256: "a".repeat(64) }, error: "invalid_revision_id" },
      { body: { path: "/demo", revisionId: -1, expectedContentSha256: "a".repeat(64) }, error: "invalid_revision_id" },
      { body: { path: "/demo", revisionId: 1.5, expectedContentSha256: "a".repeat(64) }, error: "invalid_revision_id" },
      { body: { path: "/demo", revisionId: 1 }, error: "invalid_expected_content_sha256" },
      { body: { path: "/demo", revisionId: 1, expectedContentSha256: "not-a-sha" }, error: "invalid_expected_content_sha256" },
    ];

    for (const candidate of cases) {
      const response = await server.fetch(
        req("/api/pages/rollback", {
          method: "POST",
          headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
          body: JSON.stringify(candidate.body),
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: candidate.error });
    }
  });

  test("repeated read timeouts do not exhaust the pool", async () => {
    await pool.end();
    pool = await createTestPool({ statementTimeoutMs: 50 });
    const pages = new PageRepository(pool);
    server = await createApp({
      config: testConfig({ dbStatementTimeoutMs: 50, dbOperationTimeoutMs: 200 }),
      pages,
    });
    await pages.savePage({ path: "/blocked-read", html: "ok" });
    const migratorPool = createMigratorTestPool();
    const blocker = await migratorPool.connect();
    await blocker.query("begin");
    await blocker.query("lock table page_revisions in access exclusive mode");
    try {
      for (let i = 0; i < 8; i += 1) {
        const response = await server.fetch(req("/blocked-read"));
        expect(response.status).toBe(503);
      }
    } finally {
      await blocker.query("rollback");
      blocker.release();
      await migratorPool.end();
    }

    expect((await server.fetch(req("/health"))).status).toBe(200);
    expect(await (await server.fetch(req("/blocked-read"))).text()).toBe("ok");
  });

  test("timed-out writes roll back before returning 503", async () => {
    await pool.end();
    pool = await createTestPool({ statementTimeoutMs: 50 });
    server = await createApp({
      config: testConfig({ dbStatementTimeoutMs: 50, dbOperationTimeoutMs: 200 }),
      pages: new PageRepository(pool),
    });
    const migratorPool = createMigratorTestPool();
    try {
      await migratorPool.query(`
        create or replace function slow_page_revision_insert()
        returns trigger as $$
        begin
          perform pg_sleep(0.2);
          return new;
        end;
        $$ language plpgsql
      `);
      await migratorPool.query(`
        create trigger slow_page_revision_insert
        before insert on page_revisions
        for each row execute function slow_page_revision_insert()
      `);
    } finally {
      await migratorPool.end();
    }

    const response = await server.fetch(
      req(
        "/api/pages",
        adminJson({
          path: "/timeout-write",
          html: "slow",
        }),
      ),
    );
    expect(response.status).toBe(503);

    await new Promise((resolve) => setTimeout(resolve, 250));
    const persisted = await pool.query("select path from pages where path = $1", ["/timeout-write"]);
    expect(persisted.rowCount).toBe(0);
  });
});
