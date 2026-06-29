import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { collectControllers, collectProviders, getModuleMetadata, Module } from "../../../src/core/di/module";

class CtrlA {}
class CtrlB {}
class SvcA {}
class SvcB {}

@Module({ controllers: [CtrlA], providers: [SvcA] })
class ModA {}

@Module({ controllers: [CtrlB], providers: [SvcB], imports: [ModA] })
class ModB {}

@Module({ imports: [ModB, ModA] }) // ModA가 두 번 경유 → dedupe 되어야
class Root {}

describe("core/di module", () => {
  test("stores module metadata", () => {
    expect(getModuleMetadata(ModA).controllers).toEqual([CtrlA]);
    expect(getModuleMetadata(ModA).providers).toEqual([SvcA]);
  });

  test("collectControllers walks imports and dedupes", () => {
    const ctrls = collectControllers(Root);
    expect(ctrls).toContain(CtrlA);
    expect(ctrls).toContain(CtrlB);
    expect(ctrls.filter((c) => c === CtrlA)).toHaveLength(1);
  });

  test("collectProviders walks imports and dedupes", () => {
    const provs = collectProviders(Root);
    expect(provs).toEqual(expect.arrayContaining([SvcA, SvcB]));
    expect(provs.filter((p) => p === SvcA)).toHaveLength(1);
  });

  test("empty module yields empty metadata", () => {
    class Empty {}
    expect(getModuleMetadata(Empty)).toEqual({});
    expect(collectControllers(Empty)).toEqual([]);
  });
});
