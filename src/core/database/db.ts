import { Pool } from "pg";

export type DbTimeouts = {
  connectionTimeoutMs: number;
  statementTimeoutMs: number;
};

export function createPool(connectionString: string, timeouts: DbTimeouts): Pool {
  return new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: timeouts.connectionTimeoutMs,
    query_timeout: timeouts.statementTimeoutMs,
    statement_timeout: timeouts.statementTimeoutMs,
  });
}

const MIGRATION_LOCK_KEY = 7_621_947_031_001;

export function runtimeRoleFromDatabaseUrl(databaseUrl: string): string {
  const role = new URL(databaseUrl).username;
  if (!role) throw new Error("DATABASE_URL username is required for runtime grant generation");
  return decodeURIComponent(role);
}

function quoteIdentifier(identifier: string): string {
  if (!identifier) throw new Error("identifier is required");
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function migrate(pool: Pool, runtimeDatabaseUrl: string): Promise<void> {
  const runtimeRole = quoteIdentifier(runtimeRoleFromDatabaseUrl(runtimeDatabaseUrl));
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(`
      create table if not exists pages (
        path text primary key,
        current_revision_id bigint,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create table if not exists page_revisions (
        id bigserial primary key,
        path text not null references pages(path) on delete cascade,
        html text not null,
        content_sha256 text not null,
        created_at timestamptz not null default now(),
        unique (path, content_sha256)
      )
    `);
    await client.query(`
      do $$
      begin
        if not exists (
          select 1 from pg_constraint where conname = 'pages_current_revision_fk'
        ) then
          alter table pages
            add constraint pages_current_revision_fk
            foreign key (current_revision_id) references page_revisions(id);
        end if;
      end $$;
    `);
    await client.query(`grant usage on schema public to ${runtimeRole}`);
    await client.query(`grant select, insert, update on table pages to ${runtimeRole}`);
    await client.query(`grant select, insert on table page_revisions to ${runtimeRole}`);
    await client.query(`grant usage, select on all sequences in schema public to ${runtimeRole}`);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
