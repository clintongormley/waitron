import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { ShiftSwapStatus } from "./schema/shift-swaps.js";
// Side-effect: registers this package's swap.*/shift.* codes so `new AppError(...)` below type-checks
// against the shared registry (packages/shared reachability rule).
import "./errors.js";

/** A request to swap shifts — person A offers their `fromShift` to person B, optionally taking B's
 * `toShift` in return. */
export interface RequestSwapInput {
  tenantId: string;
  /** The person offering the swap; must OWN `fromShift`. */
  requestedByPersonId: string;
  /** The shift being offered. */
  fromShiftId: string;
  /** The person the shift is offered to — the only one who may later accept it. */
  toPersonId: string;
  /** The shift offered in return, or null for a one-sided give-away. */
  toShiftId: string | null;
}

/** A request by the offered person to accept a pending swap. */
export interface AcceptSwapInput {
  tenantId: string;
  swapId: string;
  /** Who is accepting — must be the swap's `to_person`. */
  acceptingPersonId: string;
}

/**
 * Records a swap request — PLANNING data, an ordinary INSERT. Guards, in order:
 *
 * - the offered `fromShift` must exist under the tenant (`shift.not_found` otherwise) AND be OWNED by
 *   the requester — you may only offer a shift that is yours (`swap.not_permitted` otherwise);
 * - a supplied `toShift` must exist under the tenant (`shift.not_found` otherwise); a null `toShift`
 *   is a one-sided give-away and skips the check.
 *
 * Returns the new swap's id, status `requested`.
 */
