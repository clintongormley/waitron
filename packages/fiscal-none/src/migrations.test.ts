import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { FISCAL_NONE_MIGRATIONS } from "./migrations.js";

// The de-risk probe for the whole feature: prove an empty drizzle migration set applies as a no-op
// on top of core. useVenueDb runs the migrations in a beforeAll, so reaching a test body at all
// means the empty set applied without a drizzle error.
const suite = useVenueDb({
  // Core is listed because the probe is of the empty set applied on top of it, in manifest order;
  // the case also passes with core left out (measured 2026-09-23).
  migrations: [CORE_MIGRATIONS, FISCAL_NONE_MIGRATIONS],
});

describe("the fiscal-none (empty) migration set", () => {
  it("applies as a no-op and creates its own tracking table with zero rows", async () => {
    // The empty journal drives drizzle to create the tracking table but insert no migration rows.
    // A count of 0 proves the set is genuinely empty rather than silently applying something.
    //
    // The count was written `count(*)::int` for a PostgreSQL driver that returned a BigInt. Run
    // against this engine that statement is refused at prepare with `unrecognized token: ":"`
    // (node v26.7.0, `node:sqlite`), and the cast has nothing to do: `select count(*) as count`
    // on a two-row table hands back `2` with `typeof === "number"`, measured the same way.
    const result = await suite.db.execute<{ count: number }>(
      sql`select count(*) as count from __drizzle_migrations_fiscal_none`,
    );
    expect(result.rows[0]?.count).toBe(0);
  });
});
