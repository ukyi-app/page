import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../../../src/core/config/config";
import { ConfigService } from "../../../src/core/config/config.service";

const sample: AppConfig = {
  port: 8080, databaseUrl: "postgres://x", migrateDatabaseUrl: "postgres://x",
  adminTokenSha256: "a".repeat(64), htmlMaxBytes: 100, jsonMaxBytes: 700,
  dbConnectionTimeoutMs: 2000, dbStatementTimeoutMs: 3000, dbOperationTimeoutMs: 3500,
};

describe("ConfigService", () => {
  test("exposes config values via getters", () => {
    const c = new ConfigService(sample);
    expect(c.htmlMaxBytes).toBe(100);
    expect(c.dbOperationTimeoutMs).toBe(3500);
    expect(c.adminTokenSha256).toBe("a".repeat(64));
  });
});
