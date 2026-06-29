import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import {
  Controller, Get, Post, Put, UseGuard,
  getControllerPath, getRoutes, getGuards,
} from "../../../src/core/http/decorators";

class FakeGuard { handle = async () => {}; }

@Controller("/api/pages")
@UseGuard(FakeGuard)
class Sample {
  @Put("") save() {}
  @Get("/revisions") list() {}
  @Post("/rollback") rollback() {}
}

describe("routing decorators", () => {
  test("records controller base path", () => {
    expect(getControllerPath(Sample)).toBe("/api/pages");
  });
  test("records routes with method/path/handler", () => {
    const routes = getRoutes(Sample);
    expect(routes).toEqual(
      expect.arrayContaining([
        { method: "put", path: "", handlerName: "save" },
        { method: "get", path: "/revisions", handlerName: "list" },
        { method: "post", path: "/rollback", handlerName: "rollback" },
      ]),
    );
    expect(routes).toHaveLength(3);
  });
  test("records guards", () => {
    expect(getGuards(Sample)).toEqual([FakeGuard]);
  });
});
