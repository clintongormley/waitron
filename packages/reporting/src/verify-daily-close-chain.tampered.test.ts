/**
 * `verifyDailyCloseChain` catches a committed chain that was tampered with after it was frozen.
 *
 * ## What this suite was
 *
 * It ran against real PostgreSQL through `useTemplateDb` and corrupted the chain with the trigger
 * disabled. PostgreSQL has `ALTER TABLE … DISABLE TRIGGER`; SQLite has no such statement, so
 * {@link bypassingImmutability} drops each of `daily_closes`' two append-only triggers, mutates,
 * and recreates each one from the exact `CREATE TRIGGER` text SQLite stored for it — the same
 * mechanism, and for the same stated reason, as `buildResetPlan`/`applyReset` in
 * `packages/db/src/testing/venue-db.ts`. There is no `ENABLE ALWAYS` to restore afterwards: that
 * flag existed so a replication apply worker could not skip the trigger, and there is no
 * replication here.
 *
 * The four subjects below are unchanged: an edited snapshot, a deleted middle close, a deleted tip,
 * and a deleted head. `daily_close_chain` is NOT append-only
 * (`packages/db/src/classification.ts:26` classifies it without `appendOnly`), so the last of them
 * deletes the head directly and needs no bypass — on PostgreSQL it went through the same helper
 * only because that helper was the file's one mutation path.
 *
 * Named for what separates it from the sibling `verify-daily-close-chain.test.ts`: every break here
 * is staged by mutating rows `recordDailyClose` itself wrote, with `daily_closes`' append-only
 * triggers dropped ({@link bypassingImmutability}); that file crafts its breaks with raw INSERTs,
 * drops no trigger, and is where the pure row-walk cases live.
 */
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, dailyCloseChain, dailyCloses, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { recordDailyClose } from "./record-daily-close.js";
import { verifyDailyCloseChain } from "./verify-daily-close-chain.js";
import type { CashCountInput, DailyCloseRecord } from "./close-types.js";

const CLOSED_BY = "cccccccc-0000-4000-8000-000000000001";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

let venue: SeededVenue;
// A fresh venue per test; `useVenueDb`'s reset empties the append-only tables between tests by
// dropping and recreating their triggers, so each test starts from an empty database.
beforeEach(async () => {
  venue = await seedVenue(suite.db);
});

function record(businessDay: string, cashCounts: CashCountInput[]): Promise<DailyCloseRecord> {
  return withTransaction(suite.db, (tx) =>
    recordDailyClose(tx, {
      nodeId: venue.nodeId,
      businessDay,
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
      closedBy: CLOSED_BY,
      cashCounts,
    }),
  );
}

function verify() {
  return withTransaction(suite.db, (tx) => verifyDailyCloseChain(tx, venue.nodeId));
}

/**
 * Mutates `daily_closes` with its append-only triggers out of the way, then puts them back exactly
 * as they were found — the tamper an attacker with write access would perform, staged so the test
 * can then ask the verifier about it.
 *
 * The drop, the mutation and the recreate share ONE transaction, so a failing mutation rolls the
 * dropped triggers back in with it and the next test still meets a protected table. Each trigger is
 * recreated from its own `sqlite_master.sql` text rather than from a statement written here: the
 * text is what SQLite needs to rebuild it, and replaying it verbatim is the only way to be sure the
 * table is left as it was found.
 *
 * Control, run 2026-09-22: with the drop loop removed and everything else the same, the three
 * mutating cases fail with `Error: daily_closes is append-only` — so the triggers are live and this
 * helper is doing something, rather than stepping around protection that was never installed.
 */
async function bypassingImmutability(mutate: (tx: Transaction) => Promise<unknown>): Promise<void> {
  await suite.db.transaction(async (tx) => {
    const triggers = (tx as Database).all<{ name: string; sql: string }>(sql`
      select name, sql from sqlite_master
      where type = 'trigger' and tbl_name = 'daily_closes'`);
    // A table whose triggers were never installed would make every case below pass for the wrong
    // reason — the mutation would simply succeed and the bypass would be doing nothing.
    expect(triggers.map((t) => t.name).sort()).toEqual([
      "daily_closes_append_only_delete",
      "daily_closes_append_only_update",
    ]);
    for (const trigger of triggers) tx.run(sql.raw(`drop trigger "${trigger.name}"`));
    await mutate(tx);
    for (const trigger of triggers) tx.run(sql.raw(trigger.sql));
  });
}

