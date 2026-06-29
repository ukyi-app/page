import "reflect-metadata";
import { Hono } from "hono";
import { container } from "tsyringe";
import type { AppConfig } from "./core/config/config";
import { ConfigService } from "./core/config/config.service";
import { APP_CONFIG } from "./core/config/config.tokens";
import { collectControllers, collectProviders, Module } from "./core/di/module";
import { registerExceptionFilter } from "./core/http/exception.filter";
import { RouterFactory } from "./core/http/router.factory";
import { HealthModule } from "./modules/health/health.module";
import { PAGES_REPOSITORY, type PageRepositoryContract } from "./modules/pages/pages.contract";
import { PagesModule } from "./modules/pages/pages.module";

@Module({
  imports: [PagesModule, HealthModule],
  providers: [ConfigService],
})
export class AppModule {}

export interface AppDeps {
  config: AppConfig;
  pages: PageRepositoryContract;
}

/**
 * 애플리케이션 합성 루트(부트스트랩 진입점). main.ts에서 사용한다.
 * 런타임 값(config, pages)을 DI 토큰으로 등록하고, AppModule 모듈 그래프에서
 * provider(싱글턴)와 controller를 수집해 Hono 앱을 구성한다.
 */
export function createApp(deps: AppDeps): Hono {
  const c = container.createChildContainer();
  // 런타임 값 provider
  c.registerInstance(APP_CONFIG, deps.config);
  c.registerInstance<PageRepositoryContract>(PAGES_REPOSITORY, deps.pages);
  // 모듈 그래프의 클래스 provider를 싱글턴으로 등록
  for (const provider of collectProviders(AppModule)) {
    // biome-ignore lint: 동적 provider 클래스 토큰
    c.registerSingleton(provider as any);
  }

  const app = new Hono();
  registerExceptionFilter(app);

  // 컨트롤러 등록 순서는 RouterFactory가 단계로 강제하므로 결과에 영향 없음(불변식).
  // biome-ignore lint: 동적 controller 클래스 토큰
  const controllers = collectControllers(AppModule).map((C) => c.resolve(C as any) as object);
  RouterFactory.register(app, controllers, c);
  return app;
}
