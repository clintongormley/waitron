import { sql } from "drizzle-orm";
import { newId, nowIso, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { AbsenceKind, AbsenceStatus } from "./schema/absences.js";
// Registers this package's error codes, so `new AppError(...)` below type-checks.
import "./errors.js";

export interface CreateAbsenceInput {
  personId: string;
  kind: AbsenceKind;
  /** `YYYY-MM-DD`, inclusive, as is `endsOn`. */
  startsOn: string;
  endsOn: string;
  note: string | null;
}

export interface SetAbsenceStatusInput {
  absenceId: string;
  status: AbsenceStatus;
  /** Null when unattributed. */
  decidedByPersonId: string | null;
}

/**
 * Records a `requested` absence and returns its id. Throws `absence.overlaps` when the range overlaps
 * any existing absence for the same person, whatever that absence's status.
 */
export async function createAbsence(tx: Transaction, input: CreateAbsenceInput): Promise<string> {
  // Refused here, not left to `absences_range_ck`, so the caller gets a coded error rather than a
  // constraint failure. `YYYY-MM-DD` strings order as dates.
  if (input.endsOn < input.startsOn) {
    throw new AppError("absence.invalid", {
      reason: "ends_before_starts",
    });
  }
  const { rows: conflicts } = await tx.execute<{ one: number }>(sql`
    select 1 as one from absences
    where person_id = ${input.personId}
      and starts_on <= ${input.endsOn} and ${input.startsOn} <= ends_on
    limit 1`);
  if (conflicts.length > 0) {
    throw new AppError("absence.overlaps", {
      personId: input.personId,
    });
  }
  // `id` and `created_at` by hand: their defaults are drizzle `$defaultFn`s, which raw SQL skips.
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into absences (id, person_id, absence_kind, starts_on, ends_on, note, created_at)
    values (
      ${newId()}, ${input.personId}, ${input.kind},
      ${input.startsOn}, ${input.endsOn}, ${input.note}, ${nowIso()}
    )
    returning id`);
  return rows[0]!.id;
}

/** Sets any status, including back to `requested`; no role gate here. */
export async function setAbsenceStatus(
  tx: Transaction,
  input: SetAbsenceStatusInput,
): Promise<void> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    update absences
    set status = ${input.status},
        decided_by_person_id = ${input.decidedByPersonId},
        decided_at = ${nowIso()}
    where id = ${input.absenceId}
    returning id`);
  if (rows.length === 0) {
    throw new AppError("absence.not_found", {
      absenceId: input.absenceId,
    });
  }
}

export interface PendingAbsenceRow {
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

/** Not location-scoped: `absences` has no location. */
export async function listPendingAbsences(tx: Transaction): Promise<PendingAbsenceRow[]> {
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
    where status = 'requested'
    order by absences.created_at`);
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
