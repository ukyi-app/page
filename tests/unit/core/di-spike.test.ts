import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { container, inject, injectable } from "tsyringe";

@injectable()
class SpikeDep {
  value(): number {
    return 42;
  }
}

@injectable()
class SpikeService {
  constructor(public readonly dep: SpikeDep) {}
}

const SPIKE_TOKEN = Symbol("SPIKE_TOKEN");

@injectable()
class SpikeConsumer {
  constructor(@inject(SPIKE_TOKEN) public readonly injected: { n: number }) {}
}

describe("DI foundation (tsyringe on Bun)", () => {
  test("resolves constructor-injected dep via design:paramtypes metadata", () => {
    const svc = container.resolve(SpikeService);
    expect(svc.dep.value()).toBe(42);
  });

  test("resolves token-injected instance from a child container", () => {
    const child = container.createChildContainer();
    child.registerInstance(SPIKE_TOKEN, { n: 7 });
    expect(child.resolve(SpikeConsumer).injected.n).toBe(7);
  });
});
