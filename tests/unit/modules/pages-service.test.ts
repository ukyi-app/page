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
    getCurrentMetadata: async () => null,
    listRevisions: async () => [],
    savePage: async (i) => ({ path: i.path, revisionId: 1, contentSha256: "h", updatedAt: "t" }),
    rollbackPage: async (i) => ({ path: i.path, revisionId: i.revisionId, contentSha256: "h", updatedAt: "t" }),
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
    const svc = new PagesService(repo({ savePage: async (i) => { called = true; return { path: i.path, revisionId: 9, contentSha256: "h", updatedAt: "t" }; } }), cfg());
    const out = await svc.savePage({ path: "/x", html: "h" });
    expect(called).toBe(true);
    expect(out.revisionId).toBe(9);
  });
});
