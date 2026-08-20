import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { recordDailyClose } from "./record-daily-close.js";
import { verifyDailyCloseChain } from "./verify-daily-close-chain.js";
import type { CashCountInput, DailyCloseRecord } from "./close-types.js";

// Real PostgreSQL via Testcontainers — deliberately NOT skipped when Docker is unavailable (the
// package's vitest `globalSetup` throws when Docker is absent rather than degrading to a skip). Both
// assertions turn on a mutation
// that bypasses the app-role immutability: `daily_closes` is append-only under app_user (REVOKE
// UPDATE/DELETE) AND behind an append-only trigger, so the only way to tamper with or delete a
// COMMITTED close is a privileged actor who can disable that trigger (session_replication_role =
// replica is superuser-only). This suite proves the verifier catches exactly that — a real edit /
// real deletion of a real committed chain flips ok:true → ok:false. On PGlite this proves nothing
// new: the pure walk over crafted rows already lives in verify-daily-close-chain.test.ts; what is
// real-Postgres-only is that the break here is a genuine privileged mutation of an otherwise-valid
// chain (CLAUDE.md §4). Mirrors record-daily-close.rls.test.ts's split.

const CLOSED_BY = "cccccccc-0000-4000-8000-000000000001";

const suite = useTemplateDb({ template: "core" });

let venue: SeededVenue;
// A FRESH tenant/node/chain per test (seedVenue mints a new tenant): daily_closes is append-only and
// un-truncatable, so each test writes into its own chain rather than cleaning up.
beforeEach(async () => {
  venue = await seedVenue(suite.admin);
});

function record(businessDay: string, cashCounts: CashCountInput[]): Promise<DailyCloseRecord> {
  return withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    return recordDailyClose(tx, {
      tenantId: venue.tenantId,
      nodeId: venue.nodeId,
      businessDay,
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
      closedBy: CLOSED_BY,
      cashCounts,
    });
  });
}

// Verify under the real app role + tenant GUC — the exact shape a caller (Task 5's demo) uses, which
// also proves app_user's SELECT grant is enough to re-walk the chain under FORCE row-level security.
function verify() {
  return withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    return verifyDailyCloseChain(tx, venue.tenantId, venue.nodeId);
  });
}

/** Runs `mutate` with the append-only trigger disabled for the transaction — the privileged path a
 * tamperer needs (session_replication_role = replica is superuser-only and reverts at commit). This
 * is what makes the UPDATE/DELETE possible AT ALL; the point of each test is that the verifier still
 * catches its effect afterwards. */
function bypassingImmutability(mutate: (tx: Transaction) => Promise<unknown>): Promise<void> {
  return suite.admin.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    await mutate(tx);
  });
}

describe("verifyDailyCloseChain against a tampered committed chain (real Postgres)", () => {
  it("catches a snapshot edited after the close was frozen", async () => {
    await record("2026-08-04", []);
    const second = await record("2026-08-05", []);
    expect(await verify()).toEqual({ ok: true }); // control: the intact chain verifies

    // Rewrite close 2's frozen snapshot. entry_hash is left untouched, so it no longer recomputes.
    await bypassingImmutability((tx) =>
      tx.execute(sql`
        update daily_closes
           set snapshot = jsonb_set(snapshot, '{cashReconciliation,nodeVariance}', '"999.99"')
         where id = ${second.id}`),
    );

    expect(await verify()).toEqual({ ok: false, brokenAt: 2, reason: "hash_mismatch" });
  });

  it("catches a middle close deleted from the chain", async () => {
    await record("2026-08-04", []);
    const second = await record("2026-08-05", []);
    await record("2026-08-06", []);
    expect(await verify()).toEqual({ ok: true }); // control: 1-2-3 intact

    await bypassingImmutability((tx) =>
      tx.execute(sql`delete from daily_closes where id = ${second.id}`),
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

    await bypassingImmutability((tx) =>
      tx.execute(sql`delete from daily_closes where id = ${third.id}`),
    );

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

    await bypassingImmutability((tx) =>
      tx.execute(
        sql`delete from daily_close_chain where tenant_id = ${venue.tenantId} and node_id = ${venue.nodeId}`,
      ),
    );

    // `brokenAt` is the surviving tip's sequence_no.
    expect(await verify()).toEqual({ ok: false, brokenAt: 2, reason: "missing_head" });
  });
});
