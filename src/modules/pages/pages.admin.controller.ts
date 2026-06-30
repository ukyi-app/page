import type { Context } from "hono";
import { AuthGuard } from "../../core/auth/auth.guard";
import { readBoundedJson, byteLength } from "../../core/http/bounded-json";
import { RequestTooLargeError, BadRequestError } from "../../core/http/http-errors";
import { Controller, Delete, Get, Post, Put, UseGuard } from "../../core/http/decorators";
import { json, error } from "../../core/http/responses";
import { ConfigService } from "../../core/config/config.service";
import { audit, clientIp } from "../../core/observability/audit";
import { PagesService } from "./pages.service";
import {
  asRecord, parseContentType, parseExpectedContentSha256, parsePath,
  parsePositiveRevisionId, parseRequiredExpectedContentSha256,
} from "./pages.validation";

@Controller("/api/pages")
@UseGuard(AuthGuard)
export class PagesAdminController {
  constructor(
    private readonly pages: PagesService,
    private readonly config: ConfigService,
  ) {}

  @Put("")
  async save(c: Context): Promise<Response> {
    const body = asRecord(await readBoundedJson(c.req.raw, this.config.jsonMaxBytes));
    const path = parsePath(body.path);
    const html = body.html;
    if (typeof html !== "string") throw new BadRequestError("invalid_body");
    if (byteLength(html) > this.config.htmlMaxBytes) throw new RequestTooLargeError();
    const contentType = parseContentType(body.contentType);
    const expectedContentSha256 = parseExpectedContentSha256(body.expectedContentSha256, false);
    const saved = await this.pages.savePage({ path, html, contentType, expectedContentSha256 });
    audit("page.save", { path, revisionId: saved.revisionId, contentSha256: saved.contentSha256, ip: clientIp(c.req.raw.headers) });
    return json(saved);
  }

  @Get("")
  async getMetadata(c: Context): Promise<Response> {
    const path = parsePath(c.req.query("path") ?? null);
    const metadata = await this.pages.getCurrentMetadata(path);
    return metadata ? json(metadata) : error("not_found", 404);
  }

  @Get("/list")
  async list(_c: Context): Promise<Response> {
    const pages = await this.pages.listPages();
    return json({ pages });
  }

  @Get("/source")
  async source(c: Context): Promise<Response> {
    const path = parsePath(c.req.query("path") ?? null);
    const page = await this.pages.getCurrentSource(path);
    return page ? json(page) : error("not_found", 404);
  }

  @Delete("")
  async remove(c: Context): Promise<Response> {
    const path = parsePath(c.req.query("path") ?? null);
    const purgeAfter = new Date(Date.now() + this.config.purgeGraceMs).toISOString();
    const removed = await this.pages.softDeletePage({ path, purgeAfter });
    audit("page.softDelete", { path, purgeAfter: removed.purgeAfter, ip: clientIp(c.req.raw.headers) });
    return json(removed);
  }

  @Post("/restore")
  async restore(c: Context): Promise<Response> {
    const body = asRecord(await readBoundedJson(c.req.raw, this.config.jsonMaxBytes));
    const path = parsePath(body.path);
    const restored = await this.pages.restorePage(path);
    audit("page.restore", { path, ip: clientIp(c.req.raw.headers) });
    return json(restored);
  }

  @Get("/revisions")
  async listRevisions(c: Context): Promise<Response> {
    const path = parsePath(c.req.query("path") ?? null);
    const revisions = await this.pages.listRevisions(path);
    return json({ revisions });
  }

  @Post("/rollback")
  async rollback(c: Context): Promise<Response> {
    const body = asRecord(await readBoundedJson(c.req.raw, this.config.jsonMaxBytes));
    const path = parsePath(body.path);
    const revisionId = parsePositiveRevisionId(body.revisionId);
    const expectedContentSha256 = parseRequiredExpectedContentSha256(body.expectedContentSha256);
    const rolledBack = await this.pages.rollbackPage({ path, revisionId, expectedContentSha256 });
    audit("page.rollback", { path, revisionId: rolledBack.revisionId, ip: clientIp(c.req.raw.headers) });
    return json(rolledBack);
  }
}
