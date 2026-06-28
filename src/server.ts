import { isAuthorized } from "./auth";
import type { AppConfig } from "./config";
import {
  PageConflictError,
  PageNotFoundError,
  type PageMetadata,
  type PageRepository,
  type RenderedPage,
} from "./pageRepository";
import { canonicalizePagePath } from "./path";
import { renderHeaders } from "./renderHeaders";

type Pages = Pick<PageRepository, "getCurrentPage" | "getCurrentMetadata" | "listRevisions" | "savePage" | "rollbackPage">;

export type AppContext = {
  config: AppConfig;
  pages: Pages;
};

export function createServer(context: AppContext): { fetch: (request: Request) => Promise<Response> } {
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        return request.method === "GET" ? json({ ok: true }) : error("method_not_allowed", 405);
      }

      if (isAdminPath(url.pathname)) {
        return handleAdmin(request, url, context);
      }

      if (request.method !== "GET") return error("method_not_allowed", 405);
      return handleRender(url, context);
    },
  };
}

async function handleAdmin(request: Request, url: URL, context: AppContext): Promise<Response> {
  if (!(await isAuthorized(request, context.config.adminTokenSha256))) {
    return error("unauthorized", 401);
  }

  try {
    if (url.pathname === "/api/pages" && request.method === "PUT") {
      return await savePage(request, context);
    }
    if (url.pathname === "/api/pages" && request.method === "GET") {
      return await getMetadata(url, context);
    }
    if (url.pathname === "/api/pages/revisions" && request.method === "GET") {
      return await listRevisions(url, context);
    }
    if (url.pathname === "/api/pages/rollback" && request.method === "POST") {
      return await rollbackPage(request, context);
    }
    return error("method_not_allowed", 405);
  } catch (cause) {
    return mapRouteError("admin", cause);
  }
}

async function savePage(request: Request, context: AppContext): Promise<Response> {
  const body = asRecord(await readBoundedJson(request, context.config.jsonMaxBytes));
  const path = parsePath(body.path);
  const html = body.html;
  if (typeof html !== "string") throw new BadRequestError("invalid_body");
  if (byteLength(html) > context.config.htmlMaxBytes) throw new RequestTooLargeError();
  const expectedContentSha256 = parseExpectedContentSha256(body.expectedContentSha256, false);
  const saved = await context.pages.savePage({ path, html, expectedContentSha256 });
  return json(saved);
}

async function getMetadata(url: URL, context: AppContext): Promise<Response> {
  const path = parsePath(url.searchParams.get("path"));
  const metadata = await withReadDeadline(
    "getCurrentMetadata",
    context.config.dbOperationTimeoutMs,
    context.pages.getCurrentMetadata(path),
  );
  return metadata ? json(metadata) : error("not_found", 404);
}

async function listRevisions(url: URL, context: AppContext): Promise<Response> {
  const path = parsePath(url.searchParams.get("path"));
  const revisions = await withReadDeadline("listRevisions", context.config.dbOperationTimeoutMs, context.pages.listRevisions(path));
  return json({ revisions });
}

async function rollbackPage(request: Request, context: AppContext): Promise<Response> {
  const body = asRecord(await readBoundedJson(request, context.config.jsonMaxBytes));
  const path = parsePath(body.path);
  const revisionId = parsePositiveRevisionId(body.revisionId);
  const expectedContentSha256 = parseRequiredExpectedContentSha256(body.expectedContentSha256);
  const rolledBack = await context.pages.rollbackPage({ path, revisionId, expectedContentSha256 });
  return json(rolledBack);
}

async function handleRender(url: URL, context: AppContext): Promise<Response> {
  let path: string;
  try {
    path = canonicalizePagePath(url.pathname);
  } catch {
    return error("not_found", 404);
  }

  try {
    const page = await withReadDeadline("getCurrentPage", context.config.dbOperationTimeoutMs, context.pages.getCurrentPage(path));
    if (!page) return error("not_found", 404);
    return new Response(page.html, { status: 200, headers: renderHeaders() });
  } catch (cause) {
    return repositoryFailure("render", cause);
  }
}

function isAdminPath(pathname: string): boolean {
  return pathname === "/api/pages" || pathname.startsWith("/api/pages/");
}

function parsePath(value: unknown): string {
  try {
    return canonicalizePagePath(value);
  } catch {
    throw new BadRequestError("invalid_path");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestError("invalid_body");
  return value as Record<string, unknown>;
}

function mapRouteError(operation: string, cause: unknown): Response {
  if (cause instanceof RequestTooLargeError) return error("payload_too_large", 413);
  if (cause instanceof BadRequestError) return error(cause.code, 400);
  if (cause instanceof PageConflictError) {
    return error("conflict", 409, cause.current ? { current: stripHtml(cause.current) } : {});
  }
  if (cause instanceof PageNotFoundError) return error("not_found", 404);
  return repositoryFailure(operation, cause);
}

function stripHtml(page: PageMetadata | RenderedPage): PageMetadata {
  return {
    path: page.path,
    revisionId: page.revisionId,
    contentSha256: page.contentSha256,
    updatedAt: page.updatedAt,
  };
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function error(code: string, status: number, extra: Record<string, unknown> = {}): Response {
  return json({ error: code, ...extra }, status);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;

class RequestTooLargeError extends Error {}

class BadRequestError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new RequestTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) throw new BadRequestError("missing_body");

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new RequestTooLargeError();
    chunks.push(value);
  }

  const raw = new TextDecoder().decode(concat(chunks, total));
  try {
    return JSON.parse(raw);
  } catch {
    throw new BadRequestError("invalid_json");
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function parseExpectedContentSha256(value: unknown, required = false): string | undefined {
  if (value == null && !required) return undefined;
  if (typeof value !== "string" || !SHA256_HEX_RE.test(value)) {
    throw new BadRequestError("invalid_expected_content_sha256");
  }
  return value.toLowerCase();
}

function parseRequiredExpectedContentSha256(value: unknown): string {
  return parseExpectedContentSha256(value, true) as string;
}

function parsePositiveRevisionId(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new BadRequestError("invalid_revision_id");
  }
  return value as number;
}

function repositoryFailure(operation: string, cause: unknown): Response {
  console.error("repository failure", {
    operation,
    error: cause instanceof Error ? cause.message : String(cause),
  });
  return error("service_unavailable", 503);
}

async function withReadDeadline<T>(operation: string, timeoutMs: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${operation} timed out`)), timeoutMs);
    });
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
