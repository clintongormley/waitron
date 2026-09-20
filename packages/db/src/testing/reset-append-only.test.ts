import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "./venue-db.js";
import { seedTenant } from "./seed.js";

/**
 * Proof that the PGlite per-test reset (reset-ON, the default) leaves an append-only table's
 * `BEFORE TRUNCATE` trigger EXACTLY as it found it — `ENABLE ALWAYS` and firing. This is the
 * fiscal-critical guarantee (CLAUDE.md §5) the reset must never weaken: to empty the append-only
 * tables the reset disables their `*_block_truncate` triggers, and a bug that restored one as a
 * plain ENABLE (or left it disabled) would silently open a hole in the immutability protection.
 * `reset-append-only.pg.test.ts` is the real-Postgres twin, and says there why one engine passing
 * is no evidence about the other. PGlite is this file's whole scope.
 *
 * The reset itself is `usePgliteDb`'s, in `lifecycle.ts`; this suite reaches it through
 * `useVenueDb`, which forwards unchanged. It runs in the `afterEach` the helper registers, so the
 * FIRST test's insert is cleared by a real reset BEFORE the second test — whose assertions read
 * the trigger's POST-reset state.
 *
 * What is unique here is the ASSERTION, not the cycle. A reset-ON PGlite suite whose schema has
 * an append-only table RUNS the disable→truncate→restore cycle without asserting anything about it
 * — that `afterEach` calls `applyReset` for any suite that left `resetPerTest` at its default
 * (`lifecycle.ts:148-151`). The qualifier matters: `buildResetPlan` collects TRUNCATE-level
 * triggers only (`lifecycle.ts:93`), so a suite whose migrations create none just truncates. This is the only PGlite suite that reads
 * the trigger's state back AFTER one. `inmutabilidad`, the suite that owns the trigger, reads
 * `tgenabled` too but never post-reset: it runs `resetPerTest: false`
 * (`packages/fiscal-verifactu/src/inmutabilidad.test.ts:11-15`).
 */
describe("the PGlite per-test reset preserves append-only truncate protection", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] }); // reset-ON (default)

  it("leaves data the reset must clear (the reset bypasses the block-truncate trigger to do it)", async () => {
    await seedTenant(suite.db);
    const seeded = await suite.db.execute<{ n: number }>(
      sql`select count(*)::int as n from tenants`,
    );
    expect(seeded.rows[0]!.n).toBeGreaterThan(0);
  });

  it("after the reset: sales_block_truncate is back to ENABLE ALWAYS and still rejects a TRUNCATE", async () => {
    // The reset ran in the previous test's afterEach: it disabled the ALWAYS block-truncate trigger,
    // truncated every data table (tenants among them), and restored the trigger.

    // The reset actually happened: the row the first test left is gone.
    const cleared = await suite.db.execute<{ n: number }>(
      sql`select count(*)::int as n from tenants`,
    );
    expect(cleared.rows[0]!.n).toBe(0);

    // (a) No A->O downgrade: the trigger's enable state is still 'A' (ENABLE ALWAYS).
    const trigger = await suite.db.execute<{ tgenabled: string }>(sql`
      select t.tgenabled::text as tgenabled
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      where c.relname = 'sales' and t.tgname = 'sales_block_truncate'`);
    expect(trigger.rows[0]!.tgenabled).toBe("A");

    // (b) It is active, not left disabled: an explicit TRUNCATE is still rejected by the trigger.
    await expect(suite.db.execute(sql`truncate table sales`)).rejects.toThrow();
  });
});
