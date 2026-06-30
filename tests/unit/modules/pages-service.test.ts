import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../../../src/core/config/config";
import { ConfigService } from "../../../src/core/config/config.service";
import type { PageRepositoryContract } from "../../../src/modules/pages/pages.contract";
import { PagesService } from "../../../src/modules/pages/pages.service";

const cfg = (o: Partial<AppConfig> = {}): ConfigService =>
  new ConfigService({
    port: 8080, databaseUrl: "x", migrateDatabaseUrl: "x", adminTokenSha256: "a".repeat(64),
    htmlMaxBytes: 100, jsonMaxBytes: 700, dbConnectionTimeoutMs: 2000, dbStatementTimeoutMs: 3000,
    dbOperationTimeoutMs: 25, ...o,
  });

function repo(over: Partial<PageRepositoryContract> = {}): PageRepositoryContract {
  return {
    getCurrentPage: async () => null,
    getCurrentSource: async () => null,
    getCurrentMetadata: async () => null,
    listPages: async () => [],
    listRevisions: async () => [],
    savePage: async (i) => ({ path: i.path, revisionId: 1, contentSha256: "h", contentType: i.contentType ?? "html", updatedAt: "t" }),
    rollbackPage: async (i) => ({ path: i.path, revisionId: i.revisionId, contentSha256: "h", contentType: "html", updatedAt: "t" }),
    softDeletePage: async (i) => ({ path: i.path, revisionId: 1, contentSha256: "h", contentType: "html", updatedAt: "t", disabledAt: "t", purgeAfter: i.purgeAfter }),
    restorePage: async (p) => ({ path: p, revisionId: 1, contentSha256: "h", contentType: "html", updatedAt: "t", disabledAt: null, purgeAfter: null }),
    purgeExpired: async () => 0,
    ...over,
  };
}

describe("PagesService", () => {
  test("read times out (deadline) -> rejects", async () => {
    const svc = new PagesService(repo({ getCurrentPage: () => new Promise(() => {}) }), cfg());
    await expect(svc.getCurrentPage("/x")).rejects.toThrow();
  });
  test("read returns value within deadline", async () => {
    const svc = new PagesService(repo({ getCurrentPage: async () => null }), cfg());
    expect(await svc.getCurrentPage("/x")).toBeNull();
  });
  test("write is NOT deadline-wrapped (hanging-read-deadline does not apply)", async () => {
    let called = false;
    const svc = new PagesService(repo({ savePage: async (i) => { called = true; return { path: i.path, revisionId: 9, contentSha256: "h", contentType: i.contentType ?? "html", updatedAt: "t" }; } }), cfg());
    const out = await svc.savePage({ path: "/x", html: "h", contentType: "html" });
    expect(called).toBe(true);
    expect(out.revisionId).toBe(9);
  });
});
