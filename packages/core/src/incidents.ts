// Side-effect only: keeps ./errors.ts reachable from this package's own public barrel
// (index.ts), mirroring record-sale.ts's/record-void.ts's identical import — see errors.ts for
// why and errors.reachability.test.ts for the mechanical check. Nothing in THIS file throws;
// this module documents chain.verification_failed's shape (RecordIncidentInput's own doc
// comment) without constructing one — that happens in record-sale.ts/record-void.ts.
import "./errors.js";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { incidents, newId } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { AppError } from "@waitron/shared";
import type { SaleId, TillId } from "@waitron/shared";

export type IncidentSeverity = "warning" | "error";

export interface RecordIncidentInput {
  /** Inert: nothing here reads it. apps/server still supplies it; the field goes when that does. */
  tillId: TillId;
  saleId?: SaleId;
  /** The structured error itself. `code` and `params` are taken from it, never re-derived —
   * see `./errors.ts`'s `chain.verification_failed` doc comment and `./record-sale.ts`'s use of
   * `TrustedReading.warning` verbatim for the two shapes this arrives in. */
  error: AppError;
  severity: IncidentSeverity;
  detectedAt: Date;
}

export interface Incident {
  id: string;
  tillId: TillId;
  saleId: SaleId | null;
  code: string;
  params: Record<string, unknown>;
  severity: IncidentSeverity;
  detectedAt: Date;
}

/**
 * Records a fiscal incident on the caller's transaction, deduplicated to at most one OPEN incident
 * per `(till_id, code, sale_id)` by the `incidents_open_dedup` partial unique index
 * (`ON CONFLICT DO NOTHING`). Always the caller's transaction, never a fresh connection: an incident
 * that committed while its sale rolled back would report a failure for a sale that never existed.
 * Only `.code` and `.params` are written (an `AppError` instance would not survive the jsonb round
 * trip) — the structured-code-plus-params shape spec §9 requires crossing any boundary. record-sale
 * and record-void now emit exactly ONE `chain.verification_failed` per (sale, code) — every issue
 * from a failed check is aggregated into that one incident's `params.issues` rather than pushed as
 * its own same-key row — so those callers, and the drainer's terminal transitions, genuinely never
 * conflict: each has a naturally-unique `(sale, code)` key. A caller that re-detects a still-open
 * condition (reconcile's drift) does hit the conflict and now no-ops instead of accumulating a
 * duplicate — the intended table-wide invariant.
 */
export async function recordIncident(tx: Transaction, input: RecordIncidentInput): Promise<void> {
  await tx
    .insert(incidents)
    .values({
      tillId: input.tillId,
      saleId: input.saleId ?? null,
      code: input.error.code,
      params: input.error.params,
      severity: input.severity,
      detectedAt: input.detectedAt.toISOString(),
    })
    .onConflictDoNothing();
}

/**
 * Like `recordIncident`, but reports whether it actually inserted (`true`) or de-duped against an
 * existing OPEN incident for the same `(till_id, code, sale_id)` (`false`) — so a periodic
 * caller that re-detects a still-open condition each sweep counts only real raises. Race-free: the
 * `incidents_open_dedup` partial unique index (`NULLS NOT DISTINCT`, `WHERE acknowledged_at IS NULL`)
 * is the arbiter, so two concurrent same-key callers serialise on it and exactly one inserts — the
 * property a concurrent `forward` (payments Cycle B) relies on. Once the prior incident is
 * acknowledged the key is free again and the next detection raises afresh.
 */
