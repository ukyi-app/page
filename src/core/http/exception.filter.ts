import type { Hono } from "hono";
import { error } from "./responses";
import { BadRequestError, RequestTooLargeError } from "./http-errors";
import {
  PageConflictError, PageNotFoundError,
  type PageMetadata, type RenderedPage,
} from "../../modules/pages/pages.repository";

function stripHtml(page: PageMetadata | RenderedPage): PageMetadata {
  return {
    path: page.path,
    revisionId: page.revisionId,
    contentSha256: page.contentSha256,
    updatedAt: page.updatedAt,
  };
}

export function registerExceptionFilter(app: Hono): void {
  app.onError((err, c) => {
    if (err instanceof RequestTooLargeError) return error("payload_too_large", 413);
    if (err instanceof BadRequestError) return error(err.code, 400);
    if (err instanceof PageConflictError) {
      return error("conflict", 409, err.current ? { current: stripHtml(err.current) } : {});
    }
    if (err instanceof PageNotFoundError) return error("not_found", 404);
    console.error("repository failure", {
      operation: `${c.req.method} ${c.req.path}`,
      error: err instanceof Error ? err.message : String(err),
    });
    return error("service_unavailable", 503);
  });
}
