import { sql } from "drizzle-orm";
import { newId, nowIso, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { AbsenceKind, AbsenceStatus } from "./schema/absences.js";
// Side-effect: registers this package's absence.* codes so `new AppError(...)` below type-checks
// against the shared registry (packages/shared reachability rule).
import "./errors.js";

/** A request to record a planned absence for a person over an inclusive date range. */
export interface CreateAbsenceInput {
  personId: string;
  kind: AbsenceKind;
  /** First day of the absence, inclusive (`YYYY-MM-DD`). */
  startsOn: string;
  /** Last day of the absence, inclusive (`YYYY-MM-DD`). */
  endsOn: string;
  /** A free-text note, or null when none. */
  note: string | null;
}

/** A request to move an existing absence to a decided status. */
export interface SetAbsenceStatusInput {
  absenceId: string;
  status: AbsenceStatus;
  /** The manager who decided, recorded on the absence; null when unattributed (mirrors
   * roster_versions.published_by_person_id — recorded when supplied, never required). NEW field. */
  decidedByPersonId: string | null;
}

/**
 * Records a planned absence — PLANNING data, an ordinary INSERT (not an append to the immutable
 * ledger). The new absence is always `requested`; a manager decides it later via `setAbsenceStatus`.
 *
 * Refuses an absence whose date range OVERLAPS an existing absence for the SAME person,
 * throwing `absence.overlaps` — one person cannot be absent twice over the same day. The
 * overlap is inclusive on both ends: two ranges [a1,a2] and [b1,b2] overlap iff a1 ≤ b2 AND b1 ≤ a2,
 * so a range starting the day AFTER another ends does not conflict. Status is not considered — any
 * existing absence for the person, whatever its status, blocks an overlapping one (a deliberate
 * conservative floor for this slice; a status-aware rule is a later refinement). Returns the new
 * absence's id.
 */
export async function createAbsence(tx: Transaction, input: CreateAbsenceInput): Promise<string> {
  // Cross-field ordering guard, mirroring `addShift`'s `assertShiftInterval` (../clocking.ts): a
  // malformed interval whose end day precedes its start day is refused HERE, in the verb, before the
  // overlap SELECT and the insert. This is a public `@waitron/workforce` API and must honour its own
  // interval contract even when the HTTP route also screens — the route's `requirePeriod` validates
  // each date in ISOLATION and so passes an inverted PAIR straight through (and a direct verb caller
  // has no route screen at all). Without this the insert violates `absences_range_ck`
  // (ends_on >= starts_on) → PG 23514 → a non-AppError → an opaque 500; the check constraint stays the
  // backstop. `startsOn` and `endsOn` are `YYYY-MM-DD` per CreateAbsenceInput, and for fixed-width
  // zero-padded YYYY-MM-DD lexicographic order equals calendar order, so a string `<` orders the two
  // days. The range is inclusive, so `endsOn == startsOn` (a single-day absence) is valid — hence `<`.
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
  // `id` and `created_at` are supplied by hand: both are `$defaultFn` generators declared on the
  // column (`schema/absences.ts`), which drizzle runs for a builder insert and not for raw SQL, and
  // the generated DDL carries no SQL default for either — without them the statement is refused
  // `NOT NULL constraint failed: absences.id`. `newId`/`nowIso` are the same two generators the
  // column declares, so a row written here and one written through the table are the same shape.
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into absences (id, person_id, absence_kind, starts_on, ends_on, note, created_at)
    values (
      ${newId()}, ${input.personId}, ${input.kind},
      ${input.startsOn}, ${input.endsOn}, ${input.note}, ${nowIso()}
    )
    returning id`);
  return rows[0]!.id;
}

/**
 * Moves an existing absence to a decided status (`approved`/`rejected`, or back to `requested`) — a
 * plain UPDATE of the status column over PLANNING data, not a workflow: no role gate is imposed here
 * (who may decide an absence is a later owner decision, plan §7). Throws `absence.not_found` if no
 * such absence exists (never created).
 */
export async function setAbsenceStatus(
  tx: Transaction,
  input: SetAbsenceStatusInput,
): Promise<void> {
  // `decided_at` is bound from this process's clock. The PostgreSQL `now()` it replaced read the
  // DATABASE's clock, once per transaction; this engine has no such function and the statement
  // failed outright with `no such function: now`.
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

/** One requested absence awaiting a manager decision (the approvals queue). */
export interface PendingAbsenceRow {
  id: string;
  personId: string;
  kind: AbsenceKind;
  /** YYYY-MM-DD, inclusive — the stored text, read back unchanged. */
  startsOn: string;
  endsOn: string;
  /** Always `requested` for this query. */
  status: AbsenceStatus;
  note: string | null;
  createdAt: string;
}

/**
 * The venue's REQUESTED absences awaiting a manager decision, ordered by `created_at` (design §3b).
 * Not location-scoped — `absences` has no location.
 */
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
