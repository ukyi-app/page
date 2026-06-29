import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createServer } from "../../src/server"; // 구 (크로스오버 전까지 존재)
import { createApp } from "../../src/app.module"; // 신
import { PageConflictError as OldPageConflictError } from "../../src/pageRepository"; // 구 모듈 에러
import { PageConflictError as NewPageConflictError } from "../../src/modules/pages/pages.repository"; // 신 모듈 에러
import type {
  PageMetadata, RenderedPage, RollbackPageInput, SavePageInput,
} from "../../src/modules/pages/pages.repository";

const adminHash = createHash("sha256").update("secret").digest("hex");
const config = {
  port: 8080, databaseUrl: "postgres://test", migrateDatabaseUrl: "postgres://test",
  adminTokenSha256: adminHash, htmlMaxBytes: 100, jsonMaxBytes: 700,
  dbConnectionTimeoutMs: 2_000, dbStatementTimeoutMs: 3_000, dbOperationTimeoutMs: 25,
};

// 구 server.test.ts의 FakePages와 동일 (구 Pages·신 PageRepositoryContract 둘 다 구조적으로 만족)
class FakePages {
  current: RenderedPage | null = null;
  revisions: PageMetadata[] = [];
  async getCurrentPage(path: string) { return this.current?.path === path ? this.current : null; }
  async getCurrentMetadata(path: string) {
    const page = await this.getCurrentPage(path);
    if (!page) return null;
    const { html: _html, ...meta } = page;
    return meta;
  }
  async listRevisions() { return this.revisions; }
  async savePage(input: SavePageInput) {
    const meta = { path: input.path, revisionId: 1, contentSha256: createHash("sha256").update(input.html).digest("hex"), updatedAt: new Date(0).toISOString() };
    this.current = { ...meta, html: input.html }; this.revisions = [meta]; return meta;
  }
  async rollbackPage(_i: RollbackPageInput) { if (!this.revisions[0]) throw new Error("missing"); this.current = { ...this.revisions[0], html: "rb" }; return this.revisions[0]; }
}

const conflictCurrent: PageMetadata = {
  path: "/demo", revisionId: 2, contentSha256: "a".repeat(64), updatedAt: new Date(0).toISOString(),
};
// 충돌은 구·신이 각자 모듈의 PageConflictError를 instanceof로 판별하므로 앱별 전용 fake를 주입한다.
class OldConflictPages extends FakePages {
  override async savePage(): Promise<PageMetadata> { throw new OldPageConflictError("c", conflictCurrent); }
}
class NewConflictPages extends FakePages {
  override async savePage(): Promise<PageMetadata> { throw new NewPageConflictError("c", conflictCurrent); }
}

type Probe = {
  name: string;
  path: string;
  init?: RequestInit;
  seed?: (p: FakePages) => void;
  makeOld?: () => FakePages;
  makeNew?: () => FakePages;
};

const auth = { authorization: "Bearer secret" };
const jsonAuth = { ...auth, "content-type": "application/json" };
const seedCurrent = (p: FakePages) => {
  p.current = { path: "/demo", revisionId: 1, contentSha256: "h", updatedAt: new Date(0).toISOString(), html: "<h1>Hi</h1>" };
};
const seedRevisions = (p: FakePages) => {
  p.revisions = [{ path: "/demo", revisionId: 1, contentSha256: "a".repeat(64), updatedAt: new Date(0).toISOString() }];
};

