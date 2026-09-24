/**
 * `verifyDailyCloseChain` catches a committed chain that was tampered with after it was frozen.
 * Every break here mutates rows `recordDailyClose` itself wrote, with `daily_closes`' append-only
 * triggers dropped ({@link bypassingImmutability}); the sibling `verify-daily-close-chain.test.ts`
 * stages its breaks with INSERTs.
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
 * Mutates `daily_closes` with its append-only triggers dropped, then recreates each from its own
 * `sqlite_master.sql` text, so the table is left as it was found. The drop, the mutation and the
 * recreate share ONE transaction, so a failing mutation rolls the dropped triggers back with it.
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

    // Rewrite close 2's frozen snapshot, leaving entry_hash untouched. Read-mutate-write through the
    // column's own mapping, so the tampered value is stored in the same encoding as the original.
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
    // Delete the tip and the survivors [1, 2] are a consistent chain; only the head, which still
    // records sequence_no = 3, reveals the shortfall.
    await record("2026-08-04", []);
    await record("2026-08-05", []);
    const third = await record("2026-08-06", []);
    expect(await verify()).toEqual({ ok: true }); // control: 1-2-3 intact

    await bypassingImmutability((tx) => tx.delete(dailyCloses).where(eq(dailyCloses.id, third.id)));

    // The rows [1, 2] walk clean; the head still says the tip is 3.
    expect(await verify()).toEqual({ ok: false, brokenAt: 3, reason: "tail_truncation" });
  });

  it("catches the chain head itself deleted while closes survive", async () => {
    // Without the head the survivors [1, 2] walk clean; `recordDailyClose` writes the head and the
    // first close in ONE transaction, so closes without a head are a tamper.
    await record("2026-08-04", []);
    await record("2026-08-05", []);
    expect(await verify()).toEqual({ ok: true }); // control: head present, chain intact

    // No bypass: `daily_close_chain` is a mutable head row, not an append-only table.
    await suite.db.delete(dailyCloseChain).where(eq(dailyCloseChain.nodeId, venue.nodeId));

    // `brokenAt` is the surviving tip's sequence_no.
    expect(await verify()).toEqual({ ok: false, brokenAt: 2, reason: "missing_head" });
  });
});
