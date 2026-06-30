import type { Context } from "hono";
import { Controller, Get } from "../../core/http/decorators";
import { error } from "../../core/http/responses";
import { canonicalizePagePath } from "../../core/path/page-path";
import {
  httpDate,
  ifModifiedSinceSatisfied,
  ifNoneMatchSatisfied,
  notModifiedHeaders,
  pageEtag,
  renderHeaders,
} from "../../core/render/render-headers";
import { PagesService } from "./pages.service";

@Controller()
export class PageRenderController {
  constructor(private readonly pages: PagesService) {}

  @Get("*")
  async render(c: Context): Promise<Response> {
    let path: string;
    try {
      path = canonicalizePagePath(c.req.path);
    } catch {
      return error("not_found", 404);
    }
    const page = await this.pages.getCurrentPage(path);
    if (!page) return error("not_found", 404);
    // 두 가지 검증자: 강한 ETag(콘텐츠 해시; 의미상 정확, 동일초 변경도 구분)와
    // Last-Modified(updatedAt; 앞단 Cloudflare가 ETag를 제거해도 통과하는 백업 검증자).
    // updatedAt은 모든 변경(save/rollback/soft delete/restore)에서 now()로 갱신되는 단조 포인터다.
    const etag = pageEtag(page.contentSha256, page.contentType);
    const lastModified = httpDate(page.updatedAt);
    const ifNoneMatch = c.req.header("if-none-match");
    // RFC 7232 §6: If-None-Match가 있으면 If-Modified-Since는 무시한다.
    const notModified = ifNoneMatch != null
      ? ifNoneMatchSatisfied(ifNoneMatch, etag)
      : ifModifiedSinceSatisfied(c.req.header("if-modified-since"), lastModified);
    if (notModified) {
      return new Response(null, { status: 304, headers: notModifiedHeaders(etag, lastModified) });
    }
    // getCurrentPage가 서빙용 콘텐츠를 돌려준다(마크다운은 저장 시 미리 렌더된 HTML 문서, html은 원본).
    return new Response(page.html, { status: 200, headers: renderHeaders(etag, lastModified) });
  }
}
