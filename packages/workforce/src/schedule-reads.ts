import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { AbsenceKind, AbsenceStatus } from "./schema/absences.js";
import type { ShiftSwapStatus } from "./schema/shift-swaps.js";

/**
 * The STAFF-FACING read side of the swap/absence request path — one person's OWN schedule views, the
 * counterpart to the manager `listPending*` queues. Every read filters on the requester's `person_id`
 * in APPLICATION CODE: the planning tables' RLS is tenant-scoped only (`0008_scheduling_planning_rls.sql`,
 * `USING (tenant_id = current_tenant_id())`) with NO per-person row policy, so "a staff member sees only
 * their own rows" is enforced by these predicates and by the route passing the SESSION's personId — never
 * by the database (plan fact 3). Reads only; no throws, so no `./errors.js` import.
 */

/** A window read of one person's shifts over a half-open local-date range `[from, to)`. */
export interface ListShiftsForPersonInput {
  tenantId: string;
  personId: string;
  /** Inclusive lower bound, `YYYY-MM-DD`, compared against each shift's LOCAL wall date. */
  from: string;
  /** Exclusive upper bound, `YYYY-MM-DD`. */
  to: string;
}

/** One of the requester's planned shifts. Person is implied (the requester), so it is not repeated. */
export interface PersonShiftRow {
  id: string;
  locationId: string;
  /** UTC ISO instant (to_char-normalised, the getRoster/planned-vs-actual pattern). */
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  role: string | null;
  rosterVersionId: string | null;
}

/** Which side of a swap the requesting person is on. A swap matches at most one side per person. */
export type SwapDirection = "offered_to_me" | "requested_by_me";

/** One swap the requester is party to — one they offered, or one offered to them. */
export interface PersonSwapRow {
  id: string;
  requestedByPersonId: string;
  fromShiftId: string;
  toPersonId: string;
  toShiftId: string | null;
  status: ShiftSwapStatus;
  /** UTC ISO instant (to_char-normalised). */
  createdAt: string;
  /** `requested_by_me` when the requester is the `requested_by_person`, else `offered_to_me`. */
  direction: SwapDirection;
}

/** One of the requester's absences, any status (mirrors the manager queue's `PendingAbsenceRow`). */
export interface PersonAbsenceRow {
  id: string;
  personId: string;
  kind: AbsenceKind;
  /** YYYY-MM-DD, inclusive (::text cast, the getRoster date pattern). */
  startsOn: string;
  endsOn: string;
  status: AbsenceStatus;
  note: string | null;
  createdAt: string;
}

/**
 * The requester's shifts whose LOCAL wall date falls in the half-open window `[from, to)`, ordered by
 * `starts_at`. The window compares `(starts_at at time zone 'UTC' + starts_offset_minutes)::date`, the
 * same offset-aware local-date expression `publishRoster`/`plannedShiftsInPeriod` use (offset 0 in this
 * slice, so local = UTC), so a shift is placed by its LOCAL day rather than its raw UTC instant. Covered
 * by `shifts_tenant_person_starts_idx` on `(tenant_id, person_id, starts_at)` (plan fact 4).
 */
export async function listShiftsForPerson(
  tx: Transaction,
  input: ListShiftsForPersonInput,
): Promise<PersonShiftRow[]> {
  const { rows } = await tx.execute<{
    id: string;
    location_id: string;
    starts_at: string;
    starts_offset_minutes: number;
    ends_at: string;
    ends_offset_minutes: number;
    role: string | null;
    roster_version_id: string | null;
  }>(sql`
    select id, location_id,
      to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as starts_at,
      starts_offset_minutes,
      to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as ends_at,
      ends_offset_minutes, role, roster_version_id
    from shifts
    where tenant_id = ${input.tenantId} and person_id = ${input.personId}
      and (starts_at at time zone 'UTC' + starts_offset_minutes * interval '1 minute')::date >= ${input.from}::date
      and (starts_at at time zone 'UTC' + starts_offset_minutes * interval '1 minute')::date < ${input.to}::date
    order by starts_at`);
  return rows.map((r) => ({
    id: r.id,
    locationId: r.location_id,
    startsAt: r.starts_at,
    startsOffsetMinutes: r.starts_offset_minutes,
    endsAt: r.ends_at,
    endsOffsetMinutes: r.ends_offset_minutes,
    role: r.role,
    rosterVersionId: r.roster_version_id,
  }));
}

/**
 * The swaps the requester is party to — every swap whose `requested_by_person_id` OR `to_person_id` is
 * the requester — ordered by `created_at` desc (newest first). `direction` is derived from which column
 * matched: `requested_by_me` when the requester is the requester of record, else `offered_to_me`. A swap
 * matches at most one side per person (a requester offering to themselves is nonsensical and the UI filters
 * self out of the colleague picker), so the CASE is unambiguous; were a self-swap ever created the CASE
 * would deterministically report `requested_by_me`, never crash this read.
 */
export async function listSwapsForPerson(
  tx: Transaction,
  input: { tenantId: string; personId: string },
): Promise<PersonSwapRow[]> {
  const { rows } = await tx.execute<{
    id: string;
    requested_by_person_id: string;
    from_shift_id: string;
    to_person_id: string;
    to_shift_id: string | null;
    status: ShiftSwapStatus;
    created_at: string;
    direction: SwapDirection;
  }>(sql`
    select id, requested_by_person_id, from_shift_id, to_person_id, to_shift_id, status,
      to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
      case when requested_by_person_id = ${input.personId} then 'requested_by_me' else 'offered_to_me' end as direction
    from shift_swaps
    where tenant_id = ${input.tenantId}
      and (requested_by_person_id = ${input.personId} or to_person_id = ${input.personId})
    order by created_at desc`);
  return rows.map((r) => ({
    id: r.id,
    requestedByPersonId: r.requested_by_person_id,
    fromShiftId: r.from_shift_id,
    toPersonId: r.to_person_id,
    toShiftId: r.to_shift_id,
    status: r.status,
    createdAt: r.created_at,
    direction: r.direction,
  }));
}

/**
 * All of the requester's absences, EVERY status (not only `requested` like the manager queue), ordered by
 * `starts_on` desc — a staff member's own leave history and pending requests. Person-scoped in application
 * code (RLS is tenant-only). Covered by `absences_tenant_person_idx` on `(tenant_id, person_id, starts_on)`.
 */
export async function listAbsencesForPerson(
  tx: Transaction,
  input: { tenantId: string; personId: string },
): Promise<PersonAbsenceRow[]> {
  const { rows } = await tx.execute<{
    id: string;
    person_id: string;
    absence_kind: AbsenceKind;
    starts_on: string;
    ends_on: string;
    status: AbsenceStatus;
    note: string | null;
    created_at: string;
  }>(sql`
    select id, person_id, absence_kind, starts_on::text as starts_on, ends_on::text as ends_on, status, note,
      to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
    from absences
    where tenant_id = ${input.tenantId} and person_id = ${input.personId}
    order by starts_on desc`);
  return rows.map((r) => ({
    id: r.id,
    personId: r.person_id,
    kind: r.absence_kind,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    status: r.status,
    note: r.note,
    createdAt: r.created_at,
  }));
}
