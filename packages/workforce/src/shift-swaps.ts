import { sql } from "drizzle-orm";
import { newId, nowIso, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { ShiftSwapStatus } from "./schema/shift-swaps.js";
// Registers this package's error codes, so `new AppError(...)` below type-checks.
import "./errors.js";

export interface RequestSwapInput {
  requestedByPersonId: string;
  fromShiftId: string;
  toPersonId: string;
  /** Null for a one-sided give-away. */
  toShiftId: string | null;
}

export interface AcceptSwapInput {
  swapId: string;
  acceptingPersonId: string;
}

/**
 * Records a `requested` swap and returns its id. The requester must own `fromShift`, and a supplied
 * `toShift` must be `toPerson`'s own (`swap.not_permitted`); either shift missing is `shift.not_found`.
 */
export async function requestSwap(tx: Transaction, input: RequestSwapInput): Promise<string> {
  const fromShiftOwner = await shiftOwner(tx, input.fromShiftId);
  if (fromShiftOwner === undefined) {
    throw new AppError("shift.not_found", { shiftId: input.fromShiftId });
  }
  if (fromShiftOwner !== input.requestedByPersonId) {
    throw new AppError("swap.not_permitted", {
      personId: input.requestedByPersonId,
    });
  }
  if (input.toShiftId !== null) {
    const toShiftOwner = await shiftOwner(tx, input.toShiftId);
    if (toShiftOwner === undefined) {
      throw new AppError("shift.not_found", { shiftId: input.toShiftId });
    }
    if (toShiftOwner !== input.toPersonId) {
      throw new AppError("swap.not_permitted", {
        personId: input.toPersonId,
      });
    }
  }
  // `id` and `created_at` by hand: their defaults are drizzle `$defaultFn`s, which raw SQL skips.
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into shift_swaps (
      id, requested_by_person_id, from_shift_id, to_person_id, to_shift_id, created_at
    ) values (
      ${newId()}, ${input.requestedByPersonId}, ${input.fromShiftId},
      ${input.toPersonId}, ${input.toShiftId}, ${nowIso()}
    )
    returning id`);
  return rows[0]!.id;
}

/**
 * `requested → accepted`, by the swap's `to_person` only. Identity is checked before state, so a
 * non-recipient never learns the swap's state.
 */
export async function acceptSwap(tx: Transaction, input: AcceptSwapInput): Promise<void> {
  const { rows } = await tx.execute<{ to_person_id: string }>(sql`
    select to_person_id from shift_swaps
    where id = ${input.swapId}
    limit 1`);
  const swap = rows[0];
  if (swap === undefined) {
    throw new AppError("swap.not_found", { swapId: input.swapId });
  }
  if (swap.to_person_id !== input.acceptingPersonId) {
    throw new AppError("swap.not_permitted", {
      personId: input.acceptingPersonId,
    });
  }
  const { rows: accepted } = await tx.execute<{ id: string }>(sql`
    update shift_swaps set status = 'accepted'
    where id = ${input.swapId} and status = 'requested'
    returning id`);
  if (accepted.length === 0) {
    throw new AppError("swap.not_acceptable", { swapId: input.swapId });
  }
}

export interface DecideSwapInput {
  swapId: string;
  decision: "approved" | "rejected";
  /** Null when unattributed. */
  decidedByPersonId: string | null;
}

/** `accepted → approved | rejected`. Who may decide is the route's gate, not this verb's. */
export async function decideSwap(tx: Transaction, input: DecideSwapInput): Promise<void> {
  const { rows: decided } = await tx.execute<{ id: string }>(sql`
    update shift_swaps
    set status = ${input.decision},
        decided_by_person_id = ${input.decidedByPersonId},
        decided_at = ${nowIso()}
    where id = ${input.swapId} and status = 'accepted'
    returning id`);
  if (decided.length > 0) return;
  const { rows } = await tx.execute<{ status: ShiftSwapStatus }>(sql`
    select status from shift_swaps
    where id = ${input.swapId}
    limit 1`);
  if (rows[0] === undefined) {
    throw new AppError("swap.not_found", { swapId: input.swapId });
  }
  throw new AppError("swap.not_decidable", { swapId: input.swapId });
}

export interface PendingSwapRow {
  id: string;
  requestedByPersonId: string;
  fromShiftId: string;
  toPersonId: string;
  toShiftId: string | null;
  status: ShiftSwapStatus;
  createdAt: string;
}

/** Not location-scoped: `shift_swaps` has no location. */
export async function listPendingSwaps(tx: Transaction): Promise<PendingSwapRow[]> {
  const { rows } = await tx.execute<{
    id: string;
    requested_by_person_id: string;
    from_shift_id: string;
    to_person_id: string;
    to_shift_id: string | null;
    status: ShiftSwapStatus;
    created_at: string;
  }>(sql`
    select id, requested_by_person_id, from_shift_id, to_person_id, to_shift_id, status, created_at
    from shift_swaps
    where status = 'accepted'
    order by shift_swaps.created_at`);
  return rows.map((r) => ({
    id: r.id,
    requestedByPersonId: r.requested_by_person_id,
    fromShiftId: r.from_shift_id,
    toPersonId: r.to_person_id,
    toShiftId: r.to_shift_id,
    status: r.status,
    createdAt: r.created_at,
  }));
}

async function shiftOwner(tx: Transaction, shiftId: string): Promise<string | undefined> {
  const { rows } = await tx.execute<{ person_id: string }>(sql`
    select person_id from shifts
    where id = ${shiftId}
    limit 1`);
  return rows[0]?.person_id;
}
