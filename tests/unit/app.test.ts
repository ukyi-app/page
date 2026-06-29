import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { AppModule } from "../../src/app.module";
import { buildApp } from "../../src/core/app-factory";
import { PAGES_REPOSITORY } from "../../src/modules/pages/pages.contract";
import type { PageMetadata, RenderedPage, RollbackPageInput, SavePageInput } from "../../src/modules/pages/pages.repository";

const adminHash = createHash("sha256").update("secret").digest("hex");
const config = {
  port: 8080,
  databaseUrl: "postgres://test",
  migrateDatabaseUrl: "postgres://test",
  adminTokenSha256: adminHash,
  htmlMaxBytes: 100,
  jsonMaxBytes: 700,
  dbConnectionTimeoutMs: 2_000,
  dbStatementTimeoutMs: 3_000,
  dbOperationTimeoutMs: 25,
};

class FakePages {
  current: RenderedPage | null = null;
  revisions: PageMetadata[] = [];
  disabled = false;
  purgeAfter: string | null = null;
  calls: string[] = [];

  async getCurrentPage(path: string) {
    this.calls.push("getCurrentPage");
    if (this.disabled) return null;
    return this.current?.path === path ? this.current : null;
  }

  async getCurrentSource(path: string) {
    this.calls.push("getCurrentSource");
    return this.current?.path === path ? this.current : null;
  }

  async getCurrentMetadata(path: string) {
    this.calls.push("getCurrentMetadata");
    const page = await this.getCurrentPage(path);
    if (!page) return null;
    const { html: _html, ...metadata } = page;
    return metadata;
  }

  async listPages() {
    this.calls.push("listPages");
    if (!this.current) return [];
    const { html: _html, ...metadata } = this.current;
    return [
      { ...metadata, disabledAt: this.disabled ? new Date(0).toISOString() : null, purgeAfter: this.purgeAfter },
    ];
  }

  async listRevisions() {
    this.calls.push("listRevisions");
    return this.revisions;
  }

  async savePage(input: SavePageInput) {
    this.calls.push("savePage");
    const meta = {
      path: input.path,
      revisionId: 1,
      contentSha256: createHash("sha256").update(input.html).digest("hex"),
      updatedAt: new Date(0).toISOString(),
    };
    this.current = { ...meta, html: input.html };
    this.revisions = [meta];
    this.disabled = false;
    this.purgeAfter = null;
    return meta;
  }

  async rollbackPage(_input: RollbackPageInput) {
    this.calls.push("rollbackPage");
    if (!this.revisions[0]) throw new Error("missing");
    this.current = { ...this.revisions[0], html: "rolled-back" };
    return this.revisions[0];
  }

  async softDeletePage(input: { path: string; purgeAfter: string }) {
    this.calls.push("softDeletePage");
    if (!this.current) throw new Error("missing");
    this.disabled = true;
    this.purgeAfter = input.purgeAfter;
    const { html: _html, ...metadata } = this.current;
    return { ...metadata, disabledAt: new Date(0).toISOString(), purgeAfter: input.purgeAfter };
  }

  async restorePage(_path: string) {
    this.calls.push("restorePage");
    if (!this.current) throw new Error("missing");
    this.disabled = false;
    this.purgeAfter = null;
    const { html: _html, ...metadata } = this.current;
    return { ...metadata, disabledAt: null, purgeAfter: null };
  }

  async purgeExpired(_now: string) {
    this.calls.push("purgeExpired");
    return 0;
  }
}

class ThrowingPages extends FakePages {
  override async getCurrentPage(): Promise<RenderedPage | null> {
    throw new Error("db unavailable");
  }

  override async savePage(): Promise<PageMetadata> {
    throw new Error("db unavailable");
  }
}

class HangingPages extends FakePages {
  override async getCurrentPage(): Promise<RenderedPage | null> {
    return new Promise(() => {});
  }
}

function request(path: string, init?: RequestInit) {
  return new Request(`https://page.test${path}`, init);
}

// 테스트 seam: buildApp을 fake repository override + skipMigration으로 감싸 Hono 앱을 반환.
async function createApp(deps: { config: typeof config; pages: FakePages }) {
  const { app } = await buildApp(AppModule, {
    config: deps.config,
    providerOverrides: [{ provide: PAGES_REPOSITORY, useValue: deps.pages }],
    skipMigration: true,
  });
  return app;
}

