import "reflect-metadata";
import { Hono } from "hono";
import { container, type DependencyContainer, instanceCachingFactory } from "tsyringe";
import type { AppConfig } from "./config/config";
import { loadConfig } from "./config/config";
import { ConfigService } from "./config/config.service";
import { APP_CONFIG } from "./config/config.tokens";
import { createPool, migrate } from "./database/db";
import { type AnyClass, collectControllers, collectProviders, type Provider } from "./di/module";
import { registerExceptionFilter } from "./http/exception.filter";
import { RouterFactory } from "./http/router.factory";

/** 시작 시 마이그레이션 전용 statement timeout(ms). 런타임 읽기 한도와 분리한 넉넉한 값. */
const MIGRATION_STATEMENT_TIMEOUT_MS = 60_000;

export interface BuildAppOptions {
  /** APP_CONFIG override (테스트에서 주입). 없으면 loadConfig()로 env에서 로드. */
  config?: AppConfig;
  /** provider override (테스트에서 fake 주입). 모듈 provider 뒤에 등록되어 우선한다. */
  providerOverrides?: Provider[];
  /** 시작 시 마이그레이션 생략(테스트는 테스트 헬퍼가 스키마를 준비). */
  skipMigration?: boolean;
}

/**
 * 제네릭 프레임워크 팩토리: 루트 모듈 그래프에서 provider/controller를 수집해 Hono 앱을 만든다.
 * 테스트는 이 함수를 직접(overrides와 함께) 호출하고, 프로덕션은 main.ts의 createApp이 호출한다.
 */
export async function buildApp(
  rootModule: AnyClass,
  options: BuildAppOptions = {},
): Promise<{ app: Hono; config: ConfigService; container: DependencyContainer }> {
  const c = container.createChildContainer();
  c.registerInstance(APP_CONFIG, options.config ?? loadConfig());
  for (const provider of collectProviders(rootModule)) registerProvider(c, provider);
  for (const override of options.providerOverrides ?? []) registerProvider(c, override);

  const config = c.resolve(ConfigService);
  if (!options.skipMigration) {
    const migratePool = createPool(config.migrateDatabaseUrl, {
      connectionTimeoutMs: config.dbConnectionTimeoutMs,
      // 마이그레이션은 시작 시 1회·advisory-lock으로 직렬화된다. DDL(특히 채워진 테이블의 인덱스 빌드)을
      // 런타임 읽기 예산(dbStatementTimeoutMs, 기본 3s)으로 죽이면 부팅이 실패하므로 넉넉한 한도를 쓴다.
      statementTimeoutMs: MIGRATION_STATEMENT_TIMEOUT_MS,
    });
    try {
      await migrate(migratePool, config.databaseUrl);
    } finally {
      await migratePool.end();
    }
  }

  const app = new Hono();
  registerExceptionFilter(app);
  // 컨트롤러 등록 순서는 RouterFactory가 단계로 강제하므로 결과에 영향 없음(불변식).
  const controllers = collectControllers(rootModule).map((C) => c.resolve(C as never) as object);
  RouterFactory.register(app, controllers, c);
  return { app, config, container: c };
}

function registerProvider(c: DependencyContainer, provider: Provider): void {
  if (typeof provider === "function") {
    c.registerSingleton(provider as never);
    return;
  }
  if ("useValue" in provider) {
    c.registerInstance(provider.provide as never, provider.useValue as never);
    return;
  }
  if ("useClass" in provider) {
    c.registerSingleton(provider.provide as never, provider.useClass as never);
    return;
  }
  const factory = provider.useFactory;
  const inject = provider.inject ?? [];
  c.register(provider.provide as never, {
    useFactory: instanceCachingFactory((dep) => factory(...inject.map((t) => dep.resolve(t as never)))),
  });
}
