import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { asAppUser } from "./roles.js";
import { useVenueDb } from "./venue-db.js";

/**
 * `asAppUser` is inert, and these cases are what says so.
 *
 * It used to switch the transaction to the non-owner `app_user` role, which is how a grant
 * assertion proved it was asserting anything at all. There are no roles and no grants on this
 * engine, so there is nothing for it to switch to — and the function is kept rather than deleted
 * only so that the flip does not also edit its 1,354 call sites. Task T1 removes them.
 */
describe("asAppUser", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("leaves the database usable", async () => {
    await asAppUser(suite.db);
    const rows = suite.db.all<{ n: number }>(sql`select cast(count(*) as int) as n from tenants`);
    expect(rows).toEqual([{ n: 0 }]);
  });

  // The case that discriminates. The one above would also pass if the function sent a statement
  // this engine happened to accept; this one fails unless it sends NOTHING, because every way of
  // reaching the database from here throws.
  it("sends no statement at all", async () => {
    const refuses = (): never => {
      throw new Error("asAppUser reached the database");
    };
    const handle = { run: refuses, all: refuses, get: refuses, values: refuses, execute: refuses };
    await expect(asAppUser(handle as unknown as Transaction)).resolves.toBeUndefined();
  });
});