export async function recordIncidentOnce(
  tx: Transaction,
  input: RecordIncidentInput,
): Promise<boolean> {
  const saleId = input.saleId ?? null;
  // Raw SQL rather than the builder above, for the conflict target alone: `incidents_open_dedup`
  // indexes an EXPRESSION over `sale_id` (`packages/db/src/schema/incidents.ts` says why), and
  // drizzle's `onConflictDoNothing({ target })` takes columns only. The target has to repeat the
  // index's expression and its partial `where`, or SQLite refuses the statement rather than
  // matching a different index. An UNTARGETED clause is not an option here: this function reads an
  // empty result as "already open", and untargeted it would read a primary-key collision the same
  // way (CLAUDE.md §3).
  //
  // `id` and `params` are supplied by hand because a raw insert runs neither the `$defaultFn`
  // generator nor the column's JSON encoder — `newId` is the same generator the column declares.
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into incidents (id, till_id, sale_id, code, params, severity, detected_at)
    values (${newId()}, ${input.tillId}, ${saleId}, ${input.error.code},
            ${JSON.stringify(input.error.params)}, ${input.severity},
            ${input.detectedAt.toISOString()})
    on conflict (till_id, code, case when sale_id is null then '' else sale_id end)
      where acknowledged_at is null
    do nothing
    returning id
  `);
  return rows.length > 0;
}

/**
 * Unacknowledged incidents for one till, newest first. Only tests call it: the till shows no
 * incidents, and the dashboard alerts read them all through `listOpenIncidents`.
 */
export async function openIncidents(tx: Transaction, tillId: TillId): Promise<Incident[]> {
  const rows = await tx
    .select({
      id: incidents.id,
      tillId: incidents.tillId,
      saleId: incidents.saleId,
      code: incidents.code,
      params: incidents.params,
      severity: incidents.severity,
      detectedAt: incidents.detectedAt,
    })
    .from(incidents)
    .where(and(eq(incidents.tillId, tillId), isNull(incidents.acknowledgedAt)))
    .orderBy(desc(incidents.detectedAt));

  return rows.map((row) => ({
    id: row.id,
    tillId: row.tillId as TillId,
    saleId: row.saleId as SaleId | null,
    code: row.code,
    params: row.params,
    // incidents.detected_at is tsString (packages/db/src/schema/incidents.ts), so a read hands back
    // the string the driver rendered rather than a Date — a JS Date takes on the host timezone as
    // soon as something formats it in local time (`toString()` moves with `TZ`; `toISOString()`
    // does not), and nothing formatted is ever written. This is the one place the value becomes a
    // Date again, for the caller's own sort and display use.
    severity: row.severity as IncidentSeverity,
    detectedAt: new Date(row.detectedAt),
  }));
}

/** An incident as the dashboard alerts read it: who handled it and when, if anyone has. */
export interface TenantIncident extends Incident {
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
}

const tenantIncidentColumns = {
  id: incidents.id,
  tillId: incidents.tillId,
  saleId: incidents.saleId,
  code: incidents.code,
  params: incidents.params,
  severity: incidents.severity,
  detectedAt: incidents.detectedAt,
  acknowledgedAt: incidents.acknowledgedAt,
  acknowledgedBy: incidents.acknowledgedBy,
};

type TenantIncidentRow = {
  id: string;
  tillId: string;
  saleId: string | null;
  code: string;
  params: Record<string, unknown>;
  severity: string;
  detectedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
};

function toTenantIncident(row: TenantIncidentRow): TenantIncident {
  return {
    id: row.id,
    tillId: row.tillId as TillId,
    saleId: row.saleId as SaleId | null,
    code: row.code,
    params: row.params,
    severity: row.severity as IncidentSeverity,
    detectedAt: new Date(row.detectedAt),
    acknowledgedAt: row.acknowledgedAt === null ? null : new Date(row.acknowledgedAt),
    acknowledgedBy: row.acknowledgedBy,
  };
}

/** Every open incident, newest first; ties break on id so the order is stable. */
export async function listOpenIncidents(tx: Transaction): Promise<TenantIncident[]> {
  const rows = await tx
    .select(tenantIncidentColumns)
    .from(incidents)
    .where(isNull(incidents.acknowledgedAt))
    .orderBy(desc(incidents.detectedAt), desc(incidents.id));
  return rows.map(toTenantIncident);
}

/** Incidents handled at or after `handledSince`, most recently handled first, ties by id. */
export async function listHandledIncidents(
  tx: Transaction,
  handledSince: Date,
): Promise<TenantIncident[]> {
  const rows = await tx
    .select(tenantIncidentColumns)
    .from(incidents)
    .where(gte(incidents.acknowledgedAt, handledSince.toISOString()))
    .orderBy(desc(incidents.acknowledgedAt), desc(incidents.id));
  return rows.map(toTenantIncident);
}

/** One incident by id, or `null` when no incident has that id. */
export async function findIncident(tx: Transaction, id: string): Promise<TenantIncident | null> {
  const [row] = await tx.select(tenantIncidentColumns).from(incidents).where(eq(incidents.id, id));
  return row === undefined ? null : toTenantIncident(row);
}

/**
 * Marks an open incident handled. Marking an already-handled incident changes nothing, so it keeps
 * its first handler and time. Handling frees the `incidents_open_dedup` key: a producer that detects
 * the same condition again records a new incident.
 */
export async function markIncidentHandled(
  tx: Transaction,
  input: { id: string; personId: string; handledAt: Date },
): Promise<void> {
  await tx
    .update(incidents)
    .set({ acknowledgedAt: input.handledAt.toISOString(), acknowledgedBy: input.personId })
    .where(and(eq(incidents.id, input.id), isNull(incidents.acknowledgedAt)));
}
