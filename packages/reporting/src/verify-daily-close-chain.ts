import { and, asc, eq } from "drizzle-orm";
import { dailyCloses } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { NodeId, TenantId } from "@waitron/shared";
import { computeCloseEntryHash } from "./daily-close-hash.js";
import type { CloseHashContent } from "./daily-close-hash.js";
import type { DailyCloseSnapshot } from "./close-types.js";

/**
 * Why a `daily_closes` chain failed verification, and where. `sequence` is a contiguity gap (a
 * removed or inserted close); `genesis` is a first close whose `prev_entry_hash` is not "";
 * `broken_link` is a later close whose `prev_entry_hash` does not point at its predecessor's
 * `entry_hash`; `hash_mismatch` is a close whose stored `entry_hash` no longer recomputes from its
 * own frozen content (a tampered snapshot, a fabricated row). English tokens — this chain is generic
 * (`entry_hash`/`prev_entry_hash`/`sequence_no`), unlike the fiscal chain's regime vocabulary.
 */
export type CloseChainBreakReason = "sequence" | "genesis" | "broken_link" | "hash_mismatch";

/**
 * The result of re-walking a whole `(tenant, node)` close chain: `ok: true`, or the FIRST break with
 * the offending `brokenAt` sequence position and a stable English `reason`. Mirrors the workforce
 * time-entry `ChainVerification` shape (`packages/workforce/src/chain-hash.ts`).
 */
export type DailyCloseChainVerification =
  { ok: true } | { ok: false; brokenAt: number; reason: CloseChainBreakReason };

/**
 * Re-walks a `(tenant, node)` frozen-daily-close chain end to end and reports the FIRST break, or
 * `ok: true` if every close is contiguous, correctly linked, and reproduces its own hash. Read-only:
 * an inspector's / demo's audit, NOT the sale-time predecessor check the fiscal chain runs — so it
 * takes no lock and returns a structured result rather than throwing.
 *
 * The closes are ordered by `sequence_no` (their chain POSITION), never by `business_day` or
 * `closed_at`: the sequence is what the chain is defined by, and a close of a later day can be
 * recorded before an earlier one. The four checks are the workforce/fiscal precedent
 * (`packages/workforce/src/chain-hash.ts`'s `verifyChain`): an inserted, removed, reordered, or
 * content-edited close breaks at least one. A never-closed `(tenant, node)` returns `ok: true`
 * vacuously — the empty walk falls straight through, which is correct: a fresh node's chain is not
 * broken, it is unstarted.
 */
export async function verifyDailyCloseChain(
  tx: Transaction,
  tenantId: TenantId,
  nodeId: NodeId,
): Promise<DailyCloseChainVerification> {
  const rows = await tx
    .select({
      businessDay: dailyCloses.businessDay,
      sequenceNo: dailyCloses.sequenceNo,
      prevEntryHash: dailyCloses.prevEntryHash,
      entryHash: dailyCloses.entryHash,
      closedAt: dailyCloses.closedAt,
      closedBy: dailyCloses.closedBy,
      snapshot: dailyCloses.snapshot,
    })
    .from(dailyCloses)
    .where(and(eq(dailyCloses.tenantId, tenantId), eq(dailyCloses.nodeId, nodeId)))
    .orderBy(asc(dailyCloses.sequenceNo));

  // The predecessor's stored hash — "" before the genesis close, exactly as `recordDailyClose` seeds
  // and `computeCloseEntryHash` hashes an empty predecessor for the first close.
  let expectedPrev = "";
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const expectedSeq = i + 1;

    // 1. Contiguity: positions are ours, 1-based and gap-free (`recordDailyClose` assigns head + 1).
    //    A gap or a duplicate — what a removed or inserted close leaves — fails here. `brokenAt` is
    //    the expected-but-missing position, so a deleted close 2 of 1-2-3 reports `brokenAt: 2`.
    if (row.sequenceNo !== expectedSeq) {
      return { ok: false, brokenAt: expectedSeq, reason: "sequence" };
    }

    // 2/3. The predecessor pointer must equal the previous close's stored `entry_hash` — "" before
    //      the genesis. The first close failing this is a bad genesis (`prev_entry_hash` ≠ ""); a
    //      later one is a spliced or reordered link.
    if (row.prevEntryHash !== expectedPrev) {
      return { ok: false, brokenAt: row.sequenceNo, reason: i === 0 ? "genesis" : "broken_link" };
    }

    // 4. The stored `entry_hash` must reproduce from the close's own frozen content — an edit to the
    //    snapshot after the freeze, or a fabricated row, fails here. The read-back `snapshot`
    //    (jsonb) is passed straight in: `computeCloseEntryHash` key-sorts it internally, so a jsonb
    //    key reordering does not matter, and `closed_at` is already whole-second (`recordDailyClose`
    //    truncates before storing), so the recompute matches. The content is reconstructed from the
    //    row's columns exactly as `recordDailyClose` built it.
    const content: CloseHashContent = {
      tenantId,
      nodeId,
      businessDay: row.businessDay,
      sequenceNo: row.sequenceNo,
      closedAt: row.closedAt,
      closedBy: row.closedBy,
      // `@waitron/db` types the jsonb column with its OWN structural `DailyCloseSnapshot` (`close:
      // unknown`); this package owns the precise one (`close: DailyClose`). `recordDailyClose` stored
      // a reporting snapshot, so the read-back IS one — this assertion restores the precise type db
      // cannot name (db depends on reporting, not the reverse). `computeCloseEntryHash` treats the
      // whole snapshot opaquely (key-sort + stringify), so even the imprecise type would hash the same.
      snapshot: row.snapshot as DailyCloseSnapshot,
    };
    if (computeCloseEntryHash(content, row.prevEntryHash) !== row.entryHash) {
      return { ok: false, brokenAt: row.sequenceNo, reason: "hash_mismatch" };
    }

    expectedPrev = row.entryHash;
  }

  return { ok: true };
}
