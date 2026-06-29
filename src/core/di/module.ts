import "reflect-metadata";

// biome-ignore lint: 클래스(생성자) 타입
type AnyClass = Function;

export const MODULE_METADATA = Symbol("module:metadata");

export interface ModuleMetadata {
  imports?: AnyClass[];
  controllers?: AnyClass[];
  providers?: AnyClass[];
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
  return collect(root, "controllers", new Set());
}

/** 모듈 그래프를 순회하며 provider를 중복 없이 수집. */
export function collectProviders(root: AnyClass): AnyClass[] {
  return collect(root, "providers", new Set());
}

function collect(module: AnyClass, key: "controllers" | "providers", seen: Set<AnyClass>): AnyClass[] {
  if (seen.has(module)) return [];
  seen.add(module);
  const meta = getModuleMetadata(module);
  const out: AnyClass[] = [];
  for (const imported of meta.imports ?? []) {
    for (const item of collect(imported, key, seen)) {
      if (!out.includes(item)) out.push(item);
    }
  }
  for (const item of meta[key] ?? []) {
    if (!out.includes(item)) out.push(item);
  }
  return out;
}
