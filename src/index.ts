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
  ready: async () => {
    try {
      await runtimePool.query(`
        select p.path
        from pages p
        left join page_revisions r on r.id = p.current_revision_id
        limit 1
      `);
      return true;
    } catch {
      return false;
    }
  },
});

Bun.serve({
  port: config.port,
  fetch: server.fetch,
});

console.log(`page listening on :${config.port}`);
