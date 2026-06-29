import "reflect-metadata";

// biome-ignore lint: 클래스(생성자) 타입
export type AnyClass = Function;
export type InjectionToken = symbol | string | AnyClass;

/** DI provider 선언 형태. class 단축형 + value/class/factory 형태 지원. */
export type Provider =
  | AnyClass
  | { provide: InjectionToken; useValue: unknown }
  | { provide: InjectionToken; useClass: AnyClass }
  // biome-ignore lint: factory 인자 가변
  | { provide: InjectionToken; useFactory: (...args: any[]) => unknown; inject?: InjectionToken[] };

export const MODULE_METADATA = Symbol("module:metadata");

export interface ModuleMetadata {
  imports?: AnyClass[];
  controllers?: AnyClass[];
  providers?: Provider[];
}

/** NestJS식 모듈 선언. imports/controllers/providers 메타데이터를 클래스에 저장. */
export function Module(meta: ModuleMetadata): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(MODULE_METADATA, meta, target);
  };
}

export function getModuleMetadata(module: AnyClass): ModuleMetadata {
  return Reflect.getOwnMetadata(MODULE_METADATA, module) ?? {};
}

/** 모듈 그래프(imports 재귀)를 DFS로 순회하며 컨트롤러를 중복 없이 수집. */
export function collectControllers(root: AnyClass): AnyClass[] {
  return collect<AnyClass>(root, "controllers", new Set());
}

/** 모듈 그래프를 순회하며 provider를 중복 없이 수집. */
export function collectProviders(root: AnyClass): Provider[] {
  return collect<Provider>(root, "providers", new Set());
}

function collect<T>(module: AnyClass, key: "controllers" | "providers", seen: Set<AnyClass>): T[] {
  if (seen.has(module)) return [];
  seen.add(module);
  const meta = getModuleMetadata(module);
  const out: T[] = [];
  for (const imported of meta.imports ?? []) {
    for (const item of collect<T>(imported, key, seen)) {
      if (!out.includes(item)) out.push(item);
    }
  }
  for (const item of (meta[key] ?? []) as T[]) {
    if (!out.includes(item)) out.push(item);
  }
  return out;
}
