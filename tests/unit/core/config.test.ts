import { describe, expect, test } from "bun:test";
import { loadConfig } from "../../../src/core/config/config";

const baseEnv = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/page",
  ADMIN_TOKEN_SHA256: "a".repeat(64),
};

describe("loadConfig", () => {
  test("loads defaults", () => {
    const config = loadConfig(baseEnv);

    expect(config.port).toBe(8080);
    expect(config.htmlMaxBytes).toBe(2_097_152);
    expect(config.jsonMaxBytes).toBe(12_599_296);
    expect(config.dbConnectionTimeoutMs).toBe(2_000);
    expect(config.dbStatementTimeoutMs).toBe(3_000);
    expect(config.dbOperationTimeoutMs).toBe(3_500);
    expect(config.databaseUrl).toBe(baseEnv.DATABASE_URL);
    expect(config.migrateDatabaseUrl).toBe(baseEnv.DATABASE_URL);
  });

  test("uses separate MIGRATE_DATABASE_URL when provided", () => {
    const config = loadConfig({
      ...baseEnv,
      MIGRATE_DATABASE_URL: "postgres://migrator:pass@localhost:5432/page",
    });

    expect(config.migrateDatabaseUrl).toContain("migrator");
  });

  test("prefers PAGE_DATABASE_URL (homelab conn handle) over DATABASE_URL", () => {
    const config = loadConfig({
      PAGE_DATABASE_URL: "postgres://pooler/page",
      DATABASE_URL: "postgres://fallback/page",
      ADMIN_TOKEN_SHA256: "a".repeat(64),
    });

    expect(config.databaseUrl).toBe("postgres://pooler/page");
  });

  test("reads PAGE_MIGRATE_DATABASE_URL for the migration url", () => {
    const config = loadConfig({
      PAGE_DATABASE_URL: "postgres://pooler/page",
      PAGE_MIGRATE_DATABASE_URL: "postgres://direct/page",
      ADMIN_TOKEN_SHA256: "a".repeat(64),
    });

    expect(config.migrateDatabaseUrl).toBe("postgres://direct/page");
  });

  test("PAGE_DATABASE_URL alone satisfies the database url (local .env.local)", () => {
    const config = loadConfig({
      PAGE_DATABASE_URL: "postgres://local/page",
      ADMIN_TOKEN_SHA256: "a".repeat(64),
    });

    expect(config.databaseUrl).toBe("postgres://local/page");
    expect(config.migrateDatabaseUrl).toBe("postgres://local/page");
  });

  test("requires separate migrator and runtime URLs in production", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        NODE_ENV: "production",
      }),
    ).toThrow("MIGRATE_DATABASE_URL must differ from DATABASE_URL in production");
  });

  test("fails closed without database url", () => {
    expect(() => loadConfig({ ADMIN_TOKEN_SHA256: "a".repeat(64) })).toThrow("DATABASE_URL");
  });

  test("fails closed without a hex sha256 admin token hash", () => {
    expect(() => loadConfig({ DATABASE_URL: baseEnv.DATABASE_URL, ADMIN_TOKEN_SHA256: "raw-token" })).toThrow(
      "ADMIN_TOKEN_SHA256",
    );
  });

  test("requires JSON_MAX_BYTES to cover worst-case encoded HTML", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        HTML_MAX_BYTES: "100",
        JSON_MAX_BYTES: "500",
      }),
    ).toThrow("JSON_MAX_BYTES must be at least HTML_MAX_BYTES * 6 + 16384");
  });

  test("requires local DB operation deadline to exceed pg timeouts", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        DB_CONNECTION_TIMEOUT_MS: "2000",
        DB_STATEMENT_TIMEOUT_MS: "3000",
        DB_OPERATION_TIMEOUT_MS: "3000",
      }),
    ).toThrow("DB_OPERATION_TIMEOUT_MS must be greater than DB_CONNECTION_TIMEOUT_MS and DB_STATEMENT_TIMEOUT_MS");
    expect(() =>
      loadConfig({
        ...baseEnv,
        DB_CONNECTION_TIMEOUT_MS: "4000",
        DB_STATEMENT_TIMEOUT_MS: "3000",
        DB_OPERATION_TIMEOUT_MS: "3500",
      }),
    ).toThrow("DB_OPERATION_TIMEOUT_MS must be greater than DB_CONNECTION_TIMEOUT_MS and DB_STATEMENT_TIMEOUT_MS");
  });
});
