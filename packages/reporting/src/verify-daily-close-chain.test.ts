import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { recordDailyClose } from "./record-daily-close.js";
import { verifyDailyCloseChain } from "./verify-daily-close-chain.js";
import type { CashCountInput, DailyCloseRecord } from "./close-types.js";

// PGlite, deliberately — and the right target for the WALK. The re-walk (contiguity, genesis,
// broken-link, hash recomputation from the jsonb read-back) is deterministic logic over rows already
// committed; it does not turn on the non-superuser deployment role or on two writers contending —
// two of the things PGlite cannot show (CLAUDE.md §4). The break cases are crafted with
// raw INSERTs, which the append-only trigger does NOT guard (it is BEFORE UPDATE OR DELETE), so they
// need no privilege bypass. The verifier's teeth against a real mutation of a COMMITTED chain — a
// privileged UPDATE/DELETE that bypasses the app-role immutability — are proven on real Postgres in
// verify-daily-close-chain.pg.test.ts, where that bypass is the whole point. Mirrors
// record-daily-close.test.ts's split.

const CLOSED_BY = "cccccccc-0000-4000-8000-000000000001";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let venue: SeededVenue;
beforeEach(async () => {
  venue = await seedVenue(suite.db);
});

function record(businessDay: string, cashCounts: CashCountInput[]): Promise<DailyCloseRecord> {
  return withTenant(suite.db, venue.tenantId, async (tx) => {
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

// Verify under the app role with an explicit tenant id — the shape a caller (Task 5's demo) uses, which also
// proves app_user's SELECT grant is enough to re-walk the chain.
function verify() {
  return withTenant(suite.db, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    return verifyDailyCloseChain(tx, venue.tenantId, venue.nodeId);
  });
}

// A structurally-valid snapshot for a crafted row whose CONTENT is never reached by the assertion
// under test (a genesis/link/sequence break is caught before the hash recompute, so it need not
// reproduce entry_hash). Only the hash-mismatch case relies on it not reproducing a chosen digest,
// which any fixed literal does.
const SNAPSHOT = JSON.stringify({
  close: {},
  cashReconciliation: { byTill: [], nodeVariance: "0.00" },
});

/** Owner INSERT of one close row. INSERT is not what
 * the append-only trigger guards, so no bypass is needed; this is how a break is staged without
 * mutating a committed row. */
function craftClose(opts: {
  businessDay: string;
  sequenceNo: number;
  prevEntryHash: string;
  entryHash: string;
}): Promise<unknown> {
  return suite.db.execute(sql`
    insert into daily_closes (
      tenant_id, node_id, business_day, sequence_no,
      prev_entry_hash, entry_hash, closed_by, snapshot
    ) values (
      ${venue.tenantId}, ${venue.nodeId}, ${opts.businessDay}, ${opts.sequenceNo},
      ${opts.prevEntryHash}, ${opts.entryHash}, ${CLOSED_BY}, ${SNAPSHOT}::jsonb
    )`);
}

describe("verifyDailyCloseChain — the chain re-walk", () => {
  it("passes a well-formed two-close chain (the entry_hash reproduces from the jsonb read-back)", async () => {
    await record("2026-08-04", []);
    await record("2026-08-05", []);
    expect(await verify()).toEqual({ ok: true });
  });

  it("passes a (tenant, node) that has never closed (vacuously ok)", async () => {
    expect(await verify()).toEqual({ ok: true });
  });

  it("detects a non-empty genesis predecessor", async () => {
    // The first close of a chain must carry prev_entry_hash = "". Craft one that does not.
    await craftClose({
      businessDay: "2026-08-04",
      sequenceNo: 1,
      prevEntryHash: "F".repeat(64), // should be "" for the genesis close
      entryHash: "A".repeat(64),
    });
    expect(await verify()).toEqual({ ok: false, brokenAt: 1, reason: "genesis" });
  });

  it("detects a broken predecessor link", async () => {
    // A valid genesis close, then a second whose prev_entry_hash does NOT point at close 1's
    // entry_hash — the splice/reorder signature. The link check fires before the hash recompute, so
    // close 2's own entry_hash is never examined.
    const first = await record("2026-08-04", []);
    expect(first.prevEntryHash).toBe(""); // guard: close 1 really is a valid genesis
    await craftClose({
      businessDay: "2026-08-05",
      sequenceNo: 2,
      prevEntryHash: "0".repeat(64), // ≠ first.entryHash
      entryHash: "B".repeat(64),
    });
    expect(await verify()).toEqual({ ok: false, brokenAt: 2, reason: "broken_link" });
  });

  it("detects a sequence gap left by a removed close", async () => {
    // Close 1 valid, then skip sequence 2 and craft sequence 3 with a CORRECT link, so only
    // contiguity is violated — the break reported is the expected-but-missing position, 2.
    const first = await record("2026-08-04", []);
    await craftClose({
      businessDay: "2026-08-06",
      sequenceNo: 3,
      prevEntryHash: first.entryHash,
      entryHash: "C".repeat(64),
    });
    expect(await verify()).toEqual({ ok: false, brokenAt: 2, reason: "sequence" });
  });

  it("detects an entry_hash that no longer recomputes from the row's content", async () => {
    // Correct position and link, but an entry_hash that is not SHA-256 of this row's frozen content,
    // so the walk reaches the hash check and fails it.
    const first = await record("2026-08-04", []);
    await craftClose({
      businessDay: "2026-08-05",
      sequenceNo: 2,
      prevEntryHash: first.entryHash, // link OK → the walk reaches the hash check
      entryHash: "D".repeat(64), // not the digest of this row's content
    });
    expect(await verify()).toEqual({ ok: false, brokenAt: 2, reason: "hash_mismatch" });
  });

  it("detects tail truncation: the head records more closes than survive", async () => {
    // Two valid closes leave the head at sequence_no = 2. Advance the head as if a THIRD close had
    // been recorded and its row then deleted — the surviving rows [1, 2] walk clean, so ONLY the head
    // cross-check catches that the tip is gone. `daily_close_chain` is the mutable head (no
    // append-only trigger), so a plain UPDATE stages this.
    await record("2026-08-04", []);
    await record("2026-08-05", []);
    await suite.db.execute(sql`
      update daily_close_chain set sequence_no = 3, last_entry_hash = ${"F".repeat(64)}
       where tenant_id = ${venue.tenantId} and node_id = ${venue.nodeId}`);
    expect(await verify()).toEqual({ ok: false, brokenAt: 3, reason: "tail_truncation" });
  });

  it("detects a head whose recorded tip hash disagrees with the surviving last close", async () => {
    // Row count matches the head (both say 2), so the shortfall check on length passes — but the
    // head's last_entry_hash no longer equals close 2's entry_hash, the signature of a tip replaced
    // under a reused sequence number. Exercises the hash arm of the head cross-check.
    await record("2026-08-04", []);
    await record("2026-08-05", []);
    await suite.db.execute(sql`
      update daily_close_chain set last_entry_hash = ${"E".repeat(64)}
       where tenant_id = ${venue.tenantId} and node_id = ${venue.nodeId}`);
    expect(await verify()).toEqual({ ok: false, brokenAt: 2, reason: "tail_truncation" });
  });
});
