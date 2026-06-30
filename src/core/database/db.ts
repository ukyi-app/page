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
    // content_type: 저장 콘텐츠의 타입('html' | 'markdown'). 기존 행은 'html'로 채운다.
    await client.query("alter table page_revisions add column if not exists content_type text not null default 'html'");
    // rendered_html: 서빙용으로 미리 렌더한 HTML(마크다운만 채움; html 타입은 null이라 html 컬럼을 그대로 서빙).
    // 렌더를 저장 시점 1회로 옮겨, 공개 렌더 경로를 HTML과 동일한 정적 서빙(파싱 없음)으로 유지한다.
    await client.query("alter table page_revisions add column if not exists rendered_html text");
    // dedup 키에 content_type을 포함해, 동일 바이트라도 타입이 다르면 별개 리비전으로 보존한다.
    // (예: html "hello" → markdown "hello" 전환을 누락 없이 새 리비전으로 만든다.)
    await client.query(`
      do $$
      begin
        if not exists (
          select 1 from pg_constraint where conname = 'page_revisions_content_dedup_key'
        ) then
          alter table page_revisions
            add constraint page_revisions_content_dedup_key
            unique (path, content_sha256, content_type);
        end if;
      end $$;
    `);
    // content_type 도입 전의 2열 unique는 복합 unique로 대체한다(없으면 no-op).
    await client.query("alter table page_revisions drop constraint if exists page_revisions_path_content_sha256_key");
    // soft delete: disabled_at(비활성 시각, null=활성), purge_after(이 시각 이후 완전 삭제 대상).
    await client.query("alter table pages add column if not exists disabled_at timestamptz");
    await client.query("alter table pages add column if not exists purge_after timestamptz");
    await client.query(`
      create index if not exists pages_purge_after_idx
      on pages (purge_after)
      where purge_after is not null
    `);
    await client.query(`grant usage on schema public to ${runtimeRole}`);
    // update: soft delete/restore(disabled_at·purge_after) 갱신. delete: purge 스윕(리비전은 cascade).
    await client.query(`grant select, insert, update, delete on table pages to ${runtimeRole}`);
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
