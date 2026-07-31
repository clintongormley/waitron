import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { probeRoleStatement, usePgliteDb } from "./lifecycle.js";

/**
 * `usePgliteDb` owns its own `beforeAll`/`afterAll`, so a suite using it cannot write an unguarded
 * teardown — the failure mode `guarded-teardowns.test.ts` polices is removed by construction rather
 * than detected. These tests are therefore about the CONTRACT: that the accessor yields a migrated
 * database once the hook has run, and that reading it too early fails loudly instead of yielding
 * `undefined`.
 */
describe("usePgliteDb", () => {
  const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

  // Read at describe-body time — i.e. BEFORE `beforeAll` has run. Captured here rather than inside
  // an `it` because calling the helper from a test body would register hooks after collection,
  // which vitest does not allow.
  let earlyRead: unknown;
  try {
    void pg.db;
  } catch (error) {
    earlyRead = error;
  }

  it("throws a named error if read before the hook has run", () => {
    // Returning `undefined` here is exactly how the unguarded teardowns produced
    // "Cannot read properties of undefined" instead of the real failure.
    expect(earlyRead).toBeInstanceOf(Error);
    expect((earlyRead as Error).message).toMatch(/not started/i);
  });

  it("yields a migrated database", async () => {
    const result = await pg.db.execute(sql`select count(*)::int as n from tenants`);
    expect(result.rows[0]).toEqual({ n: 0 });
  });

  it("yields the same handle throughout the suite", () => {
    expect(pg.db).toBe(pg.db);
  });
});

/**
 * `useRealPostgres` itself needs a container, so its happy path is exercised by the RLS suites that
 * use it rather than here. Its one branching decision is extracted so both arms are provable without
 * Docker — a container is a heavy price for asserting a string.
 */
describe("probeRoleStatement", () => {
  it("grants membership when inRole is given", () => {
    expect(probeRoleStatement({ name: "probe", password: "pw", inRole: "app_user" })).toBe(
      "create role probe login password 'pw' in role app_user",
    );
  });

  it("omits the membership clause otherwise", () => {
    expect(probeRoleStatement({ name: "probe", password: "pw" })).toBe(
      "create role probe login password 'pw'",
    );
  });

  // The fields are plain `string` on an exported interface, so safety cannot rest on callers being
  // careful. A quote in the password would otherwise close the literal and change the statement.
  it.each([
    ["name", { name: "probe; drop role app_user --", password: "pw" }],
    ["password", { name: "probe", password: "pw'; drop role app_user --" }],
    ["inRole", { name: "probe", password: "pw", inRole: 'app_user"' }],
  ])("refuses an unsafe %s", (field, probe) => {
    expect(() => probeRoleStatement(probe)).toThrowError(new RegExp(`unsafe ${field}`));
  });
});
