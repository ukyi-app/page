import { Pool } from "pg";
import { migrate } from "../../src/core/database/db";

export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://page_runtime:runtime@localhost:15432/page_test";
export const testMigrateDatabaseUrl =
  process.env.TEST_MIGRATE_DATABASE_URL ?? "postgres://page_migrator:migrator@localhost:15432/page_test";

const TEST_RESET_LOCK_KEY = 7_621_947_031_002;

export type TestPoolOptions = {
  statementTimeoutMs?: number;
};

export function createMigratorTestPool(): Pool {
  return new Pool({
    connectionString: testMigrateDatabaseUrl,
    connectionTimeoutMillis: 2_000,
    query_timeout: 5_000,
    statement_timeout: 5_000,
  });
}

export async function createTestPool(options: TestPoolOptions = {}): Promise<Pool> {
  assertDisposableTestDatabase(testDatabaseUrl);
  if (process.env.ALLOW_TEST_DB_RESET !== "1") {
    throw new Error("ALLOW_TEST_DB_RESET=1 is required before resetting the integration test database");
  }

  const statementTimeoutMs = options.statementTimeoutMs ?? 5_000;
  const pool = new Pool({
    connectionString: testDatabaseUrl,
    connectionTimeoutMillis: 2_000,
    query_timeout: statementTimeoutMs,
    statement_timeout: statementTimeoutMs,
  });
  const resetPool = createMigratorTestPool();
  const lockPool = new Pool({ connectionString: testDatabaseUrl, max: 1, connectionTimeoutMillis: 2_000 });
  const lockClient = await lockPool.connect();

  try {
    await lockClient.query("select pg_advisory_lock($1)", [TEST_RESET_LOCK_KEY]);
    await resetPool.query("drop schema public cascade");
    await resetPool.query("create schema public");
    await migrate(resetPool, testDatabaseUrl);
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  } finally {
    await resetPool.end();
    try {
      await lockClient.query("select pg_advisory_unlock($1)", [TEST_RESET_LOCK_KEY]);
    } finally {
      lockClient.release();
      await lockPool.end();
    }
  }
}

function assertDisposableTestDatabase(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  const migrateUrl = new URL(testMigrateDatabaseUrl);
  const database = url.pathname.replace(/^\//, "");
  const migrateDatabase = migrateUrl.pathname.replace(/^\//, "");
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(url.hostname) || !localHosts.has(migrateUrl.hostname)) {
    throw new Error(`Refusing to reset non-local database host '${url.hostname}' or '${migrateUrl.hostname}'.`);
  }
  if (database !== "page_test" || migrateDatabase !== "page_test") {
    throw new Error(`Refusing to reset non-test database '${database}' or '${migrateDatabase}'. Expected page_test.`);
  }
}
