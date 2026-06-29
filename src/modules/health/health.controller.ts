import type { Context } from "hono";
import { Controller, Get } from "../../core/http/decorators";
import { json } from "../../core/http/responses";

@Controller()
export class HealthController {
  @Get("/health")
  health(_c: Context): Response {
    return json({ ok: true });
  }
}