describe("verifyDailyCloseChain against a tampered committed chain", () => {
  it("catches a snapshot edited after the close was frozen", async () => {
    await record("2026-08-04", []);
    const second = await record("2026-08-05", []);
    expect(await verify()).toEqual({ ok: true }); // control: the intact chain verifies

    // Rewrite close 2's frozen snapshot. entry_hash is left untouched, so it no longer recomputes.
    // Read-mutate-write through the column's own mapping rather than through a JSON function: the
    // column is `text(..., { mode: "json" })` (`packages/db/src/schema/columns.ts:84`), so what
    // Drizzle writes back is `JSON.stringify` of this object — the same encoding the close was
    // stored with. `jsonb_set`, which this case used on PostgreSQL, has no counterpart that is
    // guaranteed to reproduce that encoding.
    await bypassingImmutability(async (tx) => {
      const [row] = await tx
        .select({ snapshot: dailyCloses.snapshot })
        .from(dailyCloses)
        .where(eq(dailyCloses.id, second.id));
      const tampered = {
        ...row!.snapshot,
        cashReconciliation: { ...row!.snapshot.cashReconciliation, nodeVariance: "999.99" },
      };
      return tx
        .update(dailyCloses)
        .set({ snapshot: tampered })
        .where(eq(dailyCloses.id, second.id));
    });

    expect(await verify()).toEqual({ ok: false, brokenAt: 2, reason: "hash_mismatch" });
  });

  it("catches a middle close deleted from the chain", async () => {
    await record("2026-08-04", []);
    const second = await record("2026-08-05", []);
    await record("2026-08-06", []);
    expect(await verify()).toEqual({ ok: true }); // control: 1-2-3 intact

    await bypassingImmutability((tx) =>
      tx.delete(dailyCloses).where(eq(dailyCloses.id, second.id)),
    );

    // The chain is now [1, 3]: the walk expects 2 at the second position and finds 3.
    expect(await verify()).toEqual({ ok: false, brokenAt: 2, reason: "sequence" });
  });

  it("catches the LATEST close deleted (tail truncation the row walk cannot see)", async () => {
    // The gap a `daily_closes`-only walk is blind to: delete the tip and the survivors [1, 2] are a
    // perfectly consistent chain. Only the head — advanced in the SAME transaction as the close, so
    // it still records sequence_no = 3 / last_entry_hash = <hash 3> — reveals the shortfall.
    await record("2026-08-04", []);
    await record("2026-08-05", []);
    const third = await record("2026-08-06", []);
    expect(await verify()).toEqual({ ok: true }); // control: 1-2-3 intact

    await bypassingImmutability((tx) => tx.delete(dailyCloses).where(eq(dailyCloses.id, third.id)));

    // The rows [1, 2] walk clean; the head still says the tip is 3.
    expect(await verify()).toEqual({ ok: false, brokenAt: 3, reason: "tail_truncation" });
  });

  it("catches the chain head itself deleted while closes survive", async () => {
    // The tail-truncation check leans on the head as its authority; delete the head AND the head
    // cross-check has nothing to compare against — the survivors [1, 2] walk clean and would report
    // ok. But because `recordDailyClose` writes the head and the first close in ONE transaction,
    // closes-without-head never occurs naturally, so it is unambiguously a tamper.
    await record("2026-08-04", []);
    await record("2026-08-05", []);
    expect(await verify()).toEqual({ ok: true }); // control: head present, chain intact

    // No bypass: `daily_close_chain` is a mutable head row, not an append-only table.
    await suite.db.delete(dailyCloseChain).where(eq(dailyCloseChain.nodeId, venue.nodeId));

    // `brokenAt` is the surviving tip's sequence_no.
    expect(await verify()).toEqual({ ok: false, brokenAt: 2, reason: "missing_head" });
  });
});
