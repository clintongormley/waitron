import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { AbsenceKind, AbsenceStatus } from "./schema/absences.js";
// Side-effect: registers this package's absence.* codes so `new AppError(...)` below type-checks
// against the shared registry (packages/shared reachability rule).
import "./errors.js";

/** A request to record a planned absence for a person over an inclusive date range. */
export interface CreateAbsenceInput {
  tenantId: string;
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
  tenantId: string;
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
 * Refuses an absence whose date range OVERLAPS an existing absence for the SAME person under this
 * tenant, throwing `absence.overlaps` — one person cannot be absent twice over the same day. The
 * overlap is inclusive on both ends: two ranges [a1,a2] and [b1,b2] overlap iff a1 ≤ b2 AND b1 ≤ a2,
 * so a range starting the day AFTER another ends does not conflict. Status is not considered — any
 * existing absence for the person, whatever its status, blocks an overlapping one (a deliberate
 * conservative floor for this slice; a status-aware rule is a later refinement). Returns the new
 * absence's id.
 */
export async function createAbsence(tx: Transaction, input: CreateAbsenceInput): Promise<string> {
  const { rows: conflicts } = await tx.execute<{ one: number }>(sql`
    select 1 as one from absences
    where tenant_id = ${input.tenantId} and person_id = ${input.personId}
      and starts_on <= ${input.endsOn} and ${input.startsOn} <= ends_on
    limit 1`);
  if (conflicts.length > 0) {
    throw new AppError("absence.overlaps", {
      tenantId: input.tenantId,
      personId: input.personId,
    });
  }
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into absences (tenant_id, person_id, absence_kind, starts_on, ends_on, note)
    values (
      ${input.tenantId}, ${input.personId}, ${input.kind},
      ${input.startsOn}, ${input.endsOn}, ${input.note}
    )
    returning id`);
  return rows[0]!.id;
}

/**
 * Moves an existing absence to a decided status (`approved`/`rejected`, or back to `requested`) — a
 * plain UPDATE of the status column over PLANNING data, not a workflow: no role gate is imposed here
 * (who may decide an absence is a later owner decision, plan §7). Throws `absence.not_found` if no
 * such absence exists under the tenant (never created, or hidden by RLS).
 */
export async function setAbsenceStatus(
  tx: Transaction,
  input: SetAbsenceStatusInput,
): Promise<void> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    update absences
    set status = ${input.status},
        decided_by_person_id = ${input.decidedByPersonId},
        decided_at = now()
    where tenant_id = ${input.tenantId} and id = ${input.absenceId}
    returning id`);
  if (rows.length === 0) {
    throw new AppError("absence.not_found", {
      tenantId: input.tenantId,
      absenceId: input.absenceId,
    });
  }
}

/** One requested absence awaiting a manager decision (the approvals queue). */
export interface PendingAbsenceRow {
  id: string;
  personId: string;
  kind: AbsenceKind;
  /** YYYY-MM-DD, inclusive (::text cast, the getRoster date pattern). */
  startsOn: string;
  endsOn: string;
  /** Always `requested` for this query. */
  status: AbsenceStatus;
  note: string | null;
  createdAt: string;
}

/**
 * The tenant's REQUESTED absences awaiting a manager decision, ordered by `created_at` (design §3b).
 * Tenant-scoped — `absences` has no location.
 */
export async function listPendingAbsences(
  tx: Transaction,
  input: { tenantId: string },
): Promise<PendingAbsenceRow[]> {
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
    where tenant_id = ${input.tenantId} and status = 'requested'
    order by created_at`);
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
