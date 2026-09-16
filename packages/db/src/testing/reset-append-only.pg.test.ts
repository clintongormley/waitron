import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useTemplateDb } from "./lifecycle.js";
import { seedTenant } from "./seed.js";

/**
 * The real-Postgres twin of `reset-append-only.test.ts`: proof that the per-test reset the real-PG
 * helpers now run (reset-ON, the default) leaves an append-only table's `BEFORE TRUNCATE` trigger
 * EXACTLY as it found it — `ENABLE ALWAYS` and firing. This is the fiscal-critical guarantee
 * (CLAUDE.md §5) the reset must never weaken.
 *
 * A separate file from the PGlite proof deliberately: `ENABLE ALWAYS` is the ONE trigger state whose
 * effect differs by engine — it fires even under `session_replication_role = replica`, which the
 * PGlite superuser path can never step into but a real backend can. PGlite passing is no evidence
 * the guarantee holds on the engine that actually ships. Cheap: it clones the shared `core` template
 * (~26ms), no per-file container.
 *
 * The reset runs in the `afterEach` the helper registers on the clone's admin connection, so the
 * FIRST test's insert is cleared by a real reset BEFORE the second test — whose assertions read the
 * trigger's POST-reset state.
 */
describe("useTemplateDb reset preserves append-only truncate protection (real Postgres)", () => {
  const suite = useTemplateDb({ template: "core" }); // reset-ON (default)

  it("leaves data the reset must clear (the reset bypasses the block-truncate trigger to do it)", async () => {
    await seedTenant(suite.admin);
    const seeded = await suite.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from tenants`,
    );
    expect(seeded.rows[0]!.n).toBeGreaterThan(0);
  });

  it("after the reset: sales_block_truncate is back to ENABLE ALWAYS and still rejects a TRUNCATE", async () => {
    // The reset ran in the previous test's afterEach: it disabled the ALWAYS block-truncate trigger,
    // truncated every data table (tenants among them), and restored the trigger.

    // The reset actually happened: the row the first test left is gone.
    const cleared = await suite.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from tenants`,
    );
    expect(cleared.rows[0]!.n).toBe(0);

    // (a) No A->O downgrade: the trigger's enable state is still 'A' (ENABLE ALWAYS).
    const trigger = await suite.admin.execute<{ tgenabled: string }>(sql`
      select t.tgenabled::text as tgenabled
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      where c.relname = 'sales' and t.tgname = 'sales_block_truncate'`);
    expect(trigger.rows[0]!.tgenabled).toBe("A");

    // (b) It is active, not left disabled: an explicit TRUNCATE is still rejected by the trigger.
    await expect(suite.admin.execute(sql`truncate table sales`)).rejects.toThrow();
  });
});
