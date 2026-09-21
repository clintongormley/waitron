// Side-effect: registers this package's `attendance.append_contention` code on the shared
// ErrorParams registry (declaration merging). See ./errors.ts and ./errors.reachability.test.ts.
import "./errors.js";
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { isUniqueViolation, type Database, type Transaction } from "@waitron/db";
import { computeEntryHash, type VerifiableEntry } from "./chain-hash.js";
import { timeEntries } from "./schema/time-entries.js";
import { workforceChains } from "./schema/workforce-chains.js";
import type { WorkforceEntryKind } from "./projection.js";

/**
 * Three, not one and not ten (fiscal chain.ts's reasoning, applied to the workforce chain). One is
 * not a retry. Ten converts a genuine duplicate — a real bug — into ten pointless round trips.
 *
 * The window this retry was written for was two writers racing to CREATE a head row that did not
 * yet exist and so could not be locked. There is no such race left: one write transaction runs on
 * the venue file at a time ({@link selectHead}), so nothing this code writes can lose that race any
 * more.
 *
 * The retry and its savepoint stay because the refusal they were built to survive is still
 * possible: `time_entries_chain_position_uq` refuses a chain position whatever occupies it, and a
 * position can be occupied by a row this code did not write. Whether any such path exists today is
 * NOT established here — I did not run one — so treat the retry as the shape that confines such a
 * refusal to one attempt, not as evidence that something reaches it.
 */
const MAX_APPEND_ATTEMPTS = 3;

/** The chain key — one chain per (node, location) (spec §2.1). Passed to `appendToChain`,
 * `readChainHead` and `readChain` rather than positional strings, so a caller cannot transpose the
 * node and location. */
export interface ChainKey {
  nodeId: string;
  locationId: string;
}

/** One entry's content, MINUS the chain fields — `sequence_no`/`entry_hash`/`prev_entry_hash`/
 * `is_first_entry` are derived from the chain head, so they are computed inside `appendToChain`
 * and never supplied by the caller. `node_id`/`location_id` travel in the `ChainKey`, and
 * `recorded_at` is stamped by the append from its clock — none of them are supplied here. */
export interface TimeEntryAppend {
  personId: string;
  entryKind: WorkforceEntryKind;
  eventAt: string;
  eventOffsetMinutes: number;
  recordedByPersonId: string;
  capturedByTillId?: string | null;
  correctsEntryId?: string | null;
  correctionReason?: string | null;
  correctionStatus?: "requested" | "approved" | null;
  correctionActorId?: string | null;
}

export interface ChainHead {
  sequenceNo: number;
  lastEntryId: string | null;
  lastEntryHash: string | null;
  /** The high-water mark that keeps `recorded_at` monotonic per chain (spec §4.1) — null exactly when
   * the pointer is. */
  lastRecordedAt: string | null;
}

/**
 * The chain head for this (node, location), or `undefined` when it has none yet.
 *
 * This was `selectHeadForUpdate`, and it took `for update` on the head row: the sequence number
 * read here is used to compute the NEXT one several statements later, so a second append reading
 * the same head would compute the same position. One write transaction runs on the venue file at a
 * time, so there is no second append to overlap with — the pattern is stated once, with its
 * measurement and its control, on `assertExtraListForWrite` (`packages/catalogue/src/extras.ts`).
 * Renamed with the clause: a function named for a lock it does not take is a false claim.
 *
 * What the lock never was is the chain's safety. `time_entries_chain_position_uq` on
 * `(node_id, location_id, sequence_no)` is, and it refuses a forked position whatever wrote it —
 * measured on this engine by the `rejects a second entry claiming an occupied chain position` case
 * in `chain.test.ts`, which inserts the fork WITHOUT going through this file.
 */
async function selectHead(tx: Transaction, key: ChainKey): Promise<ChainHead | undefined> {
  const [row] = await tx
    .select({
      sequenceNo: workforceChains.sequenceNo,
      lastEntryId: workforceChains.lastEntryId,
      lastEntryHash: workforceChains.lastEntryHash,
      lastRecordedAt: workforceChains.lastRecordedAt,
    })
    .from(workforceChains)
    .where(
      and(eq(workforceChains.nodeId, key.nodeId), eq(workforceChains.locationId, key.locationId)),
    );
  return row;
}

/**
 * The chain head for this (node, location), creating it if there is none yet.
 *
 * `insert ... on conflict do nothing` then a re-select, not an upsert-returning. On PostgreSQL that
 * shape was about a concurrent uncommitted insert; here it is the plain read-back of whichever row
 * exists. Exported separately from `appendToChain` because it is the seam a future chain verifier
 * reads the head through.
 *
 * This was `lockChainHead` and it took no lock of its own — {@link selectHead} did, and that clause
 * is gone for the reason stated there. Renamed with it.
 */
