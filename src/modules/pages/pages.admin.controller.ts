import "reflect-metadata";
import type { Context } from "hono";
import { injectable } from "tsyringe";
import { AuthGuard } from "../../core/auth/auth.guard";
import { readBoundedJson, byteLength } from "../../core/http/bounded-json";
import { RequestTooLargeError, BadRequestError } from "../../core/http/http-errors";
import { Controller, Get, Post, Put, UseGuard } from "../../core/http/decorators";
import { json, error } from "../../core/http/responses";
import { ConfigService } from "../../core/config/config.service";
import { PagesService } from "./pages.service";
import {
  asRecord, parseExpectedContentSha256, parsePath,
  parsePositiveRevisionId, parseRequiredExpectedContentSha256,
} from "./pages.validation";

@injectable()
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
    const expectedContentSha256 = parseExpectedContentSha256(body.expectedContentSha256, false);
    const saved = await this.pages.savePage({ path, html, expectedContentSha256 });
    return json(saved);
  }

  @Get("")
  async getMetadata(c: Context): Promise<Response> {
    const path = parsePath(c.req.query("path") ?? null);
    const metadata = await this.pages.getCurrentMetadata(path);
    return metadata ? json(metadata) : error("not_found", 404);
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
    return json(rolledBack);
  }
}
