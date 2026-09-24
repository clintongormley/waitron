import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { AbsenceKind, AbsenceStatus } from "./schema/absences.js";
import type { ShiftSwapStatus } from "./schema/shift-swaps.js";
import { shiftLocalDate } from "./shift-local-date.js";

// "A staff member sees only their own rows" is enforced by these `person_id` predicates and by the
// route passing the session's person — never by the database.

export interface ListShiftsForPersonInput {
  personId: string;
  /** `YYYY-MM-DD`, inclusive, compared against each shift's local wall date. */
  from: string;
  /** `YYYY-MM-DD`, exclusive. */
  to: string;
}

export interface PersonShiftRow {
  id: string;
  locationId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  role: string | null;
  rosterVersionId: string | null;
}

export type SwapDirection = "offered_to_me" | "requested_by_me";

export interface PersonSwapRow {
  id: string;
  requestedByPersonId: string;
  fromShiftId: string;
  toPersonId: string;
  toShiftId: string | null;
  status: ShiftSwapStatus;
  createdAt: string;
  direction: SwapDirection;
}

export interface PersonAbsenceRow {
  id: string;
  personId: string;
  kind: AbsenceKind;
  /** `YYYY-MM-DD`, inclusive. */
  startsOn: string;
  endsOn: string;
  status: AbsenceStatus;
  note: string | null;
  createdAt: string;
}

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
    select id, location_id, starts_at, starts_offset_minutes, ends_at,
      ends_offset_minutes, role, roster_version_id
    from shifts
    where person_id = ${input.personId}
      and ${shiftLocalDate} >= ${input.from}
      and ${shiftLocalDate} < ${input.to}
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

/** A self-swap, which nothing in the database refuses, reports `requested_by_me`. */
export async function listSwapsForPerson(
  tx: Transaction,
  input: { personId: string },
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
    select id, requested_by_person_id, from_shift_id, to_person_id, to_shift_id, status, created_at,
      case when requested_by_person_id = ${input.personId} then 'requested_by_me' else 'offered_to_me' end as direction
    from shift_swaps
    where (requested_by_person_id = ${input.personId} or to_person_id = ${input.personId})
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

export async function listAbsencesForPerson(
  tx: Transaction,
  input: { personId: string },
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
    select id, person_id, absence_kind, starts_on, ends_on, status, note, created_at
    from absences
    where person_id = ${input.personId}
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
