import { describe, expect, test } from "bun:test";
import { migrate, runtimeRoleFromDatabaseUrl } from "../../../src/core/database/db";

describe("migrate", () => {
  test("uses one checked-out client for transaction statements", async () => {
    const calls: string[] = [];
    const client = {
      query: async (sql: string) => {
        calls.push(sql.trim().split(/\s+/).slice(0, 2).join(" ").toLowerCase());
        return { rowCount: 0, rows: [] };
      },
      release: () => calls.push("release"),
    };
    const pool = {
      connect: async () => client,
      query: async () => {
        throw new Error("migrate must not use pool.query inside a transaction");
      },
    };

    await migrate(pool as any, "postgres://page_runtime:runtime@localhost:15432/page_test");

    expect(calls[0]).toBe("begin");
    expect(calls).toContain("select pg_advisory_xact_lock($1)");
    expect(calls).toContain("grant usage");
    expect(calls).toContain("commit");
    expect(calls.at(-1)).toBe("release");
  });

  test("rolls back on the same checked-out client when a statement fails", async () => {
    const calls: string[] = [];
    let createCount = 0;
    const client = {
      query: async (sql: string) => {
        const normalized = sql.trim().toLowerCase();
        calls.push(normalized.startsWith("rollback") ? "rollback" : normalized.slice(0, 12));
        if (normalized.startsWith("create table")) {
          createCount += 1;
          if (createCount === 2) throw new Error("boom");
        }
        return { rowCount: 0, rows: [] };
      },
      release: () => calls.push("release"),
    };
    const pool = { connect: async () => client };

    await expect(migrate(pool as any, "postgres://page_runtime:runtime@localhost:15432/page_test")).rejects.toThrow(
      "boom",
    );
    expect(calls).toContain("rollback");
    expect(calls.at(-1)).toBe("release");
  });

  test("extracts the runtime role from DATABASE_URL for grants", () => {
    expect(runtimeRoleFromDatabaseUrl("postgres://page_runtime:runtime@localhost:15432/page_test")).toBe(
      "page_runtime",
    );
    expect(() => runtimeRoleFromDatabaseUrl("postgres://:runtime@localhost:15432/page_test")).toThrow(
      "DATABASE_URL username is required",
    );
  });
});
