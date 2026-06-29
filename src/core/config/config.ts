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
};

const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

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

  const migrateDatabaseUrl = env.MIGRATE_DATABASE_URL || databaseUrl;
  if (env.NODE_ENV === "production" && migrateDatabaseUrl === databaseUrl) {
    throw new Error("MIGRATE_DATABASE_URL must differ from DATABASE_URL in production");
  }

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
