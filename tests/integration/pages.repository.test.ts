import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { migrate } from "../../src/core/database/db";
import { PageConflictError, PageNotFoundError, PageRepository } from "../../src/modules/pages/pages.repository";
import { createMigratorTestPool, createTestPool, testDatabaseUrl } from "./helpers";

let pool: Pool;
let repo: PageRepository;

beforeEach(async () => {
  pool = await createTestPool();
  repo = new PageRepository(pool);
});

afterEach(async () => {
  await pool.end();
});

describe("PageRepository", () => {
  test("migration is idempotent", async () => {
    const migratorPool = createMigratorTestPool();
    try {
      await migrate(migratorPool, testDatabaseUrl);
      await migrate(migratorPool, testDatabaseUrl);
    } finally {
      await migratorPool.end();
    }
    const result = await pool.query("select to_regclass('public.pages') as pages");

    expect(result.rows[0].pages).toBe("pages");
  });

  test("concurrent migrations serialize and remain idempotent", async () => {
    const migratorPool = createMigratorTestPool();
    try {
      await Promise.all([
        migrate(migratorPool, testDatabaseUrl),
        migrate(migratorPool, testDatabaseUrl),
        migrate(migratorPool, testDatabaseUrl),
      ]);
    } finally {
      await migratorPool.end();
    }
    const result = await pool.query("select to_regclass('public.page_revisions') as revisions");

    expect(result.rows[0].revisions).toBe("page_revisions");
  });

  test("creates and renders a page", async () => {
    const saved = await repo.savePage({ path: "/demo", html: "<h1>Hello</h1>" });
    const current = await repo.getCurrentPage("/demo");

    expect(saved.path).toBe("/demo");
    expect(saved.revisionId).toBeGreaterThan(0);
    expect(current?.html).toBe("<h1>Hello</h1>");
    expect(current?.contentSha256).toBe(saved.contentSha256);
  });

  test("requires expected hash when updating an existing page", async () => {
    await repo.savePage({ path: "/demo", html: "v1" });

    await expect(repo.savePage({ path: "/demo", html: "v2" })).rejects.toBeInstanceOf(PageConflictError);
  });

  test("updates with matching expected hash and keeps history", async () => {
    const first = await repo.savePage({ path: "/demo", html: "v1" });
    const second = await repo.savePage({ path: "/demo", html: "v2", expectedContentSha256: first.contentSha256 });
    const revisions = await repo.listRevisions("/demo", 10);

    expect(second.contentSha256).not.toBe(first.contentSha256);
    expect(revisions.map((r) => r.revisionId)).toEqual([second.revisionId, first.revisionId]);
  });

  test("retries same update as success after ambiguous response loss", async () => {
    const first = await repo.savePage({ path: "/demo", html: "v1" });
    const second = await repo.savePage({ path: "/demo", html: "v2", expectedContentSha256: first.contentSha256 });
    const retry = await repo.savePage({ path: "/demo", html: "v2", expectedContentSha256: first.contentSha256 });

    expect(retry).toEqual(second);
  });

  test("rolls back with matching expected hash", async () => {
    const first = await repo.savePage({ path: "/demo", html: "v1" });
    const second = await repo.savePage({ path: "/demo", html: "v2", expectedContentSha256: first.contentSha256 });

    const rolledBack = await repo.rollbackPage({
      path: "/demo",
      revisionId: first.revisionId,
      expectedContentSha256: second.contentSha256,
    });

    expect(rolledBack.revisionId).toBe(first.revisionId);
    expect((await repo.getCurrentPage("/demo"))?.html).toBe("v1");
  });

  test("retries same rollback as success after ambiguous response loss", async () => {
    const first = await repo.savePage({ path: "/demo", html: "v1" });
    const second = await repo.savePage({ path: "/demo", html: "v2", expectedContentSha256: first.contentSha256 });
    const rolledBack = await repo.rollbackPage({
      path: "/demo",
      revisionId: first.revisionId,
      expectedContentSha256: second.contentSha256,
    });
    const retry = await repo.rollbackPage({
      path: "/demo",
      revisionId: first.revisionId,
      expectedContentSha256: second.contentSha256,
    });

    expect(retry).toEqual(rolledBack);
  });

  test("runtime role may delete pages (purge) but cannot delete revisions directly or run DDL", async () => {
    const saved = await repo.savePage({ path: "/runtime-grant", html: "ok" });
    expect(saved.contentSha256).toBeTruthy();

    // page_revisions 직접 삭제 권한 없음(cascade로만 삭제됨). DDL도 불가.
    await expect(pool.query("delete from page_revisions")).rejects.toThrow();
    await expect(pool.query("create table forbidden_runtime_ddl(id int)")).rejects.toThrow();

    // purge 스윕을 위해 pages 삭제는 허용되고, 리비전은 FK cascade로 함께 사라진다.
    await pool.query("delete from pages where path = $1", ["/runtime-grant"]);
    const revs = await pool.query("select 1 from page_revisions where path = $1", ["/runtime-grant"]);
    expect(revs.rowCount).toBe(0);
  });

  test("soft delete hides render but keeps source; listPages reports it; restore re-enables", async () => {
    await repo.savePage({ path: "/demo", html: "<h1>hi</h1>" });
    const purgeAfter = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const deleted = await repo.softDeletePage({ path: "/demo", purgeAfter });
    expect(deleted.disabledAt).not.toBeNull();
    expect(deleted.purgeAfter).toBeTruthy();
    expect(await repo.getCurrentPage("/demo")).toBeNull();
    expect((await repo.getCurrentSource("/demo"))?.html).toBe("<h1>hi</h1>");

    const list = await repo.listPages();
    expect(list).toHaveLength(1);
    expect(list[0]?.disabledAt).not.toBeNull();

    const restored = await repo.restorePage("/demo");
    expect(restored.disabledAt).toBeNull();
    expect((await repo.getCurrentPage("/demo"))?.html).toBe("<h1>hi</h1>");
  });

  test("soft delete on a missing page throws PageNotFoundError", async () => {
    await expect(
      repo.softDeletePage({ path: "/nope", purgeAfter: new Date().toISOString() }),
    ).rejects.toBeInstanceOf(PageNotFoundError);
  });

  test("saving re-activates a disabled page (new content and identical content)", async () => {
    const first = await repo.savePage({ path: "/demo", html: "v1" });
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await repo.softDeletePage({ path: "/demo", purgeAfter: future });
    expect(await repo.getCurrentPage("/demo")).toBeNull();

    // 동일 콘텐츠 재저장(expected 없이) → conflict 없이 재활성화
    const again = await repo.savePage({ path: "/demo", html: "v1" });
    expect(again.contentSha256).toBe(first.contentSha256);
    expect(await repo.getCurrentPage("/demo")).not.toBeNull();

    // 다시 비활성화 후 새 콘텐츠 저장 → 재활성화
    await repo.softDeletePage({ path: "/demo", purgeAfter: future });
    await repo.savePage({ path: "/demo", html: "v2", expectedContentSha256: first.contentSha256 });
    expect((await repo.getCurrentPage("/demo"))?.html).toBe("v2");
  });

  test("purgeExpired hard-deletes only pages past purge_after, cascading revisions", async () => {
    await repo.savePage({ path: "/keep-active", html: "a" });
    await repo.savePage({ path: "/keep-disabled", html: "b" });
    await repo.savePage({ path: "/purge-me", html: "c" });
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 1000).toISOString();
    await repo.softDeletePage({ path: "/keep-disabled", purgeAfter: future });
    await repo.softDeletePage({ path: "/purge-me", purgeAfter: past });

    const removed = await repo.purgeExpired(new Date().toISOString());
    expect(removed).toBe(1);

    // purge된 페이지는 리비전까지 cascade 삭제
    expect((await pool.query("select 1 from page_revisions where path = $1", ["/purge-me"])).rowCount).toBe(0);
    // 활성·미만료 비활성은 보존
    expect(await repo.getCurrentPage("/keep-active")).not.toBeNull();
    expect((await repo.getCurrentSource("/keep-disabled"))?.html).toBe("b");
  });
});
