import "reflect-metadata";
import { loadConfig } from "./core/config/config";
import { createPool, migrate } from "./core/database/db";
import { PageRepository } from "./modules/pages/pages.repository";
import { createApp } from "./app.module";

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
const app = createApp({ config, pages });

Bun.serve({
  port: config.port,
  fetch: app.fetch,
});

console.log(`page listening on :${config.port}`);
