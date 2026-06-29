import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createApp } from "../../src/app.module";
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
  calls: string[] = [];

  async getCurrentPage(path: string) {
    this.calls.push("getCurrentPage");
    return this.current?.path === path ? this.current : null;
  }

  async getCurrentMetadata(path: string) {
    this.calls.push("getCurrentMetadata");
    const page = await this.getCurrentPage(path);
    if (!page) return null;
    const { html: _html, ...metadata } = page;
    return metadata;
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
    return meta;
  }

  async rollbackPage(_input: RollbackPageInput) {
    this.calls.push("rollbackPage");
    if (!this.revisions[0]) throw new Error("missing");
    this.current = { ...this.revisions[0], html: "rolled-back" };
    return this.revisions[0];
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

describe("createApp", () => {
  test("serves the chart health endpoint", async () => {
    const server = createApp({ config, pages: new FakePages() });
    const response = await server.fetch(request("/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("rejects unauthenticated writes", async () => {
    const server = createApp({ config, pages: new FakePages() });
    const response = await server.fetch(request("/api/pages", { method: "PUT", body: "{}" }));

    expect(response.status).toBe(401);
  });

  test("rejects every admin route without a valid bearer token before repository access", async () => {
    const cases: Array<{ path: string; init?: RequestInit }> = [
      { path: "/api/pages", init: { method: "PUT", headers: { "content-type": "application/json" }, body: "{" } },
      { path: "/api/pages?path=/demo" },
      { path: "/api/pages/revisions?path=/demo" },
      { path: "/api/pages/rollback", init: { method: "POST", headers: { "content-type": "application/json" }, body: "{" } },
    ];

    for (const authorization of [undefined, "Bearer wrong"]) {
      for (const candidate of cases) {
        const pages = new FakePages();
        const headers = new Headers(candidate.init?.headers);
        if (authorization) headers.set("authorization", authorization);
        const server = createApp({ config, pages });
        const response = await server.fetch(request(candidate.path, { ...candidate.init, headers }));

        expect(response.status).toBe(401);
        expect(pages.calls).toEqual([]);
      }
    }
  });

  test("writes with admin auth and renders exact html", async () => {
    const pages = new FakePages();
    const server = createApp({ config, pages });
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
    const server = createApp({ config, pages: new FakePages() });
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
    const server = createApp({ config, pages: new FakePages() });
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
    const server = createApp({ config, pages: new FakePages() });
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
    const server = createApp({ config, pages: new FakePages() });
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
      const server = createApp({ config, pages });
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
      const server = createApp({ config, pages });
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
    const server = createApp({ config, pages: new ThrowingPages() });
    const response = await server.fetch(request("/demo"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "service_unavailable" });
  });

  test("maps hanging repository calls to stable 503 before infrastructure timeout", async () => {
    const server = createApp({ config, pages: new HangingPages() });
    const response = await server.fetch(request("/demo"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "service_unavailable" });
  });

  test("maps admin repository failures to stable 503", async () => {
    const server = createApp({ config, pages: new ThrowingPages() });
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
    const server = createApp({ config, pages: new FakePages() });
    const r = await server.fetch(request("/api/pages/foo", { headers: { authorization: "Bearer secret" } }));
    expect(r.status).toBe(405);
  });

  test("unauthed unknown admin subpath returns 401", async () => {
    const server = createApp({ config, pages: new FakePages() });
    expect((await server.fetch(request("/api/pages/foo"))).status).toBe(401);
  });

  test("non-GET on render path returns 405", async () => {
    const server = createApp({ config, pages: new FakePages() });
    expect((await server.fetch(request("/demo", { method: "POST" }))).status).toBe(405);
  });

  test("non-GET on /health returns 405", async () => {
    const server = createApp({ config, pages: new FakePages() });
    expect((await server.fetch(request("/health", { method: "POST" }))).status).toBe(405);
  });

  test("GET /api/foo (reserved) returns 404 after auth-free render path", async () => {
    const server = createApp({ config, pages: new FakePages() });
    // /api/foo는 admin 경로가 아니므로 가드 없음 → 렌더 → 예약 → 404
    expect((await server.fetch(request("/api/foo"))).status).toBe(404);
  });
});