describe("createApp", () => {
  test("serves the chart health endpoint", async () => {
    const server = await createApp({ config, pages: new FakePages() });
    const response = await server.fetch(request("/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("rejects unauthenticated writes", async () => {
    const server = await createApp({ config, pages: new FakePages() });
    const response = await server.fetch(request("/api/pages", { method: "PUT", body: "{}" }));

    expect(response.status).toBe(401);
  });

  test("rejects every admin route without a valid bearer token before repository access", async () => {
    const cases: Array<{ path: string; init?: RequestInit }> = [
      { path: "/api/pages", init: { method: "PUT", headers: { "content-type": "application/json" }, body: "{" } },
      { path: "/api/pages?path=/demo" },
      { path: "/api/pages/list" },
      { path: "/api/pages/source?path=/demo" },
      { path: "/api/pages/revisions?path=/demo" },
      { path: "/api/pages?path=/demo", init: { method: "DELETE" } },
      { path: "/api/pages/restore", init: { method: "POST", headers: { "content-type": "application/json" }, body: "{" } },
      { path: "/api/pages/rollback", init: { method: "POST", headers: { "content-type": "application/json" }, body: "{" } },
    ];

    for (const authorization of [undefined, "Bearer wrong"]) {
      for (const candidate of cases) {
        const pages = new FakePages();
        const headers = new Headers(candidate.init?.headers);
        if (authorization) headers.set("authorization", authorization);
        const server = await createApp({ config, pages });
        const response = await server.fetch(request(candidate.path, { ...candidate.init, headers }));

        expect(response.status).toBe(401);
        expect(pages.calls).toEqual([]);
      }
    }
  });

  test("writes with admin auth and renders exact html", async () => {
    const pages = new FakePages();
    const server = await createApp({ config, pages });
    const put = await server.fetch(
      request("/api/pages", {
        method: "PUT",
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: JSON.stringify({ path: "/demo", html: "<h1>Hello</h1>" }),
      }),
    );
    const rendered = await server.fetch(request("/demo"));

    expect(put.status).toBe(200);
    expect(rendered.status).toBe(200);
    expect(await rendered.text()).toBe("<h1>Hello</h1>");
    expect(rendered.headers.get("content-security-policy")).toContain("connect-src 'none'");
  });

  test("rejects oversized html", async () => {
    const server = await createApp({ config, pages: new FakePages() });
    const response = await server.fetch(
      request("/api/pages", {
        method: "PUT",
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: JSON.stringify({ path: "/demo", html: "x".repeat(101) }),
      }),
    );

    expect(response.status).toBe(413);
  });

  test("accepts escaped HTML at the decoded HTML byte limit", async () => {
    const server = await createApp({ config, pages: new FakePages() });
    const escaped = '"'.repeat(100);
    const response = await server.fetch(
      request("/api/pages", {
        method: "PUT",
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: JSON.stringify({ path: "/escaped", html: escaped }),
      }),
    );

    expect(new TextEncoder().encode(escaped).byteLength).toBe(config.htmlMaxBytes);
    expect(response.status).toBe(200);
  });

  test("checks auth before reading an oversized body", async () => {
    const server = await createApp({ config, pages: new FakePages() });
    const response = await server.fetch(
      request("/api/pages", {
        method: "PUT",
        headers: { "content-type": "application/json", "content-length": "1000000" },
        body: "x".repeat(1_000),
      }),
    );

    expect(response.status).toBe(401);
  });

  test("rejects oversized raw JSON before parsing", async () => {
    const server = await createApp({ config, pages: new FakePages() });
    const response = await server.fetch(
      request("/api/pages", {
        method: "PUT",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
          "content-length": "1000000",
        },
        body: JSON.stringify({ path: "/demo", html: "small" }),
      }),
    );

    expect(response.status).toBe(413);
  });

  test("rejects authenticated empty admin bodies before repository access", async () => {
    const cases: Array<{ path: string; method: string }> = [
      { path: "/api/pages", method: "PUT" },
      { path: "/api/pages/rollback", method: "POST" },
    ];

    for (const candidate of cases) {
      const pages = new FakePages();
      const server = await createApp({ config, pages });
      const response = await server.fetch(
        request(candidate.path, {
          method: candidate.method,
          headers: { authorization: "Bearer secret", "content-type": "application/json" },
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "missing_body" });
      expect(pages.calls).toEqual([]);
    }
  });

  test("rejects malformed rollback bodies before repository access", async () => {
    const cases: Array<{ body: unknown; error: string }> = [
      { body: { path: "demo", revisionId: 1, expectedContentSha256: "a".repeat(64) }, error: "invalid_path" },
      { body: { path: "/demo", expectedContentSha256: "a".repeat(64) }, error: "invalid_revision_id" },
      { body: { path: "/demo", revisionId: 0, expectedContentSha256: "a".repeat(64) }, error: "invalid_revision_id" },
      { body: { path: "/demo", revisionId: 1.5, expectedContentSha256: "a".repeat(64) }, error: "invalid_revision_id" },
      { body: { path: "/demo", revisionId: 1 }, error: "invalid_expected_content_sha256" },
      { body: { path: "/demo", revisionId: 1, expectedContentSha256: "not-a-sha" }, error: "invalid_expected_content_sha256" },
    ];

    for (const candidate of cases) {
      const pages = new FakePages();
      const server = await createApp({ config, pages });
      const response = await server.fetch(
        request("/api/pages/rollback", {
          method: "POST",
          headers: { authorization: "Bearer secret", "content-type": "application/json" },
          body: JSON.stringify(candidate.body),
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: candidate.error });
      expect(pages.calls).toEqual([]);
    }
  });

  test("maps render repository failures to stable 503", async () => {
    const server = await createApp({ config, pages: new ThrowingPages() });
    const response = await server.fetch(request("/demo"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "service_unavailable" });
  });

  test("maps hanging repository calls to stable 503 before infrastructure timeout", async () => {
    const server = await createApp({ config, pages: new HangingPages() });
    const response = await server.fetch(request("/demo"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "service_unavailable" });
  });

  test("maps admin repository failures to stable 503", async () => {
    const server = await createApp({ config, pages: new ThrowingPages() });
    const response = await server.fetch(
      request("/api/pages", {
        method: "PUT",
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: JSON.stringify({ path: "/demo", html: "<h1>Hello</h1>" }),
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "service_unavailable" });
  });

  test("authed unknown admin subpath returns 405", async () => {
    const server = await createApp({ config, pages: new FakePages() });
    const r = await server.fetch(request("/api/pages/foo", { headers: { authorization: "Bearer secret" } }));
    expect(r.status).toBe(405);
  });

  test("unauthed unknown admin subpath returns 401", async () => {
    const server = await createApp({ config, pages: new FakePages() });
    expect((await server.fetch(request("/api/pages/foo"))).status).toBe(401);
  });

  test("non-GET on render path returns 405", async () => {
    const server = await createApp({ config, pages: new FakePages() });
    expect((await server.fetch(request("/demo", { method: "POST" }))).status).toBe(405);
  });

  test("non-GET on /health returns 405", async () => {
    const server = await createApp({ config, pages: new FakePages() });
    expect((await server.fetch(request("/health", { method: "POST" }))).status).toBe(405);
  });

  test("GET /api/foo (reserved) returns 404 after auth-free render path", async () => {
    const server = await createApp({ config, pages: new FakePages() });
    // /api/foo는 admin 경로가 아니므로 가드 없음 → 렌더 → 예약 → 404
    expect((await server.fetch(request("/api/foo"))).status).toBe(404);
  });

  test("lists pages including soft-deleted, and soft delete hides render/metadata but keeps source; restore re-enables", async () => {
    const pages = new FakePages();
    const server = await createApp({ config, pages });
    const auth = { authorization: "Bearer secret", "content-type": "application/json" };
    const bearer = { authorization: "Bearer secret" };

    await server.fetch(
      request("/api/pages", { method: "PUT", headers: auth, body: JSON.stringify({ path: "/demo", html: "<h1>hi</h1>" }) }),
    );
    expect((await server.fetch(request("/demo"))).status).toBe(200);

    // soft delete
    const del = await server.fetch(request("/api/pages?path=/demo", { method: "DELETE", headers: bearer }));
    expect(del.status).toBe(200);
    const delBody = (await del.json()) as { disabledAt: string | null; purgeAfter: string | null };
    expect(delBody.disabledAt).not.toBeNull();
    expect(delBody.purgeAfter).toBeTruthy();

    // 렌더·메타데이터는 가려지고, source는 원본 html 유지
    expect((await server.fetch(request("/demo"))).status).toBe(404);
    expect((await server.fetch(request("/api/pages?path=/demo", { headers: bearer }))).status).toBe(404);
    const src = await server.fetch(request("/api/pages/source?path=/demo", { headers: bearer }));
    expect(src.status).toBe(200);
    expect(((await src.json()) as { html: string }).html).toBe("<h1>hi</h1>");

    // 목록은 비활성 포함
    const list = await server.fetch(request("/api/pages/list", { headers: bearer }));
    const listBody = (await list.json()) as { pages: Array<{ disabledAt: string | null }> };
    expect(listBody.pages).toHaveLength(1);
    expect(listBody.pages[0]?.disabledAt).not.toBeNull();

    // restore → 다시 공개
    const restore = await server.fetch(
      request("/api/pages/restore", { method: "POST", headers: auth, body: JSON.stringify({ path: "/demo" }) }),
    );
    expect(restore.status).toBe(200);
    expect((await server.fetch(request("/demo"))).status).toBe(200);
  });

  test("DELETE rejects an invalid path before repository access", async () => {
    const pages = new FakePages();
    const server = await createApp({ config, pages });
    const r = await server.fetch(request("/api/pages?path=not-a-path", { method: "DELETE", headers: { authorization: "Bearer secret" } }));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid_path" });
    expect(pages.calls).toEqual([]);
  });
});
