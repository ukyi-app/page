import { loadConfig } from "./config";
import { createPool, migrate } from "./db";
import { PageRepository } from "./pageRepository";
import { createServer } from "./server";

const config = loadConfig();
const dbTimeouts = {
  connectionTimeoutMs: config.dbConnectionTimeoutMs,
  statementTimeoutMs: config.dbStatementTimeoutMs,
};
const runtimePool = createPool(config.databaseUrl, dbTimeouts);
const migrationPool = createPool(config.migrateDatabaseUrl, dbTimeouts);

await migrate(migrationPool, config.databaseUrl);
await migrationPool.end();

const pages = new PageRepository(runtimePool);
const server = createServer({
  config,
  pages,
});

Bun.serve({
  port: config.port,
  fetch: server.fetch,
});

console.log(`page listening on :${config.port}`);
