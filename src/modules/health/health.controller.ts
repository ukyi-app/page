import "reflect-metadata";
import type { Context } from "hono";
import { injectable } from "tsyringe";
import { Controller, Get } from "../../core/http/decorators";
import { json } from "../../core/http/responses";

@injectable()
@Controller("")
export class HealthController {
  @Get("/health")
  health(_c: Context): Response {
    return json({ ok: true });
  }
}
