import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { FISCAL_NONE_MIGRATIONS } from "./migrations.js";

// The de-risk probe for the whole feature: prove an empty drizzle migration set applies as a no-op
// on top of core. usePgliteDb runs the migrations in a beforeAll, so reaching a test body at all
// means the empty set applied without a drizzle error.
const suite = usePgliteDb({
  // Core first — nothing enforces cross-package ordering, so it is explicit here.
  migrations: [CORE_MIGRATIONS, FISCAL_NONE_MIGRATIONS],
});

describe("the fiscal-none (empty) migration set", () => {
  it("applies as a no-op and creates its own tracking table with zero rows", async () => {
    // The empty journal drives drizzle to create the tracking table but insert no migration rows.
    // A count of 0 proves the set is genuinely empty rather than silently applying something.
    const result = await suite.db.execute<{ count: number }>(
      sql`select count(*)::int as count from __drizzle_migrations_fiscal_none`,
    );
    expect(result.rows[0]?.count).toBe(0);
  });
});
