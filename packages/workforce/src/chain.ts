// Side-effect: registers this package's `attendance.append_contention` code on the shared
// ErrorParams registry (declaration merging). See ./errors.ts and ./errors.reachability.test.ts.
import "./errors.js";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { computeEntryHash } from "./chain-hash.js";
import { timeEntries } from "./schema/time-entries.js";
import { workforceChains } from "./schema/workforce-chains.js";
import type { WorkforceEntryKind } from "./projection.js";

const UNIQUE_VIOLATION = "23505";

/**
 * Three, not one and not ten (fiscal chain.ts's reasoning, applied to the workforce chain). One is
 * not a retry. Ten converts a genuine duplicate — a real bug — into ten pointless round trips. The
 * retry exists only for the narrow window in which two writers race to CREATE a chain head that does
 * not yet exist and therefore cannot be locked; once the head row exists, `FOR UPDATE` serialises
 * everything, so a further collision means something retrying will not fix.
 */
const MAX_APPEND_ATTEMPTS = 3;

/** One entry's content, MINUS the chain fields — `sequence_no`/`entry_hash`/`prev_entry_hash`/
 * `is_first_entry` cannot exist before the head is locked, so they are computed inside `appendToChain`
 * and never supplied by the caller. `locationId` travels as the chain-key parameter, not here. */
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
}

/**
 * Is this (or anything it wraps) a unique-constraint violation? Walks the cause chain because
 * Drizzle wraps every failed query in a `DrizzleQueryError` whose own `.code` is undefined — the
 * real SQLSTATE lives on `.cause.code` — and a savepoint rollback can wrap it again. Stops at a
 * fixed depth so a self-referential `cause` cannot spin forever. Checking only the top level would
 * silently stop retrying and start reporting the wrong error. Mirrors fiscal chain.ts's own copy
 * (not imported — `@waitron/workforce` cannot depend on `@waitron/fiscal-verifactu`).
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: unknown }).code === UNIQUE_VIOLATION
    ) {
      return true;
    }
    const next = (current as { cause?: unknown }).cause;
    if (next === current) return false;
    current = next;
  }
  return false;
}

async function selectHeadForUpdate(
  tx: Transaction,
  tenantId: string,
  locationId: string,
): Promise<ChainHead | undefined> {
  const [row] = await tx
    .select({
      sequenceNo: workforceChains.sequenceNo,
      lastEntryId: workforceChains.lastEntryId,
      lastEntryHash: workforceChains.lastEntryHash,
    })
    .from(workforceChains)
    .where(and(eq(workforceChains.tenantId, tenantId), eq(workforceChains.locationId, locationId)))
    .for("update");
  return row;
}

/**
 * Takes the chain-head row lock, creating the head if this location has none yet.
 *
 * `insert ... on conflict do nothing` then a re-select, not an upsert-returning: when a concurrent
 * transaction has inserted the head but not committed, Postgres makes THIS transaction's speculative
 * insert wait on it and then do nothing on the conflict, so the re-select observes the COMMITTED row
 * rather than one that might still roll back. Exported separately from `appendToChain` because it is
 * the seam a future chain verifier reads the head under the same lock. Same shape as fiscal
 * `lockChainHead`, keyed by (tenant, location) rather than (tenant, till).
 */
export async function lockChainHead(
  tx: Transaction,
  tenantId: string,
  locationId: string,
): Promise<ChainHead> {
  const existing = await selectHeadForUpdate(tx, tenantId, locationId);
  if (existing !== undefined) return existing;

  await tx
    .insert(workforceChains)
    .values({ tenantId, locationId })
    .onConflictDoNothing({ target: [workforceChains.tenantId, workforceChains.locationId] });

  const created = await selectHeadForUpdate(tx, tenantId, locationId);
  /* v8 ignore start */
  if (created === undefined) {
    // Unreachable in practice: the insert above commits a fresh row or a concurrent transaction's
    // insert wins the conflict and commits one; the re-select then locks whichever exists. Left in
    // rather than `!`-asserted so a broken invariant surfaces as a structured AppError, not a
    // TypeError.
    throw new AppError("attendance.append_contention", { tenantId, locationId, attempts: 0 });
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
 * instants a registro de jornada records, and the DB CHECK `time_entries_event_at_second_ck`
 * backstops it.
 */
function truncateToWholeSecond(eventAt: string): string {
  return new Date(Math.floor(Date.parse(eventAt) / 1000) * 1000).toISOString();
}

async function attemptAppend(
  tx: Transaction,
  tenantId: string,
  locationId: string,
  entry: TimeEntryAppend,
): Promise<{ id: string; sequenceNo: number; entryHash: string }> {
  const head = await lockChainHead(tx, tenantId, locationId);
  const sequenceNo = head.sequenceNo + 1;
  const isFirstEntry = head.lastEntryId === null;
  const prevEntryHash = head.lastEntryHash;

  // ONE truncation, feeding BOTH the hash and the stored column, so clock events and corrections are
  // all covered here and the three representations can never diverge (whole-branch review fix).
  const eventAt = truncateToWholeSecond(entry.eventAt);

  const entryHash = computeEntryHash({
    sequenceNo,
    personId: entry.personId,
    locationId,
    entryKind: entry.entryKind,
    eventAt,
    eventOffsetMinutes: entry.eventOffsetMinutes,
    recordedByPersonId: entry.recordedByPersonId,
    correctsEntryId: entry.correctsEntryId ?? null,
    correctionStatus: entry.correctionStatus ?? null,
    prevEntryHash,
  });

  const [inserted] = await tx
    .insert(timeEntries)
    .values({
      tenantId,
      personId: entry.personId,
      locationId,
      entryKind: entry.entryKind,
      eventAt,
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
    .set({ sequenceNo, lastEntryId: inserted.id, lastEntryHash: entryHash })
    .where(and(eq(workforceChains.tenantId, tenantId), eq(workforceChains.locationId, locationId)));

  return { id: inserted.id, sequenceNo, entryHash };
}

/**
 * Appends one entry to the (tenant, location) chain, in the caller's transaction — the single active
 * writer's path for every clock event and every correction (design §5; the 2026-08-02 single-writer
 * decision).
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
  tenantId: string,
  locationId: string,
  entry: TimeEntryAppend,
): Promise<{ id: string; sequenceNo: number; entryHash: string }> {
  for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt++) {
    try {
      return await tx.transaction((nested) => attemptAppend(nested, tenantId, locationId, entry));
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new AppError("attendance.append_contention", {
    tenantId,
    locationId,
    attempts: MAX_APPEND_ATTEMPTS,
  });
}
