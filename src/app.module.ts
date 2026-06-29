import "reflect-metadata";
import { Hono } from "hono";
import { container } from "tsyringe";
import type { AppConfig } from "./core/config/config";
import { ConfigService } from "./core/config/config.service";
import { registerExceptionFilter } from "./core/http/exception.filter";
import { RouterFactory } from "./core/http/router.factory";
import { HealthController } from "./modules/health/health.controller";
import { PageRenderController } from "./modules/pages/page-render.controller";
import { PagesAdminController } from "./modules/pages/pages.admin.controller";
import { PAGES_REPOSITORY, type PageRepositoryContract } from "./modules/pages/pages.contract";

export interface AppDeps {
  config: AppConfig;
  pages: PageRepositoryContract;
}

export function createApp(deps: AppDeps): Hono {
  const c = container.createChildContainer();
  c.registerInstance(ConfigService, new ConfigService(deps.config));
  c.registerInstance<PageRepositoryContract>(PAGES_REPOSITORY, deps.pages);

  const app = new Hono();
  registerExceptionFilter(app);

  // 컨트롤러 순서는 RouterFactory가 단계로 강제하므로 결과에 영향 없음(불변식).
  const controllers = [
    c.resolve(PagesAdminController),
    c.resolve(HealthController),
    c.resolve(PageRenderController),
  ];
  RouterFactory.register(app, controllers, c);
  return app;
}