const probes: Probe[] = [
  // --- 실패/라우팅 ---
  { name: "health GET", path: "/health" },
  { name: "health POST", path: "/health", init: { method: "POST" } },
  { name: "health OPTIONS", path: "/health", init: { method: "OPTIONS" } },
  { name: "health HEAD", path: "/health", init: { method: "HEAD" } },
  { name: "meta unauth", path: "/api/pages?path=/demo" },
  { name: "put unauth", path: "/api/pages", init: { method: "PUT", body: "{}" } },
  { name: "put invalid json", path: "/api/pages", init: { method: "PUT", headers: jsonAuth, body: "{" } },
  { name: "put missing body", path: "/api/pages", init: { method: "PUT", headers: jsonAuth } },
  { name: "put invalid path", path: "/api/pages", init: { method: "PUT", headers: jsonAuth, body: JSON.stringify({ path: "demo", html: "x" }) } },
  { name: "put oversized html", path: "/api/pages", init: { method: "PUT", headers: jsonAuth, body: JSON.stringify({ path: "/demo", html: "x".repeat(101) }) } },
  { name: "admin unknown subpath auth", path: "/api/pages/foo", init: { headers: auth } },
  { name: "admin unknown subpath unauth", path: "/api/pages/foo" },
  { name: "admin wrong method auth", path: "/api/pages", init: { method: "DELETE", headers: auth } },
  { name: "rollback bad body", path: "/api/pages/rollback", init: { method: "POST", headers: jsonAuth, body: JSON.stringify({ path: "/demo", revisionId: 0, expectedContentSha256: "a".repeat(64) }) } },
  // --- 성공 admin (인증 쓰기/읽기 API 바디·헤더 패리티) ---
  { name: "save new ok", path: "/api/pages", init: { method: "PUT", headers: jsonAuth, body: JSON.stringify({ path: "/demo", html: "<h1>v1</h1>" }) } },
  { name: "metadata ok", path: "/api/pages?path=/demo", init: { headers: auth }, seed: seedCurrent },
  { name: "revisions ok", path: "/api/pages/revisions?path=/demo", init: { headers: auth }, seed: seedRevisions },
  { name: "rollback ok", path: "/api/pages/rollback", init: { method: "POST", headers: jsonAuth, body: JSON.stringify({ path: "/demo", revisionId: 1, expectedContentSha256: "a".repeat(64) }) }, seed: seedRevisions },
  // --- 충돌 (409 conflict + current 직렬화) ---
  { name: "conflict save", path: "/api/pages", init: { method: "PUT", headers: jsonAuth, body: JSON.stringify({ path: "/demo", html: "x", expectedContentSha256: "b".repeat(64) }) }, makeOld: () => new OldConflictPages(), makeNew: () => new NewConflictPages() },
  // --- 렌더 ---
  { name: "render existing", path: "/demo", seed: seedCurrent },
  { name: "render missing", path: "/missing" },
  { name: "render POST", path: "/demo", init: { method: "POST" } },
  { name: "render invalid path", path: "/Bad_PATH" },
  { name: "reserved api GET", path: "/api/foo" },
  { name: "reserved api POST", path: "/api/foo", init: { method: "POST" } },
];

// 휘발성 헤더만 제외하고 전체 헤더 맵을 정규화 비교 → 예상치 못한 헤더 추가/누락/변경까지 차단.
// (신 응답은 native Response.json/Response이므로 구와 전체 헤더가 일치해야 한다.)
const VOLATILE = new Set(["date"]);
function headerMap(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of res.headers) {
    const key = k.toLowerCase();
    if (!VOLATILE.has(key)) out[key] = v;
  }
  return out;
}

describe("contract parity: old createServer vs new createApp", () => {
  for (const probe of probes) {
    test(probe.name, async () => {
      const build = (factory?: () => FakePages): FakePages => {
        if (factory) return factory();
        const p = new FakePages();
        probe.seed?.(p);
        return p;
      };
      const oldApp = createServer({ config, pages: build(probe.makeOld) });
      const newApp = createApp({ config, pages: build(probe.makeNew) });
      const url = `https://page.test${probe.path}`;
      const oldRes = await oldApp.fetch(new Request(url, probe.init));
      const newRes = await newApp.fetch(new Request(url, probe.init));
      expect(newRes.status).toBe(oldRes.status);
      expect(await newRes.text()).toBe(await oldRes.text());
      // 전체 헤더 맵 동치(휘발성 제외). 불일치 = 외부 관측 가능한 드리프트 → 신 코드를 구와 일치하도록 수정.
      expect(headerMap(newRes)).toEqual(headerMap(oldRes));
    });
  }
});