export async function readChainHead(tx: Transaction, key: ChainKey): Promise<ChainHead> {
  const existing = await selectHead(tx, key);
  if (existing !== undefined) return existing;

  await tx
    .insert(workforceChains)
    .values({ nodeId: key.nodeId, locationId: key.locationId })
    .onConflictDoNothing({ target: [workforceChains.nodeId, workforceChains.locationId] });

  const created = await selectHead(tx, key);
  /* v8 ignore start */
  if (created === undefined) {
    // Unreachable in practice: the insert above commits a fresh row or a concurrent transaction's
    // insert wins the conflict and commits one; the re-select then locks whichever exists. Left in
    // rather than `!`-asserted so a broken invariant surfaces as a structured AppError, not a
    // TypeError.
    throw new AppError("attendance.append_contention", { ...key, attempts: 0 });
  }
  /* v8 ignore stop */
  return created;
}

/**
 * Floors an ISO-8601 instant to whole-second granularity, preserving the instant (epoch ms), and
 * returns it as a UTC `…Z` string. `Date.prototype.toISOString` always emits milliseconds, so the
 * fractional second is present but ZERO (`…00.000Z`, never a truncated `…00Z`) — the truncation
 * removes any sub-second VALUE, not the field. That zero fractional second is immaterial downstream:
 * `Date.parse` (the hash's `EventAtMs`) and the second-precision read-back (`to_char(… 'HH24:MI:SS')`)
 * both collapse `…00.000Z` and a bare `…00Z` to the identical instant, and the DB CHECK
 * `date_trunc('second', event_at) = event_at` treats `…00.000Z` as a whole second.
 *
 * The chain hashes `event_at` as the absolute instant (chain-hash.ts's `EventAtMs`), but every
 * read-back projects it at SECOND precision (`to_char(… 'HH24:MI:SS')`, clocking.ts / the chain
 * test read-backs). Truncating here, at the single write choke point, is what keeps the stored
 * column, the committed hash and the read-back one identical representation — so a millisecond-
 * precision trusted clock cannot make a genuine, untouched row recompute to a different hash (a
 * false `hash_mismatch`). Mirrors the fiscal precedent: verifactu/src/format.ts's `formatDateTime`
 * always emits whole seconds, the single canonical form for both the hashed literal and its
 * reconstruction. `Math.floor` matches Postgres `date_trunc('second', …)` for the (always positive)
 * instants the working-time record captures, and the DB CHECK `time_entries_event_at_second_ck`
 * backstops it.
 */
function truncateToWholeSecond(eventAt: string): string {
  return new Date(Math.floor(Date.parse(eventAt) / 1000) * 1000).toISOString();
}

async function attemptAppend(
  tx: Transaction,
  key: ChainKey,
  entry: TimeEntryAppend,
  clock: () => Date,
): Promise<{ id: string; sequenceNo: number; entryHash: string }> {
  const head = await readChainHead(tx, key);
  const sequenceNo = head.sequenceNo + 1;
  const isFirstEntry = head.lastEntryId === null;
  const prevEntryHash = head.lastEntryHash;

  // ONE truncation each, feeding BOTH the hash and the stored column, so clock events and corrections
  // are all covered here and the three representations can never diverge (whole-branch review fix).
  const eventAt = truncateToWholeSecond(entry.eventAt);
  // `recorded_at` is clamped to the chain's high-water mark, read from the head above: a wall clock
  // that steps backward (NTP, an operator edit) still yields a non-decreasing `recorded_at` per
  // chain, so the cross-node precedence order reduces to today's `sequence_no` order within one
  // chain (spec §4.1). What keeps the head read and this write from being interleaved is no longer
  // a row lock on the head — see `selectHead`.
  const nowMs = clock().getTime();
  const clampedMs =
    head.lastRecordedAt === null ? nowMs : Math.max(nowMs, Date.parse(head.lastRecordedAt));
  // Whole-second, like truncateToWholeSecond (used for event_at) but from the epoch-ms we already hold.
  const recordedAt = new Date(Math.floor(clampedMs / 1000) * 1000).toISOString();

  const entryHash = computeEntryHash({
    sequenceNo,
    personId: entry.personId,
    locationId: key.locationId,
    nodeId: key.nodeId,
    entryKind: entry.entryKind,
    eventAt,
    recordedAt,
    eventOffsetMinutes: entry.eventOffsetMinutes,
    recordedByPersonId: entry.recordedByPersonId,
    capturedByTillId: entry.capturedByTillId ?? null,
    correctsEntryId: entry.correctsEntryId ?? null,
    correctionReason: entry.correctionReason ?? null,
    correctionStatus: entry.correctionStatus ?? null,
    correctionActorId: entry.correctionActorId ?? null,
    prevEntryHash,
  });

  const [inserted] = await tx
    .insert(timeEntries)
    .values({
      personId: entry.personId,
      locationId: key.locationId,
      nodeId: key.nodeId,
      entryKind: entry.entryKind,
      eventAt,
      recordedAt,
      eventOffsetMinutes: entry.eventOffsetMinutes,
      capturedByTillId: entry.capturedByTillId ?? null,
      recordedByPersonId: entry.recordedByPersonId,
      correctsEntryId: entry.correctsEntryId ?? null,
      correctionReason: entry.correctionReason ?? null,
      correctionStatus: entry.correctionStatus ?? null,
      correctionActorId: entry.correctionActorId ?? null,
      entryHash,
      prevEntryHash,
      sequenceNo,
      isFirstEntry,
    })
    .returning({ id: timeEntries.id });
  /* v8 ignore start */
  if (inserted === undefined) {
    throw new Error("time_entries: insert returned no row");
  }
  /* v8 ignore stop */

  await tx
    .update(workforceChains)
    .set({
      sequenceNo,
      lastEntryId: inserted.id,
      lastEntryHash: entryHash,
      lastRecordedAt: recordedAt,
    })
    .where(
      and(eq(workforceChains.nodeId, key.nodeId), eq(workforceChains.locationId, key.locationId)),
    );

  return { id: inserted.id, sequenceNo, entryHash };
}

