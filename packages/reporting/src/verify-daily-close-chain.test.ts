import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, dailyCloses, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { recordDailyClose } from "./record-daily-close.js";
import { verifyDailyCloseChain } from "./verify-daily-close-chain.js";
import type { CashCountInput, DailyCloseRecord, DailyCloseSnapshot } from "./close-types.js";

// The break cases are staged with INSERTs, which the append-only triggers (on update and delete)
// do not refuse. Mutations of a committed chain are in verify-daily-close-chain.tampered.test.ts.

const CLOSED_BY = "cccccccc-0000-4000-8000-000000000001";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let venue: SeededVenue;
beforeEach(async () => {
  venue = await seedVenue(suite.db);
});

function record(businessDay: string, cashCounts: CashCountInput[]): Promise<DailyCloseRecord> {
  return withTransaction(suite.db, async (tx) => {
    return recordDailyClose(tx, {
      nodeId: venue.nodeId,
      businessDay,
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
      closedBy: CLOSED_BY,
      cashCounts,
    });
  });
}

function verify() {
  return withTransaction(suite.db, async (tx) => {
    return verifyDailyCloseChain(tx, venue.nodeId);
  });
}

// A structurally valid snapshot for a crafted row; a genesis, link or sequence break is caught
// before the hash recompute. It is the OBJECT, not its text: the `json` column serialises its own
// value, so a string would be stored as a JSON string rather than a document.
const SNAPSHOT = {
  close: {},
  cashReconciliation: { byTill: [], nodeVariance: "0.00" },
} as unknown as DailyCloseSnapshot;

/** INSERT of one close row, through the table definition: `daily_closes.id` comes from a
 * JavaScript `$defaultFn` that a raw INSERT never reaches. */
function craftClose(opts: {
  businessDay: string;
  sequenceNo: number;
  prevEntryHash: string;
  entryHash: string;
}): Promise<unknown> {
  return suite.db.insert(dailyCloses).values({
    nodeId: venue.nodeId,
    businessDay: opts.businessDay,
    sequenceNo: opts.sequenceNo,
    prevEntryHash: opts.prevEntryHash,
    entryHash: opts.entryHash,
    closedBy: CLOSED_BY,
    snapshot: SNAPSHOT,
  });
}

describe("verifyDailyCloseChain — the chain re-walk", () => {
  it("passes a well-formed two-close chain (the entry_hash reproduces from the jsonb read-back)", async () => {
    await record("2026-08-04", []);
    await record("2026-08-05", []);
    expect(await verify()).toEqual({ ok: true });
  });

  it("passes a node that has never closed (vacuously ok)", async () => {
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
    // A second close whose prev_entry_hash does NOT point at close 1's entry_hash. The link check
    // fires before the hash recompute, so close 2's own entry_hash is never examined.
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
    // Advance the head as if a THIRD close had been recorded and its row then deleted: the surviving
    // rows [1, 2] walk clean, so ONLY the head cross-check catches it. `daily_close_chain` has no
    // append-only trigger, so a plain UPDATE stages this.
    await record("2026-08-04", []);
    await record("2026-08-05", []);
    await suite.db.execute(sql`
      update daily_close_chain set sequence_no = 3, last_entry_hash = ${"F".repeat(64)}
       where node_id = ${venue.nodeId}`);
    expect(await verify()).toEqual({ ok: false, brokenAt: 3, reason: "tail_truncation" });
  });

  it("detects a head whose recorded tip hash disagrees with the surviving last close", async () => {
    // Row count matches the head (both say 2), but the head's last_entry_hash no longer equals close
    // 2's entry_hash: a tip replaced under a reused sequence number.
    await record("2026-08-04", []);
    await record("2026-08-05", []);
    await suite.db.execute(sql`
      update daily_close_chain set last_entry_hash = ${"E".repeat(64)}
       where node_id = ${venue.nodeId}`);
    expect(await verify()).toEqual({ ok: false, brokenAt: 2, reason: "tail_truncation" });
  });
});
