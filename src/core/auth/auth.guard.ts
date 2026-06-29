import type { Context } from "hono";
import { Injectable } from "../di/decorators";
import { verifyBearerToken } from "./auth-token";
import { ConfigService } from "../config/config.service";
import type { CanActivate } from "../http/decorators";
import { error } from "../http/responses";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  handle = async (c: Context, next: () => Promise<void>): Promise<Response | void> => {
    if (!(await verifyBearerToken(c.req.raw, this.config.adminTokenSha256))) {
      return error("unauthorized", 401);
    }
    await next();
  };
}
