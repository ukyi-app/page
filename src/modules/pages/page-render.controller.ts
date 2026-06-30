import type { Context } from "hono";
import { Controller, Get } from "../../core/http/decorators";
import { error } from "../../core/http/responses";
import { canonicalizePagePath } from "../../core/path/page-path";
import {
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
    // 현재 리비전의 서빙 표현에 대한 강한 ETag. 변하지 않았으면 304로 본문 전송을 생략해
    // 앞단 CDN/브라우저가 엣지 캐시 + 조건부 요청으로 오프로드할 수 있게 한다.
    const etag = pageEtag(page.contentSha256, page.contentType);
    if (ifNoneMatchSatisfied(c.req.header("if-none-match"), etag)) {
      return new Response(null, { status: 304, headers: notModifiedHeaders(etag) });
    }
    // getCurrentPage가 서빙용 콘텐츠를 돌려준다(마크다운은 저장 시 미리 렌더된 HTML 문서, html은 원본).
    return new Response(page.html, { status: 200, headers: renderHeaders(etag) });
  }
}
