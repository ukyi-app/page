import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { Inject, Service } from "../../core/di/decorators";
import { PG_POOL } from "../../core/database/database.tokens";

export type PageMetadata = {
  path: string;
  revisionId: number;
  contentSha256: string;
  updatedAt: string;
};

export type RenderedPage = PageMetadata & {
  html: string;
};

export type SavePageInput = {
  path: string;
  html: string;
  expectedContentSha256?: string;
};

export type RollbackPageInput = {
  path: string;
  revisionId: number;
  expectedContentSha256: string;
};

export class PageConflictError extends Error {
  constructor(message: string, public readonly current?: PageMetadata) {
    super(message);
  }
}

export class PageNotFoundError extends Error {}

@Service()
export class PageRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async getCurrentPage(path: string): Promise<RenderedPage | null> {
    const result = await this.pool.query(
      `
      select p.path, r.id as revision_id, r.html, r.content_sha256, p.updated_at
      from pages p
      join page_revisions r on r.id = p.current_revision_id
      where p.path = $1
      `,
      [path],
    );
    return result.rowCount ? mapRendered(result.rows[0]) : null;
  }

  async getCurrentMetadata(path: string): Promise<PageMetadata | null> {
    const page = await this.getCurrentPage(path);
    if (!page) return null;
    const { html: _html, ...metadata } = page;
    return metadata;
  }

  async listRevisions(path: string, limit = 20): Promise<PageMetadata[]> {
    const result = await this.pool.query(
      `
      select r.path, r.id as revision_id, r.content_sha256, r.created_at as updated_at
      from page_revisions r
      where r.path = $1
      order by r.id desc
      limit $2
      `,
      [path, limit],
    );
    return result.rows.map(mapMetadata);
  }

  async savePage(input: SavePageInput): Promise<PageMetadata> {
    const contentSha256 = sha256(input.html);
    return this.transaction(async (client) => {
      await client.query("insert into pages(path) values ($1) on conflict (path) do nothing", [input.path]);
      const current = await this.lockCurrent(client, input.path);
      if (current?.contentSha256) {
        if (contentSha256 === current.contentSha256) return current;
        if (!input.expectedContentSha256 || input.expectedContentSha256 !== current.contentSha256) {
          throw new PageConflictError("current page hash does not match expectedContentSha256", current);
        }
      } else if (input.expectedContentSha256) {
        throw new PageConflictError("new page must not provide expectedContentSha256");
      }

      const revisionId = await this.insertRevision(client, input.path, input.html, contentSha256);
      const updated = await client.query(
        `
        update pages
        set current_revision_id = $2, updated_at = now()
        where path = $1
        returning path, current_revision_id as revision_id, updated_at
        `,
        [input.path, revisionId],
      );
      return {
        path: updated.rows[0].path,
        revisionId: Number(updated.rows[0].revision_id),
        contentSha256,
        updatedAt: updated.rows[0].updated_at.toISOString(),
      };
    });
  }

  async rollbackPage(input: RollbackPageInput): Promise<PageMetadata> {
    return this.transaction(async (client) => {
      const current = await this.lockCurrent(client, input.path);
      const target = await client.query("select id, path, content_sha256 from page_revisions where id = $1 and path = $2", [
        input.revisionId,
        input.path,
      ]);
      if (!target.rowCount) throw new PageNotFoundError("revision does not belong to path");
      if (current?.revisionId === input.revisionId) return current;
      if (!current || current.contentSha256 !== input.expectedContentSha256) {
        throw new PageConflictError("current page hash does not match expectedContentSha256", current ?? undefined);
      }
      const updated = await client.query(
        `
        update pages
        set current_revision_id = $2, updated_at = now()
        where path = $1
        returning path, current_revision_id as revision_id, updated_at
        `,
        [input.path, input.revisionId],
      );
      return {
        path: updated.rows[0].path,
        revisionId: Number(updated.rows[0].revision_id),
        contentSha256: target.rows[0].content_sha256,
        updatedAt: updated.rows[0].updated_at.toISOString(),
      };
    });
  }

  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockCurrent(client: PoolClient, path: string): Promise<PageMetadata | null> {
    const result = await client.query(
      `
      select p.path, p.current_revision_id as revision_id, r.content_sha256, p.updated_at
      from pages p
      left join page_revisions r on r.id = p.current_revision_id
      where p.path = $1
      for update of p
      `,
      [path],
    );
    if (!result.rowCount || result.rows[0].revision_id == null) return null;
    return mapMetadata(result.rows[0]);
  }

  private async insertRevision(client: PoolClient, path: string, html: string, contentSha256: string): Promise<number> {
    const inserted = await client.query(
      `
      insert into page_revisions(path, html, content_sha256)
      values ($1, $2, $3)
      on conflict (path, content_sha256) do nothing
      returning id
      `,
      [path, html, contentSha256],
    );
    if (inserted.rowCount) return Number(inserted.rows[0].id);

    const existing = await client.query("select id from page_revisions where path = $1 and content_sha256 = $2", [
      path,
      contentSha256,
    ]);
    return Number(existing.rows[0].id);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function mapMetadata(row: any): PageMetadata {
  return {
    path: row.path,
    revisionId: Number(row.revision_id),
    contentSha256: row.content_sha256,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  };
}

function mapRendered(row: any): RenderedPage {
  return { ...mapMetadata(row), html: row.html };
}
