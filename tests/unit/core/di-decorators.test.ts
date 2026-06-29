import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { container } from "tsyringe";
import { Inject, Injectable, Service } from "../../../src/core/di/decorators";

const TOKEN = Symbol("DI_DECO_TOKEN");

@Service()
class Dep {
  v(): number {
    return 5;
  }
}

@Injectable()
class Consumer {
  constructor(
    public readonly dep: Dep,
    @Inject(TOKEN) public readonly token: { n: number },
  ) {}
}

describe("core/di decorators (tsyringe 캡슐화)", () => {
  test("@Service makes a class container-resolvable without tsyringe @injectable", () => {
    expect(container.resolve(Dep).v()).toBe(5);
  });

  test("@Injectable + type dep + @Inject token resolve together", () => {
    const c = container.createChildContainer();
    c.registerInstance(TOKEN, { n: 9 });
    const consumer = c.resolve(Consumer);
    expect(consumer.dep.v()).toBe(5);
    expect(consumer.token.n).toBe(9);
  });

  test("Service is an alias of Injectable", () => {
    expect(Service).toBe(Injectable);
  });
});