/**
 * Appends one entry to the (node, location) chain, in the caller's transaction — the single
 * active writer's path for every clock event and every correction (design §5; the 2026-08-02
 * single-writer decision).
 *
 * `clock` supplies `recorded_at` (default `() => new Date()`); it is never a caller input like
 * `event_at`, and it is injectable so a test can drive the monotonic-clamp behaviour (spec §4.1).
 *
 * Each attempt runs inside a nested `tx.transaction()`, which Drizzle emits as SAVEPOINT / RELEASE /
 * ROLLBACK TO SAVEPOINT. That is not decoration: in Postgres a unique violation aborts the WHOLE
 * enclosing transaction, so without a savepoint the retry would issue its next statement against a
 * transaction that can only accept ROLLBACK — destroying whatever the caller already did in it. The
 * savepoint confines the abort to the failed attempt.
 *
 * Exhaustion throws the structured `attendance.append_contention`, never a bare string — the Global
 * Constraint's requirement that anything reaching a till screen be translatable, applied to exactly
 * the failure a human most needs explained: a clock-in that could not be recorded because the chain
 * head could not be extended right now.
 */
export async function appendToChain(
  tx: Transaction,
  key: ChainKey,
  entry: TimeEntryAppend,
  clock: () => Date = () => new Date(),
): Promise<{ id: string; sequenceNo: number; entryHash: string }> {
  for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt++) {
    try {
      return await tx.transaction((nested) => attemptAppend(nested, key, entry, clock));
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new AppError("attendance.append_contention", {
    ...key,
    attempts: MAX_APPEND_ATTEMPTS,
  });
}

/**
 * Reads one (node, location) chain's rows as `VerifiableEntry`s, ordered by chain position —
 * the seam a test (and later a status page) verifies against the database rather than hand-rolling
 * the select. `event_at` and `recorded_at` are read through `to_char(… 'HH24:MI:SS"Z"')` so
 * `computeEntryHash` reproduces the stored hash under node-postgres (the Date-vs-string trap the
 * other reads document). Scoped to the full key, never a bare id (CLAUDE.md §3). Accepts a
 * `Database` or a `Transaction` — it is a pure read and needs neither the head lock nor the caller's
 * transaction, so a status page can call it on a pool directly.
 */
export async function readChain(
  tx: Database | Transaction,
  key: ChainKey,
): Promise<VerifiableEntry[]> {
  const rows = await tx
    .select({
      sequenceNo: timeEntries.sequenceNo,
      personId: timeEntries.personId,
      locationId: timeEntries.locationId,
      nodeId: timeEntries.nodeId,
      entryKind: timeEntries.entryKind,
      eventAt: sql<string>`to_char(${timeEntries.eventAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      recordedAt: sql<string>`to_char(${timeEntries.recordedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      eventOffsetMinutes: timeEntries.eventOffsetMinutes,
      recordedByPersonId: timeEntries.recordedByPersonId,
      capturedByTillId: timeEntries.capturedByTillId,
      correctsEntryId: timeEntries.correctsEntryId,
      correctionReason: timeEntries.correctionReason,
      correctionStatus: timeEntries.correctionStatus,
      correctionActorId: timeEntries.correctionActorId,
      prevEntryHash: timeEntries.prevEntryHash,
      entryHash: timeEntries.entryHash,
      isFirstEntry: timeEntries.isFirstEntry,
    })
    .from(timeEntries)
    .where(and(eq(timeEntries.nodeId, key.nodeId), eq(timeEntries.locationId, key.locationId)))
    .orderBy(timeEntries.sequenceNo);
  return rows;
}
