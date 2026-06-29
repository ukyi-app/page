import "reflect-metadata";
import type { MiddlewareHandler } from "hono";

export const CONTROLLER_PATH = Symbol("controller:path");
export const ROUTES = Symbol("controller:routes");
export const GUARDS = Symbol("controller:guards");

export type HttpMethod = "get" | "put" | "post";

export interface RouteDef {
  method: HttpMethod;
  path: string;
  handlerName: string;
}

export interface CanActivate {
  handle: MiddlewareHandler;
}

// DI 주입 가드(생성자 인자 있음)도 허용해야 하므로 any[] (NestJS Type<any> 패턴). never[]이면
// ConfigService 생성자를 가진 AuthGuard가 @UseGuard에 strict TS 비호환이 된다.
export type GuardClass = new (...args: any[]) => CanActivate;

// biome-ignore lint: tsyringe 데코레이터 타깃 타입
type Ctor = Function;

export function Controller(basePath = ""): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(CONTROLLER_PATH, basePath, target);
  };
}

function methodDecorator(method: HttpMethod) {
  return (path = ""): MethodDecorator =>
    (target, propertyKey) => {
      const ctor = target.constructor;
      const routes: RouteDef[] = Reflect.getOwnMetadata(ROUTES, ctor) ?? [];
      routes.push({ method, path, handlerName: String(propertyKey) });
      Reflect.defineMetadata(ROUTES, routes, ctor);
    };
}

export const Get = methodDecorator("get");
export const Put = methodDecorator("put");
export const Post = methodDecorator("post");

export function UseGuard(guard: GuardClass): ClassDecorator {
  return (target) => {
    const guards: GuardClass[] = Reflect.getOwnMetadata(GUARDS, target) ?? [];
    guards.push(guard);
    Reflect.defineMetadata(GUARDS, guards, target);
  };
}

export function getControllerPath(ctor: Ctor): string {
  return Reflect.getOwnMetadata(CONTROLLER_PATH, ctor) ?? "";
}
export function getRoutes(ctor: Ctor): RouteDef[] {
  return Reflect.getOwnMetadata(ROUTES, ctor) ?? [];
}
export function getGuards(ctor: Ctor): GuardClass[] {
  return Reflect.getOwnMetadata(GUARDS, ctor) ?? [];
}
