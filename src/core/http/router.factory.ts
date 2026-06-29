import type { Context, Hono, MiddlewareHandler } from "hono";
import type { DependencyContainer } from "tsyringe";
import {
  type CanActivate, getControllerPath, getGuards, getRoutes, type RouteDef,
} from "./decorators";
import { error } from "./responses";

function methodNotAllowed(): Response {
  return error("method_not_allowed", 405);
}

function joinPath(base: string, path: string): string {
  if (!path) return base || "/";
  return `${base}${path}`;
}

// biome-ignore lint: 컨트롤러 인스턴스
type ControllerInstance = object;

export const RouterFactory = {
  register(app: Hono, controllers: ControllerInstance[], container: DependencyContainer): void {
    const metas = controllers.map((instance) => {
      const ctor = (instance as { constructor: Function }).constructor;
      return {
        instance,
        base: getControllerPath(ctor),
        routes: getRoutes(ctor),
        guards: getGuards(ctor),
      };
    });

    // 1. 가드 미들웨어 (base + base/*)
    for (const m of metas) {
      for (const Guard of m.guards) {
        const guard = container.resolve(Guard) as CanActivate;
        const mw: MiddlewareHandler = (c, next) => guard.handle(c, next);
        app.use(m.base || "/", mw);
        app.use(`${m.base}/*`, mw);
      }
    }

    // 2. 정확(비-와일드카드) 라우트
    for (const m of metas) {
      for (const route of m.routes) {
        if (route.path.includes("*")) continue;
        const full = joinPath(m.base, route.path);
        bind(app, route, full, m.instance);
      }
    }

    // 3. 405 catch-all (app.all = 모든 메서드. Hono엔 'ALL' 의사 메서드가 없으므로 app.all 사용)
    for (const m of metas) {
      const exact = m.routes.filter((r) => !r.path.includes("*"));
      if (m.base) {
        app.all(m.base, methodNotAllowed);
        app.all(`${m.base}/*`, methodNotAllowed);
      } else {
        for (const route of exact) {
          app.all(joinPath(m.base, route.path), methodNotAllowed);
        }
      }
    }

    // 4. 와일드카드 라우트
    for (const m of metas) {
      for (const route of m.routes) {
        if (!route.path.includes("*")) continue;
        bind(app, route, joinPath(m.base, route.path), m.instance);
      }
    }

    // 5. 전역 폴백
    app.all("*", methodNotAllowed);

    // 6. HEAD 폴백 조정: Hono(#dispatch)는 HEAD를 GET 라우트로 자동 응답하지만, 구 서버는
    // HEAD를 비-GET 메서드로 취급해 405(미인증 admin은 가드가 먼저 401)를 반환했다.
    // byte-identical 보존을 위해 HEAD를 GET에 매칭되지 않는 합성 메서드로 재디스패치해
    // 405 catch-all / 가드 경로로 흘려보낸다.
    const honoFetch = app.fetch;
    app.fetch = ((...args: Parameters<typeof honoFetch>) => {
      const [request, ...rest] = args;
      if (request.method === "HEAD") {
        return honoFetch(new Request(request, { method: "REPORT" }), ...rest);
      }
      return honoFetch(...args);
    }) as typeof app.fetch;
  },
};

function bind(app: Hono, route: RouteDef, full: string, instance: ControllerInstance): void {
  const handler = (c: Context) =>
    (instance as Record<string, (ctx: Context) => Response | Promise<Response>>)[route.handlerName](c);
  app[route.method](full, handler);
}
