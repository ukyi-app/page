import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { migrate } from "../../src/core/database/db";
import { PageConflictError, PageRepository } from "../../src/modules/pages/pages.repository";
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

  test("runtime role can write pages but cannot delete rows or run DDL", async () => {
    const saved = await repo.savePage({ path: "/runtime-grant", html: "ok" });

    expect(saved.contentSha256).toBeTruthy();
    await expect(pool.query("delete from page_revisions")).rejects.toThrow();
    await expect(pool.query("delete from pages")).rejects.toThrow();
    await expect(pool.query("create table forbidden_runtime_ddl(id int)")).rejects.toThrow();
  });
});
