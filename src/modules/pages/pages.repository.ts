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

/** 목록/관리용: 현재 페이지 + soft delete 상태(disabledAt=null이면 활성). */
export type PageListItem = PageMetadata & {
  disabledAt: string | null;
  purgeAfter: string | null;
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

export type SoftDeletePageInput = {
  path: string;
  /** 이 시각 이후 purge 스윕이 완전 삭제. */
  purgeAfter: string;
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
    // 공개 렌더 경로: 비활성(soft delete) 페이지는 숨겨 404가 되게 한다.
    return this.queryCurrent(path, { onlyActive: true });
  }

  /** 관리 편집용: 비활성 페이지의 원본 HTML도 그대로 돌려준다(렌더와 달리 disabled 필터 없음). */
  async getCurrentSource(path: string): Promise<RenderedPage | null> {
    return this.queryCurrent(path, { onlyActive: false });
  }

  private async queryCurrent(path: string, opts: { onlyActive: boolean }): Promise<RenderedPage | null> {
    const result = await this.pool.query(
      `
      select p.path, r.id as revision_id, r.html, r.content_sha256, p.updated_at
      from pages p
      join page_revisions r on r.id = p.current_revision_id
      where p.path = $1${opts.onlyActive ? " and p.disabled_at is null" : ""}
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

  /** 활성·비활성 모두 포함한 현재 페이지 목록(관리 UI). 비활성은 purge 예정 시각 포함. */
  async listPages(limit = 500): Promise<PageListItem[]> {
    const result = await this.pool.query(
      `
      select p.path, p.current_revision_id as revision_id, r.content_sha256,
             p.updated_at, p.disabled_at, p.purge_after
      from pages p
      join page_revisions r on r.id = p.current_revision_id
      order by (p.disabled_at is null) desc, p.updated_at desc
      limit $1
      `,
      [limit],
    );
    return result.rows.map(mapListItem);
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
        if (contentSha256 === current.contentSha256) {
          // 동일 콘텐츠: 비활성 상태였다면 재활성화만 하고, 아니면 그대로 반환.
          if (!current.disabledAt) return stripDisabled(current);
          return this.reactivate(client, input.path, contentSha256);
        }
        if (!input.expectedContentSha256 || input.expectedContentSha256 !== current.contentSha256) {
          throw new PageConflictError("current page hash does not match expectedContentSha256", stripDisabled(current));
        }
      } else if (input.expectedContentSha256) {
        throw new PageConflictError("new page must not provide expectedContentSha256");
      }

      const revisionId = await this.insertRevision(client, input.path, input.html, contentSha256);
      // 저장은 항상 페이지를 재활성화한다(disabled_at·purge_after 해제).
      const updated = await client.query(
        `
        update pages
        set current_revision_id = $2, updated_at = now(), disabled_at = null, purge_after = null
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

  /** soft delete: 콘텐츠/리비전은 보존하고 비활성화 + purge 예정 시각만 세팅. */
  async softDeletePage(input: SoftDeletePageInput): Promise<PageListItem> {
    return this.transaction(async (client) => {
      const current = await this.lockCurrent(client, input.path);
      if (!current) throw new PageNotFoundError("page does not exist");
      const updated = await client.query(
        `
        update pages
        set disabled_at = now(), purge_after = $2, updated_at = now()
        where path = $1
        returning path, current_revision_id as revision_id, updated_at, disabled_at, purge_after
        `,
        [input.path, input.purgeAfter],
      );
      return { ...mapListItem(updated.rows[0]), contentSha256: current.contentSha256 };
    });
  }

  /** soft delete 취소: 다시 활성화하고 purge 예약 해제. */
  async restorePage(path: string): Promise<PageListItem> {
    return this.transaction(async (client) => {
      const current = await this.lockCurrent(client, path);
      if (!current) throw new PageNotFoundError("page does not exist");
      const updated = await client.query(
        `
        update pages
        set disabled_at = null, purge_after = null, updated_at = now()
        where path = $1
        returning path, current_revision_id as revision_id, updated_at, disabled_at, purge_after
        `,
        [path],
      );
      return { ...mapListItem(updated.rows[0]), contentSha256: current.contentSha256 };
    });
  }

  /** purge 스윕: purge_after가 지난 비활성 페이지를 완전 삭제(리비전은 FK cascade). 삭제 건수 반환. */
  async purgeExpired(now: string): Promise<number> {
    const result = await this.pool.query(
      "delete from pages where purge_after is not null and purge_after <= $1",
      [now],
    );
    return result.rowCount ?? 0;
  }

  private async reactivate(client: PoolClient, path: string, contentSha256: string): Promise<PageMetadata> {
    const updated = await client.query(
      `
      update pages
      set disabled_at = null, purge_after = null, updated_at = now()
      where path = $1
      returning path, current_revision_id as revision_id, updated_at
      `,
      [path],
    );
    return {
      path: updated.rows[0].path,
      revisionId: Number(updated.rows[0].revision_id),
      contentSha256,
      updatedAt: updated.rows[0].updated_at.toISOString(),
    };
  }

  async rollbackPage(input: RollbackPageInput): Promise<PageMetadata> {
    return this.transaction(async (client) => {
      const current = await this.lockCurrent(client, input.path);
      const target = await client.query("select id, path, content_sha256 from page_revisions where id = $1 and path = $2", [
        input.revisionId,
        input.path,
      ]);
      if (!target.rowCount) throw new PageNotFoundError("revision does not belong to path");
      if (current?.revisionId === input.revisionId) return stripDisabled(current);
      if (!current || current.contentSha256 !== input.expectedContentSha256) {
        throw new PageConflictError(
          "current page hash does not match expectedContentSha256",
          current ? stripDisabled(current) : undefined,
        );
      }
      const updated = await client.query(
        `
        update pages
        set current_revision_id = $2, updated_at = now(), disabled_at = null, purge_after = null
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

  private async lockCurrent(
    client: PoolClient,
    path: string,
  ): Promise<(PageMetadata & { disabledAt: string | null }) | null> {
    const result = await client.query(
      `
      select p.path, p.current_revision_id as revision_id, r.content_sha256, p.updated_at, p.disabled_at
      from pages p
      left join page_revisions r on r.id = p.current_revision_id
      where p.path = $1
      for update of p
      `,
      [path],
    );
    if (!result.rowCount || result.rows[0].revision_id == null) return null;
    return { ...mapMetadata(result.rows[0]), disabledAt: toIso(result.rows[0].disabled_at) };
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

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapMetadata(row: any): PageMetadata {
  return {
    path: row.path,
    revisionId: Number(row.revision_id),
    contentSha256: row.content_sha256,
    updatedAt: toIso(row.updated_at) as string,
  };
}

function mapRendered(row: any): RenderedPage {
  return { ...mapMetadata(row), html: row.html };
}

function mapListItem(row: any): PageListItem {
  return {
    ...mapMetadata(row),
    disabledAt: toIso(row.disabled_at),
    purgeAfter: toIso(row.purge_after),
  };
}

/** soft delete 메타에서 비활성 필드를 제거해 순수 PageMetadata로 좁힌다. */
function stripDisabled(meta: PageMetadata & { disabledAt: string | null }): PageMetadata {
  return {
    path: meta.path,
    revisionId: meta.revisionId,
    contentSha256: meta.contentSha256,
    updatedAt: meta.updatedAt,
  };
}
