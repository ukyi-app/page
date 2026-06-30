import type { Context } from "hono";
import { Controller, Get } from "../../core/http/decorators";
import { error } from "../../core/http/responses";
import { canonicalizePagePath } from "../../core/path/page-path";
import { renderHeaders } from "../../core/render/render-headers";
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
    // getCurrentPage가 서빙용 콘텐츠를 돌려준다(마크다운은 저장 시 미리 렌더된 HTML 문서, html은 원본).
    return new Response(page.html, { status: 200, headers: renderHeaders() });
  }
}
