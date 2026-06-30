import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { Inject, Service } from "../../core/di/decorators";
import { PG_POOL } from "../../core/database/database.tokens";
import { BadRequestError } from "../../core/http/http-errors";
import { renderMarkdownDocument } from "../../core/render/markdown";
import type { ContentType } from "./pages.validation";

// purge 스윕 전역 직렬화 키(마이그레이션 …001, 테스트 리셋 …002과 구분). 멀티레플리카에서 한 번에 하나만 purge.
const PURGE_LOCK_KEY = 7_621_947_031_003;

export type PageMetadata = {
  path: string;
  revisionId: number;
  contentSha256: string;
  /** 저장 콘텐츠의 타입. 'html'은 그대로, 'markdown'은 렌더 시 HTML 문서로 변환된다. */
  contentType: ContentType;
  updatedAt: string;
};

export type RenderedPage = PageMetadata & {
  /**
   * getCurrentPage(렌더 경로)에서는 서빙할 콘텐츠(마크다운은 미리 렌더된 HTML 문서, html은 원본),
   * getCurrentSource(편집 경로)에서는 편집용 원본 소스를 담는다.
   */
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
  /** 저장 콘텐츠 타입. 생략 시 'html'(데이터 계층 기본). API 검증 계층이 기본값을 보장한다. */
  contentType?: ContentType;
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
    // 공개 렌더 경로: 비활성(soft delete) 페이지는 숨겨 404가 되게 하고, 서빙용 콘텐츠를 돌려준다.
    return this.queryCurrent(path, { onlyActive: true, serve: true });
  }

  /** 관리 편집용: 비활성 페이지의 원본 소스도 그대로 돌려준다(렌더와 달리 disabled 필터 없음). */
  async getCurrentSource(path: string): Promise<RenderedPage | null> {
    return this.queryCurrent(path, { onlyActive: false, serve: false });
  }

  private async queryCurrent(
    path: string,
    opts: { onlyActive: boolean; serve: boolean },
  ): Promise<RenderedPage | null> {
    // serve: 렌더는 미리 렌더된 rendered_html(없으면 html)을, 편집은 원본 html을 돌려준다.
    const htmlExpr = opts.serve ? "coalesce(r.rendered_html, r.html)" : "r.html";
    const result = await this.pool.query(
      `
      select p.path, r.id as revision_id, ${htmlExpr} as html, r.content_sha256, r.content_type, p.updated_at
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
      select p.path, p.current_revision_id as revision_id, r.content_sha256, r.content_type,
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
      select r.path, r.id as revision_id, r.content_sha256, r.content_type, r.created_at as updated_at
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
    const contentType: ContentType = input.contentType ?? "html";
    // 마크다운은 저장 시점에 1회 렌더해 둔다(트랜잭션 밖: 파싱 중 DB 연결을 점유하지 않게).
    // 잘못된(예: 과도한 중첩으로 marked가 throw하는) 마크다운은 여기서 400으로 거른다.
    const renderedHtml = renderStoredHtml(input.html, contentType);
    return this.transaction(async (client) => {
      await client.query("insert into pages(path) values ($1) on conflict (path) do nothing", [input.path]);
      const current = await this.lockCurrent(client, input.path);
      if (current?.contentSha256) {
        // 동일 콘텐츠는 (바이트 + 타입)이 모두 같을 때만이다. 같은 바이트라도 타입이 다르면
        // 새 콘텐츠로 취급해 아래 conflict 검사(expected 필요)를 거쳐 새 리비전을 만든다.
        if (contentSha256 === current.contentSha256 && contentType === current.contentType) {
          // 비활성 상태였다면 재활성화만 하고, 아니면 그대로 반환.
          if (!current.disabledAt) return stripDisabled(current);
          return this.reactivate(client, input.path, contentSha256, current.contentType);
        }
        if (!input.expectedContentSha256 || input.expectedContentSha256 !== current.contentSha256) {
          throw new PageConflictError("current page hash does not match expectedContentSha256", stripDisabled(current));
        }
      } else if (input.expectedContentSha256) {
        throw new PageConflictError("new page must not provide expectedContentSha256");
      }

      const revisionId = await this.insertRevision(
        client,
        input.path,
        input.html,
        contentSha256,
        contentType,
        renderedHtml,
      );
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
        contentType,
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
      // returning은 pages 컬럼만 주므로 콘텐츠 메타(sha·type)는 잠근 current 값으로 채운다.
      return { ...mapListItem(updated.rows[0]), contentSha256: current.contentSha256, contentType: current.contentType };
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
      return { ...mapListItem(updated.rows[0]), contentSha256: current.contentSha256, contentType: current.contentType };
    });
  }

  /** purge 스윕: purge_after가 지난 비활성 페이지를 완전 삭제(리비전은 FK cascade). 삭제 건수 반환. */
  async purgeExpired(now: string): Promise<number> {
    // 멀티레플리카 안전: try-advisory-xact-lock을 못 잡으면(다른 레플리카가 purge 중) 건너뛴다(0).
    // 논블로킹이며 xact lock은 commit/rollback 시 자동 해제된다.
    return this.transaction(async (client) => {
      const lock = await client.query("select pg_try_advisory_xact_lock($1) as ok", [PURGE_LOCK_KEY]);
      if (!lock.rows[0].ok) return 0;
      const result = await client.query(
        "delete from pages where purge_after is not null and purge_after <= $1",
        [now],
      );
      return result.rowCount ?? 0;
    });
  }

  private async reactivate(
    client: PoolClient,
    path: string,
    contentSha256: string,
    contentType: ContentType,
  ): Promise<PageMetadata> {
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
      contentType,
      updatedAt: updated.rows[0].updated_at.toISOString(),
    };
  }

  async rollbackPage(input: RollbackPageInput): Promise<PageMetadata> {
    return this.transaction(async (client) => {
      const current = await this.lockCurrent(client, input.path);
      const target = await client.query(
        "select id, path, content_sha256, content_type from page_revisions where id = $1 and path = $2",
        [input.revisionId, input.path],
      );
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
        contentType: target.rows[0].content_type as ContentType,
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
      select p.path, p.current_revision_id as revision_id, r.content_sha256, r.content_type, p.updated_at, p.disabled_at
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

  private async insertRevision(
    client: PoolClient,
    path: string,
    html: string,
    contentSha256: string,
    contentType: ContentType,
    renderedHtml: string | null,
  ): Promise<number> {
    const inserted = await client.query(
      `
      insert into page_revisions(path, html, content_sha256, content_type, rendered_html)
      values ($1, $2, $3, $4, $5)
      on conflict (path, content_sha256, content_type) do nothing
      returning id
      `,
      [path, html, contentSha256, contentType, renderedHtml],
    );
    if (inserted.rowCount) return Number(inserted.rows[0].id);

    const existing = await client.query(
      "select id from page_revisions where path = $1 and content_sha256 = $2 and content_type = $3",
      [path, contentSha256, contentType],
    );
    return Number(existing.rows[0].id);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * 서빙용 콘텐츠를 도출한다. html은 원본을 그대로 서빙하므로 null(렌더는 coalesce로 html 컬럼 사용),
 * markdown은 미리 HTML 문서로 렌더해 둔다. 과도한 중첩 등으로 marked가 throw하면 영구 503 대신
 * 저장 시점에 BadRequest('invalid_markdown')으로 거른다.
 */
function renderStoredHtml(source: string, contentType: ContentType): string | null {
  if (contentType !== "markdown") return null;
  try {
    return renderMarkdownDocument(source);
  } catch {
    throw new BadRequestError("invalid_markdown");
  }
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
    // soft delete/restore의 returning에는 content_type이 없어 undefined일 수 있다(호출부가 덮어씀).
    contentType: (row.content_type ?? "html") as ContentType,
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
    contentType: meta.contentType,
    updatedAt: meta.updatedAt,
  };
}