export async function requestSwap(tx: Transaction, input: RequestSwapInput): Promise<string> {
  const fromShiftOwner = await shiftOwner(tx, input.tenantId, input.fromShiftId);
  if (fromShiftOwner === undefined) {
    throw new AppError("shift.not_found", { tenantId: input.tenantId, shiftId: input.fromShiftId });
  }
  if (fromShiftOwner !== input.requestedByPersonId) {
    throw new AppError("swap.not_permitted", {
      tenantId: input.tenantId,
      personId: input.requestedByPersonId,
    });
  }
  if (input.toShiftId !== null) {
    const toShiftOwner = await shiftOwner(tx, input.tenantId, input.toShiftId);
    if (toShiftOwner === undefined) {
      throw new AppError("shift.not_found", { tenantId: input.tenantId, shiftId: input.toShiftId });
    }
  }
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into shift_swaps (
      tenant_id, requested_by_person_id, from_shift_id, to_person_id, to_shift_id
    ) values (
      ${input.tenantId}, ${input.requestedByPersonId}, ${input.fromShiftId},
      ${input.toPersonId}, ${input.toShiftId}
    )
    returning id`);
  return rows[0]!.id;
}

/**
 * Accepts a pending swap on behalf of the offered person — a plain status flip `requested →
 * accepted` over PLANNING data. Throws `swap.not_found` if no such swap exists under the tenant, and
 * `swap.not_permitted` if the acceptor is not the swap's `to_person` (only the person a swap is
 * offered to may accept it). The manager approve/reject transition is a later slice's owner-gated
 * workflow (plan §7), not built here.
 */
export async function acceptSwap(tx: Transaction, input: AcceptSwapInput): Promise<void> {
  const { rows } = await tx.execute<{ to_person_id: string }>(sql`
    select to_person_id from shift_swaps
    where tenant_id = ${input.tenantId} and id = ${input.swapId}
    limit 1`);
  const swap = rows[0];
  if (swap === undefined) {
    throw new AppError("swap.not_found", { tenantId: input.tenantId, swapId: input.swapId });
  }
  if (swap.to_person_id !== input.acceptingPersonId) {
    throw new AppError("swap.not_permitted", {
      tenantId: input.tenantId,
      personId: input.acceptingPersonId,
    });
  }
  await tx.execute(sql`
    update shift_swaps set status = 'accepted'
    where tenant_id = ${input.tenantId} and id = ${input.swapId}`);
}

/** A manager's decision on an ACCEPTED swap. */
export interface DecideSwapInput {
  tenantId: string;
  swapId: string;
  /** The manager's decision. Only these two — a decide never returns a swap to requested/accepted. */
  decision: "approved" | "rejected";
  /** The manager who decided, recorded on the swap; null when the caller does not attribute it
   *  (mirrors roster_versions.published_by_person_id — recorded when supplied, never required). */
  decidedByPersonId: string | null;
}

/**
 * A manager approves or rejects an ACCEPTED swap — the `accepted → approved | rejected` transition
 * (design §3a). Reads the swap's status under the tenant; throws `swap.not_found` if absent (never
 * created, or hidden by RLS) and the new `swap.not_decidable` if its status is not `accepted` (a
 * `requested` swap has not been accepted yet; an `approved`/`rejected` one is terminal). Otherwise
 * UPDATEs `status = decision`, `decided_by_person_id`, `decided_at = now()`. PLANNING data — a plain
 * status flip, no chain. Who MAY decide is the route's gate (`swap.approve`), not this verb's.
 */
export async function decideSwap(tx: Transaction, input: DecideSwapInput): Promise<void> {
  const { rows } = await tx.execute<{ status: ShiftSwapStatus }>(sql`
    select status from shift_swaps
    where tenant_id = ${input.tenantId} and id = ${input.swapId}
    limit 1`);
  const swap = rows[0];
  if (swap === undefined) {
    throw new AppError("swap.not_found", { tenantId: input.tenantId, swapId: input.swapId });
  }
  if (swap.status !== "accepted") {
    throw new AppError("swap.not_decidable", { tenantId: input.tenantId, swapId: input.swapId });
  }
  await tx.execute(sql`
    update shift_swaps
    set status = ${input.decision},
        decided_by_person_id = ${input.decidedByPersonId},
        decided_at = now()
    where tenant_id = ${input.tenantId} and id = ${input.swapId}`);
}

/** One accepted-and-pending swap awaiting a manager decision (the approvals queue). */
export interface PendingSwapRow {
  id: string;
  requestedByPersonId: string;
  fromShiftId: string;
  toPersonId: string;
  toShiftId: string | null;
  /** Always `accepted` for this query, typed to the enum. */
  status: ShiftSwapStatus;
  /** UTC ISO instant (to_char-normalised, the getRoster pattern — node-postgres returns a Date, PGlite
   * a string; the cast pins both to a stable string). */
  createdAt: string;
}

/**
 * The tenant's ACCEPTED swaps awaiting a manager decision, ordered by `created_at`. Tenant-scoped, NOT
 * location-scoped: `shift_swaps` carries no `location_id` (`schema/shift-swaps.ts`) — the location
 * lives on the referenced shifts — so the queue is the whole tenant's accepted swaps (design §3a).
 */
export async function listPendingSwaps(
  tx: Transaction,
  input: { tenantId: string },
): Promise<PendingSwapRow[]> {
  const { rows } = await tx.execute<{
    id: string;
    requested_by_person_id: string;
    from_shift_id: string;
    to_person_id: string;
    to_shift_id: string | null;
    status: ShiftSwapStatus;
    created_at: string;
  }>(sql`
    select id, requested_by_person_id, from_shift_id, to_person_id, to_shift_id, status,
      to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
    from shift_swaps
    where tenant_id = ${input.tenantId} and status = 'accepted'
    order by created_at`);
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

/** The `person_id` of a shift under the tenant, or `undefined` when no such shift exists (never
 * created, or hidden by RLS — identical from the caller's side). */
async function shiftOwner(
  tx: Transaction,
  tenantId: string,
  shiftId: string,
): Promise<string | undefined> {
  const { rows } = await tx.execute<{ person_id: string }>(sql`
    select person_id from shifts
    where tenant_id = ${tenantId} and id = ${shiftId}
    limit 1`);
  return rows[0]?.person_id;
}
