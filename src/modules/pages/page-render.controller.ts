import "reflect-metadata";
import type { Context } from "hono";
import { injectable } from "tsyringe";
import { Controller, Get } from "../../core/http/decorators";
import { error } from "../../core/http/responses";
import { canonicalizePagePath } from "../../core/path/page-path";
import { renderHeaders } from "../../core/render/render-headers";
import { PagesService } from "./pages.service";

@injectable()
@Controller("")
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
    return new Response(page.html, { status: 200, headers: renderHeaders() });
  }
}
