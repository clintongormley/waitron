// Side-effect only: keeps ./errors.ts reachable from this package's own public barrel
// (index.ts), mirroring record-sale.ts's/record-void.ts's identical import — see errors.ts for
// why and errors.reachability.test.ts for the mechanical check. Nothing in THIS file throws;
// this module documents chain.verification_failed's shape (RecordIncidentInput's own doc
// comment) without constructing one — that happens in record-sale.ts/record-void.ts.
import "./errors.js";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { incidents } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { AppError } from "@waitron/shared";
import type { SaleId, TenantId, TillId } from "@waitron/shared";

export type IncidentSeverity = "warning" | "error";

export interface RecordIncidentInput {
  tenantId: TenantId;
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
 * Records a fiscal incident on the caller's transaction.
 *
 * Always the caller's transaction, never a fresh connection: an incident that committed while
 * its sale rolled back would report a chain failure for a sale that never existed, and support
 * would chase it. `incidents.params` is jsonb, and an `AppError` instance would not survive the
 * JSON round-trip (its `message`/`stack`/prototype are not data) — only `.code` and `.params` are
 * written, which is the structured-code-plus-params shape spec §9 requires crossing any boundary.
 */
export async function recordIncident(tx: Transaction, input: RecordIncidentInput): Promise<void> {
  await tx.insert(incidents).values({
    tenantId: input.tenantId,
    tillId: input.tillId,
    saleId: input.saleId ?? null,
    code: input.error.code,
    params: input.error.params,
    severity: input.severity,
    detectedAt: input.detectedAt.toISOString(),
  });
}

/**
 * Like `recordIncident`, but raises AT MOST ONE open incident per `(tenant_id, till_id, code,
 * sale_id)`: a guarded insert that no-ops when an UNACKNOWLEDGED incident for that key already
 * exists, so a periodic caller (reconcile's sweep) that re-detects a still-open condition each pass
 * does not accumulate a duplicate row every time. Returns whether it inserted (`true`) or de-duped
 * (`false`) — the caller counts only real raises. Once the prior incident is acknowledged, the key
 * is free again and the next detection raises afresh (a genuinely-unresolved condition resurfaces).
 *
 * Single-statement `insert … where not exists` — NOT a race-free primitive: two transactions CAN
 * both pass the `where not exists` and both insert, because no unique constraint serialises them.
 * This relies on the caller's invocation pattern: reconcile runs once per tenant/period with no
 * concurrent same-tenant sweep (unlike the drainer's SKIP-LOCKED contention), so a partial unique
 * index is not needed here — and adding one would change every `recordIncident` insert, the
 * drainer's included. A future caller that DOES issue concurrent same-key raises must add
 * `(tenant_id, till_id, code, sale_id) where acknowledged_at is null` as a partial unique index and
 * switch this to `on conflict do nothing`. `recordIncident` (the unconditional insert) stays for
 * callers that intend one row per event.
 */
export async function recordIncidentOnce(
  tx: Transaction,
  input: RecordIncidentInput,
): Promise<boolean> {
  const saleId = input.saleId ?? null;
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into incidents (tenant_id, till_id, sale_id, code, params, severity, detected_at)
    select ${input.tenantId}, ${input.tillId}, ${saleId}, ${input.error.code},
           ${JSON.stringify(input.error.params)}::jsonb, ${input.severity},
           ${input.detectedAt.toISOString()}
    where not exists (
      select 1 from incidents
      where tenant_id = ${input.tenantId} and till_id = ${input.tillId}
        and code = ${input.error.code} and sale_id is not distinct from ${saleId}
        and acknowledged_at is null
    )
    returning id
  `);
  return rows.length > 0;
}

/**
 * The query the till UI will read for its persistent incident banner.
 *
 * Unacknowledged only, newest first, scoped to one till. Defined here rather than in the UI so
 * that the module boundary holds: the till never reads module-owned tables, and an incident
 * raised by plan 3's drainer surfaces through this same query with no UI change.
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
    // incidents.detected_at is mode: "string" (packages/db/src/schema/incidents.ts) — a JS Date
    // normalises through the host timezone the moment anything formats it, so the column stores
    // the literal and this is the one place it becomes a Date again, for the caller's own sort/
    // display use.
    severity: row.severity as IncidentSeverity,
    detectedAt: new Date(row.detectedAt),
  }));
}
