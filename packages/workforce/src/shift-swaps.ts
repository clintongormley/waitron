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
 * - a supplied `toShift` must exist under the tenant (`shift.not_found` otherwise) AND be OWNED by the
 *   `toPerson` the swap is offered to — the return leg must be that person's own shift, not a third
 *   party's (`swap.not_permitted` otherwise); a null `toShift` is a one-sided give-away and skips both.
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
    // The return leg must be the OFFERED person's own shift — a swap that put up a third party's shift
    // in return is not a permitted arrangement (guards the two-sided API even though this slice's UI
    // only files give-aways). `swap.not_permitted` names the person the offer is for, mirroring the
    // from-shift ownership check above.
    if (toShiftOwner !== input.toPersonId) {
      throw new AppError("swap.not_permitted", {
        tenantId: input.tenantId,
        personId: input.toPersonId,
      });
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
 * Accepts a pending swap on behalf of the offered person — a status flip `requested → accepted` over
 * PLANNING data. Guards, in order (IDENTITY before STATE, mirroring the read order):
 *
 * - `swap.not_found` if no such swap exists under the tenant;
 * - `swap.not_permitted` if the acceptor is not the swap's `to_person` (only the person a swap is
 *   offered to may accept it) — screened BEFORE the state check, so a non-recipient never learns the
 *   swap's state;
 * - `swap.not_acceptable` if the swap is not `requested` (already `accepted`, or `approved`/`rejected`
 *   terminal): only a `requested` swap may be accepted, so accepting a decided one is refused rather
 *   than silently flipping it back to `accepted`.
 *
 * The `and status = 'requested'` predicate on the UPDATE IS that requested-only guard: the conditional
 * UPDATE only fires while the swap is still `requested`, and `RETURNING id` reports whether it matched.
 * A no-match after the two checks above can only mean the swap exists and the acceptor is the
 * recipient but the state is wrong — so it maps straight to `swap.not_acceptable`, no re-SELECT needed
 * (existence is already confirmed by the permission read above, unlike `decideSwap` which has no prior
 * read). The manager approve/reject transition is `decideSwap`, not this verb.
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
  const { rows: accepted } = await tx.execute<{ id: string }>(sql`
    update shift_swaps set status = 'accepted'
    where tenant_id = ${input.tenantId} and id = ${input.swapId} and status = 'requested'
    returning id`);
  if (accepted.length === 0) {
    throw new AppError("swap.not_acceptable", { tenantId: input.tenantId, swapId: input.swapId });
  }
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
 * (design §3a). The success path is a single conditional UPDATE guarded on `status = 'accepted'`,
 * setting `status = decision`, `decided_by_person_id` and `decided_at = now()` and `RETURNING id`
 * (mirrors `setAbsenceStatus`) — one round trip in the common case. When it matches no row the swap is
 * either absent or not decidable, and ONLY THEN a `SELECT` disambiguates: throws `swap.not_found` if
 * absent (never created), else the new `swap.not_decidable` (a `requested` swap has
 * not been accepted yet; an `approved`/`rejected` one is terminal). PLANNING data — a plain status
 * flip, no chain. Who MAY decide is the route's gate (`swap.approve`), not this verb's.
 */
export async function decideSwap(tx: Transaction, input: DecideSwapInput): Promise<void> {
  // The common case in ONE round trip: the UPDATE only fires while the swap is still `accepted`, and
  // `RETURNING id` reports whether it matched — the `status = 'accepted'` predicate IS the decidability
  // guard (delete it and a requested/terminal swap would be decided).
  const { rows: decided } = await tx.execute<{ id: string }>(sql`
    update shift_swaps
    set status = ${input.decision},
        decided_by_person_id = ${input.decidedByPersonId},
        decided_at = now()
    where tenant_id = ${input.tenantId} and id = ${input.swapId} and status = 'accepted'
    returning id`);
  if (decided.length > 0) return;
  // No row matched: the swap is absent, or present but not `accepted`. One extra read on this cold
  // path disambiguates which error to raise.
  const { rows } = await tx.execute<{ status: ShiftSwapStatus }>(sql`
    select status from shift_swaps
    where tenant_id = ${input.tenantId} and id = ${input.swapId}
    limit 1`);
  if (rows[0] === undefined) {
    throw new AppError("swap.not_found", { tenantId: input.tenantId, swapId: input.swapId });
  }
  throw new AppError("swap.not_decidable", { tenantId: input.tenantId, swapId: input.swapId });
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

/** The `person_id` of a shift under the tenant, or `undefined` when no such shift exists (never
 * created). */
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
