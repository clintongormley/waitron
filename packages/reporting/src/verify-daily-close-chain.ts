import { asc, eq } from "drizzle-orm";
import { dailyCloseChain, dailyCloses } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { NodeId } from "@waitron/shared";
import { computeCloseEntryHash } from "./daily-close-hash.js";
import type { CloseHashContent } from "./daily-close-hash.js";
import type { DailyCloseSnapshot } from "./close-types.js";

/**
 * Why a `daily_closes` chain failed verification, and where. `sequence` is a contiguity gap (a
 * removed or inserted close); `genesis` is a first close whose `prev_entry_hash` is not "";
 * `broken_link` is a later close whose `prev_entry_hash` does not point at its predecessor's
 * `entry_hash`; `hash_mismatch` is a close whose stored `entry_hash` no longer recomputes from its
 * own frozen content (a tampered snapshot, a fabricated row). `tail_truncation` is the case the walk
 * over `daily_closes` alone is blind to — the most recent close(s) deleted, leaving the surviving
 * rows internally consistent — caught by cross-checking the `daily_close_chain` head, which records
 * the true tip. `missing_head` is the head row itself deleted while closes survive — a deletion of the
 * very authority the tail-truncation check relies on, which `recordDailyClose` (head + first close in
 * one transaction) never produces benignly.
 */
export type CloseChainBreakReason =
  "sequence" | "genesis" | "broken_link" | "hash_mismatch" | "tail_truncation" | "missing_head";

/**
 * The result of re-walking a whole node's close chain: `ok: true`, or the FIRST break with
 * the offending `brokenAt` sequence position and a stable English `reason`.
 */
export type DailyCloseChainVerification =
  { ok: true } | { ok: false; brokenAt: number; reason: CloseChainBreakReason };

/**
 * Re-walks a node's frozen-daily-close chain end to end and reports the FIRST break, or
 * `ok: true` if every close is contiguous, correctly linked, and reproduces its own hash. Read-only:
 * an audit, not a write-path check, so it returns a structured result rather than throwing.
 *
 * The closes are ordered by `sequence_no` (their chain POSITION), never by `business_day` or
 * `closed_at`: a close of a later day can be recorded before an earlier one. An inserted, removed
 * (from the middle), reordered, or content-edited close breaks at least one in-walk check.
 *
 * After the walk, the `daily_close_chain` head is cross-checked, because deleting the LAST close
 * leaves a perfectly consistent chain; `recordDailyClose` writes the close and advances the head in
 * ONE transaction, so the head always names the true tip, and the last walked close must match it.
 * An absent head is benign only when there are no closes either.
 */
export async function verifyDailyCloseChain(
  tx: Transaction,
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
    .where(eq(dailyCloses.nodeId, nodeId))
    .orderBy(asc(dailyCloses.sequenceNo));

  // The predecessor's stored hash — "" before the genesis close, exactly as `recordDailyClose` seeds
  // and `computeCloseEntryHash` hashes an empty predecessor for the first close.
  let expectedPrev = "";
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const expectedSeq = i + 1;

    // Contiguity: positions are 1-based and gap-free. `brokenAt` is the expected-but-missing
    // position, so a deleted close 2 of 1-2-3 reports `brokenAt: 2`.
    if (row.sequenceNo !== expectedSeq) {
      return { ok: false, brokenAt: expectedSeq, reason: "sequence" };
    }

    // The first close failing this is a bad genesis (`prev_entry_hash` ≠ ""); a later one is a
    // spliced or reordered link.
    if (row.prevEntryHash !== expectedPrev) {
      return { ok: false, brokenAt: row.sequenceNo, reason: i === 0 ? "genesis" : "broken_link" };
    }

    // An edit to the snapshot after the freeze, or a fabricated row, fails the hash recompute.
    const content: CloseHashContent = {
      nodeId,
      businessDay: row.businessDay,
      sequenceNo: row.sequenceNo,
      closedAt: row.closedAt,
      closedBy: row.closedBy,
      // `@waitron/db` types the column with its own structural `DailyCloseSnapshot` (`close:
      // unknown`), because db cannot import reporting; `recordDailyClose` stored this package's.
      snapshot: row.snapshot as DailyCloseSnapshot,
    };
    if (computeCloseEntryHash(content, row.prevEntryHash) !== row.entryHash) {
      return { ok: false, brokenAt: row.sequenceNo, reason: "hash_mismatch" };
    }

    expectedPrev = row.entryHash;
  }

  // After a clean walk, `rows.length` is the last close's `sequence_no` and `expectedPrev` is its
  // `entry_hash` ("" for an empty chain).
  const [head] = await tx
    .select({
      sequenceNo: dailyCloseChain.sequenceNo,
      lastEntryHash: dailyCloseChain.lastEntryHash,
    })
    .from(dailyCloseChain)
    .where(eq(dailyCloseChain.nodeId, nodeId));

  if (head === undefined) {
    // With surviving closes this is a tamper: the head and the first close are written in one
    // transaction. `brokenAt` is the surviving tip's `sequence_no`.
    if (rows.length > 0) {
      return { ok: false, brokenAt: rows.length, reason: "missing_head" };
    }
    return { ok: true };
  }

  if (rows.length !== head.sequenceNo || expectedPrev !== head.lastEntryHash) {
    // The head says the chain reaches `sequenceNo`; the rows fall short (deleted tip) or their tip
    // hash disagrees (a replaced tip). `brokenAt` is the true tip the chain should have reached.
    return { ok: false, brokenAt: head.sequenceNo, reason: "tail_truncation" };
  }

  return { ok: true };
}
