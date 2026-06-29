import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import type { Context } from "hono";
import { buildApp } from "../../../src/core/app-factory";
import type { AppConfig } from "../../../src/core/config/config";
import { Inject } from "../../../src/core/di/decorators";
import { Module } from "../../../src/core/di/module";
import { Controller, Get } from "../../../src/core/http/decorators";
import { json } from "../../../src/core/http/responses";

const VALUE = Symbol("VALUE");

@Controller("/x")
class XController {
  constructor(@Inject(VALUE) private readonly v: { n: number }) {}
  @Get("")
  read(_c: Context): Response {
    return json({ n: this.v.n });
  }
}

@Module({
  controllers: [XController],
  providers: [{ provide: VALUE, useFactory: () => ({ n: 42 }) }],
})
class XModule {}

const config: AppConfig = {
  port: 8080,
  databaseUrl: "postgres://x",
  migrateDatabaseUrl: "postgres://x",
  adminTokenSha256: "a".repeat(64),
  htmlMaxBytes: 100,
  jsonMaxBytes: 700,
  dbConnectionTimeoutMs: 2_000,
  dbStatementTimeoutMs: 3_000,
  dbOperationTimeoutMs: 25,
};

describe("buildApp", () => {
  test("injects a factory provider value into a controller", async () => {
    const { app } = await buildApp(XModule, { config, skipMigration: true });
    const res = await app.fetch(new Request("https://t.test/x"));
    expect(await res.json()).toEqual({ n: 42 });
  });

  test("providerOverrides replace a module provider", async () => {
    const { app } = await buildApp(XModule, {
      config,
      skipMigration: true,
      providerOverrides: [{ provide: VALUE, useValue: { n: 7 } }],
    });
    const res = await app.fetch(new Request("https://t.test/x"));
    expect(await res.json()).toEqual({ n: 7 });
  });

  test("returns the resolved ConfigService", async () => {
    const built = await buildApp(XModule, { config, skipMigration: true });
    expect(built.config.port).toBe(8080);
    expect(built.config.dbOperationTimeoutMs).toBe(25);
  });
});
