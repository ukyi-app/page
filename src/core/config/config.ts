export type AppConfig = {
  port: number;
  databaseUrl: string;
  migrateDatabaseUrl: string;
  adminTokenSha256: string;
  htmlMaxBytes: number;
  jsonMaxBytes: number;
  dbConnectionTimeoutMs: number;
  dbStatementTimeoutMs: number;
  dbOperationTimeoutMs: number;
  /** soft delete 후 완전 삭제까지의 유예(ms). 기본 7일. loadConfig가 항상 채우며, getter가 기본값 폴백. */
  purgeGraceMs?: number;
  /** purge 스윕 주기(ms). 기본 1시간. */
  purgeSweepIntervalMs?: number;
};

const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;
const DEFAULT_PURGE_GRACE_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_PURGE_SWEEP_INTERVAL_MS = 60 * 60 * 1_000;

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  // homelab conn 핸들(db-page-conn)은 PAGE_DATABASE_URL(런타임/풀러)·PAGE_MIGRATE_DATABASE_URL(직결)로
  // 주입된다. 프리픽스 키를 우선 읽고, 로컬(.env.local)·테스트의 비프리픽스 키로 폴백한다.
  const databaseUrl = env.PAGE_DATABASE_URL || env.DATABASE_URL;
  if (!databaseUrl) throw new Error("PAGE_DATABASE_URL or DATABASE_URL is required");

  const adminTokenSha256 = env.ADMIN_TOKEN_SHA256;
  if (!adminTokenSha256 || !SHA256_HEX_RE.test(adminTokenSha256)) {
    throw new Error("ADMIN_TOKEN_SHA256 must be a 64-character hex SHA-256 digest");
  }

  const port = parsePositiveInt(env.PORT, 8080, "PORT");
  const htmlMaxBytes = parsePositiveInt(env.HTML_MAX_BYTES, 1_048_576, "HTML_MAX_BYTES");
  const jsonMaxBytes = parsePositiveInt(env.JSON_MAX_BYTES, defaultJsonMaxBytes(htmlMaxBytes), "JSON_MAX_BYTES");
  const minJsonMaxBytes = defaultJsonMaxBytes(htmlMaxBytes);
  if (jsonMaxBytes < minJsonMaxBytes) {
    throw new Error("JSON_MAX_BYTES must be at least HTML_MAX_BYTES * 6 + 16384");
  }

  const dbConnectionTimeoutMs = parsePositiveInt(env.DB_CONNECTION_TIMEOUT_MS, 2_000, "DB_CONNECTION_TIMEOUT_MS");
  const dbStatementTimeoutMs = parsePositiveInt(env.DB_STATEMENT_TIMEOUT_MS, 3_000, "DB_STATEMENT_TIMEOUT_MS");
  const dbOperationTimeoutMs = parsePositiveInt(env.DB_OPERATION_TIMEOUT_MS, 3_500, "DB_OPERATION_TIMEOUT_MS");
  if (dbOperationTimeoutMs <= dbConnectionTimeoutMs || dbOperationTimeoutMs <= dbStatementTimeoutMs) {
    throw new Error("DB_OPERATION_TIMEOUT_MS must be greater than DB_CONNECTION_TIMEOUT_MS and DB_STATEMENT_TIMEOUT_MS");
  }

  const migrateDatabaseUrl = env.PAGE_MIGRATE_DATABASE_URL || env.MIGRATE_DATABASE_URL || databaseUrl;
  if (env.NODE_ENV === "production" && migrateDatabaseUrl === databaseUrl) {
    throw new Error("MIGRATE_DATABASE_URL must differ from DATABASE_URL in production");
  }

  const purgeGraceMs = parsePositiveInt(env.PURGE_GRACE_MS, DEFAULT_PURGE_GRACE_MS, "PURGE_GRACE_MS");
  const purgeSweepIntervalMs = parsePositiveInt(
    env.PURGE_SWEEP_INTERVAL_MS,
    DEFAULT_PURGE_SWEEP_INTERVAL_MS,
    "PURGE_SWEEP_INTERVAL_MS",
  );

  return {
    port,
    databaseUrl,
    migrateDatabaseUrl,
    adminTokenSha256: adminTokenSha256.toLowerCase(),
    htmlMaxBytes,
    jsonMaxBytes,
    dbConnectionTimeoutMs,
    dbStatementTimeoutMs,
    dbOperationTimeoutMs,
    purgeGraceMs,
    purgeSweepIntervalMs,
  };
}

function defaultJsonMaxBytes(htmlMaxBytes: number): number {
  return htmlMaxBytes * 6 + 16_384;
}

function parsePositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}
