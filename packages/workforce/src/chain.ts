// Side-effect: registers this package's codes on the shared AppError registry.
import "./errors.js";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { isUniqueViolation, type Database, type Transaction } from "@waitron/db";
import { computeEntryHash, type VerifiableEntry } from "./chain-hash.js";
import { timeEntries } from "./schema/time-entries.js";
import { workforceChains } from "./schema/workforce-chains.js";
import type { WorkforceEntryKind } from "./projection.js";

/**
 * `time_entries_chain_position_uq` refuses a position whatever occupies it, including a row this code
 * did not write. Whether any path reaches that today is NOT established; the retry confines such a
 * refusal to one attempt, and is not evidence that something reaches it.
 */
const MAX_APPEND_ATTEMPTS = 3;

/** One chain per (node, location). An object rather than positional strings, so a caller cannot
 * transpose the two. */
export interface ChainKey {
  nodeId: string;
  locationId: string;
}

/** The chain fields and `recorded_at` are computed by `appendToChain`, never supplied. */
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
  /** Keeps `recorded_at` monotonic per chain; null exactly when the pointer is. */
  lastRecordedAt: string | null;
}

/**
 * No lock: the position read here is used several statements later, and nothing can append in
 * between because one write transaction runs on the venue file at a time
 * (`assertExtraListForWrite`, `packages/catalogue/src/extras.ts`). The chain's safety against a fork
 * is `time_entries_chain_position_uq`, not this.
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

/** Creates the head if there is none yet. */
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
    // Not `!`-asserted, so a broken invariant surfaces as a structured AppError, not a TypeError.
    throw new AppError("attendance.append_contention", { ...key, attempts: 0 });
  }
  /* v8 ignore stop */
  return created;
}

/**
 * Truncating at the single write choke point keeps the stored column, the committed hash and every
 * read-back identical, so a millisecond-precision clock cannot make an untouched row recompute to a
 * false `hash_mismatch`. It also gives the text column ONE spelling (`…00.000Z`), so `<`/`order by`
 * on it is a time ordering. `time_entries_event_at_second_ck` backstops it.
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

  // ONE truncation each, feeding BOTH the hash and the stored column.
  const eventAt = truncateToWholeSecond(entry.eventAt);
  // Clamped to the chain's high-water mark, so a wall clock that steps backward still yields a
  // non-decreasing `recorded_at` per chain and the cross-node correction order agrees with
  // `sequence_no` within one chain (spec §4.1).
  const nowMs = clock().getTime();
  const clampedMs =
    head.lastRecordedAt === null ? nowMs : Math.max(nowMs, Date.parse(head.lastRecordedAt));
  // Whole seconds, for the same reason as `event_at`.
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
 * `clock` supplies `recorded_at`; it is injectable so a test can drive the monotonic clamp.
 *
 * Each attempt runs in a nested `tx.transaction()` (a savepoint, since the caller's transaction is
 * open). It confines a losing attempt's own writes — `readChainHead` may have created the head row —
 * so the next attempt starts where the caller's transaction was.
 *
 * Exhaustion throws `attendance.append_contention`.
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
 * Ordered by chain position. `event_at` and `recorded_at` read back as the exact strings
 * `attemptAppend` wrote and hashed.
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
      eventAt: timeEntries.eventAt,
      recordedAt: timeEntries.recordedAt,
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
