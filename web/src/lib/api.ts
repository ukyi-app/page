import type { ApiErrorBody, ContentType, PageListItem, PageMetadata, PageSource } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: ApiErrorBody | null,
  ) {
    super(`${status} ${code}`);
    this.name = "ApiError";
  }

  /** 401 → 토큰 무효. UI에서 자동 로그아웃 트리거에 사용. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export type SaveInput = {
  path: string;
  html: string;
  contentType: ContentType;
  expectedContentSha256?: string;
};

export type Api = ReturnType<typeof createApi>;

export function createApi(token: string) {
  async function request<T>(input: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    let res: Response;
    try {
      res = await fetch(input, { ...init, headers });
    } catch {
      throw new ApiError(0, "network_error", null);
    }
    const text = await res.text();
    const parsed = text ? safeJson(text) : null;
    if (!res.ok) {
      const body = (parsed as ApiErrorBody | null) ?? null;
      throw new ApiError(res.status, body?.error ?? `http_${res.status}`, body);
    }
    return parsed as T;
  }

  return {
    token,
    async listPages(): Promise<PageListItem[]> {
      const out = await request<{ pages: PageListItem[] }>("/api/pages/list");
      return out.pages;
    },
    getSource(path: string): Promise<PageSource> {
      return request<PageSource>(`/api/pages/source?path=${encodeURIComponent(path)}`);
    },
    save(input: SaveInput): Promise<PageMetadata> {
      return request<PageMetadata>("/api/pages", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
    },
    remove(path: string): Promise<PageListItem> {
      return request<PageListItem>(`/api/pages?path=${encodeURIComponent(path)}`, { method: "DELETE" });
    },
    restore(path: string): Promise<PageListItem> {
      return request<PageListItem>("/api/pages/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
      });
    },
    async listRevisions(path: string): Promise<PageMetadata[]> {
      const out = await request<{ revisions: PageMetadata[] }>(
        `/api/pages/revisions?path=${encodeURIComponent(path)}`,
      );
      return out.revisions;
    },
    rollback(input: { path: string; revisionId: number; expectedContentSha256: string }): Promise<PageMetadata> {
      return request<PageMetadata>("/api/pages/rollback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
