// Side-effect only: registers this package's error codes (./errors.ts).
import "./errors.js";
import { and, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { devices, incidents, newId, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { AppError, isAppError, readOrigin } from "@waitron/shared";
import type { DeviceId, ErrorCode, ErrorParams, Origin, SaleId, Source } from "@waitron/shared";

export class IssuanceRefusal<C extends ErrorCode = ErrorCode> extends AppError<C> {
  declare readonly incident: { readonly origin: Origin; readonly detectedAt: Date };

  constructor(
    error: AppError<C>,
    incident: { readonly origin: Origin; readonly detectedAt: Date },
  ) {
    super(error.code, error.params as ErrorParams[C]);
    Object.defineProperty(this, "incident", { value: incident, enumerable: false });
  }
}

// The failed issuance must finish rolling back before its sale-free incident can commit.
export async function withIssuanceTransaction<T>(
  db: Database,
  fn: (tx: Transaction) => Promise<T> | T,
  log?: (level: "error", event: string, fields?: Record<string, unknown>) => void,
): Promise<T> {
  try {
    return await withTransaction(db, fn);
  } catch (error) {
    if (error instanceof IssuanceRefusal) {
      try {
        await withTransaction(db, (tx) =>
          recordIncidentOnce(tx, {
            origin: error.incident.origin,
            detectedAt: error.incident.detectedAt,
            error,
            severity: "error",
          }),
        );
      } catch (incidentError) {
        const fields = {
          incidentRecorded: false,
          incidentFailureCode: isAppError(incidentError) ? incidentError.code : "unknown",
        };
        let logged = false;
        if (log) {
          try {
            log("error", error.code, fields);
            logged = true;
          } catch {
            // The original refusal remains the caller's error if reporting fails too.
          }
        }
        if (!logged) {
          try {
            process.stderr.write(`${error.code} ${JSON.stringify(fields)}\n`);
          } catch {
            // A closed stderr must not replace the issuance refusal.
          }
        }
      }
    }
    throw error;
  }
}

export type IncidentSeverity = "warning" | "error";

export interface RecordIncidentInput {
  /** The device the problem arose on, or the job that found it. */
  origin: Origin;
  saleId?: SaleId;
  /** `code` and `params` are taken from it, never re-derived. */
  error: AppError;
  severity: IncidentSeverity;
  detectedAt: Date;
}

export interface Incident {
  id: string;
  source: Source;
  deviceId: DeviceId | null;
  saleId: SaleId | null;
  code: string;
  params: Record<string, unknown>;
  severity: IncidentSeverity;
  detectedAt: Date;
}

/**
 * Records an incident on the caller's transaction, deduplicated to at most one OPEN incident per
 * `(source, device_id, code, sale_id)` by the `incidents_open_dedup` index. Sale-linked incidents
 * share the sale's transaction; a refused issuance uses `withIssuanceTransaction` without a sale id.
 */
export async function recordIncident(tx: Transaction, input: RecordIncidentInput): Promise<void> {
  await tx
    .insert(incidents)
    .values({
      source: input.origin.source,
      deviceId: input.origin.deviceId,
      saleId: input.saleId ?? null,
      code: input.error.code,
      params: input.error.params,
      severity: input.severity,
      detectedAt: input.detectedAt.toISOString(),
    })
    .onConflictDoNothing();
}

/**
 * Like `recordIncident`, but reports whether it inserted (`true`) or found an OPEN incident with
 * the same `(source, device_id, code, sale_id)` (`false`), so a caller that re-detects a
 * still-open condition on every sweep counts only real raises. Once that incident is handled the
 * key is free again.
 */
export async function recordIncidentOnce(
  tx: Transaction,
  input: RecordIncidentInput,
): Promise<boolean> {
  const saleId = input.saleId ?? null;
  // Raw SQL rather than the builder above, for the conflict target alone: `incidents_open_dedup`
  // indexes EXPRESSIONS over `device_id` and `sale_id` (`packages/db/src/schema/incidents.ts` says
  // why), and
  // drizzle's `onConflictDoNothing({ target })` takes columns only. The target has to repeat the
  // index's expression and its partial `where`, or SQLite refuses the statement rather than
  // matching a different index. An UNTARGETED clause is not an option here: this function reads an
  // empty result as "already open", and untargeted it would read a primary-key collision the same
  // way (CLAUDE.md §3).
  //
  // `id` and `params` are supplied by hand because a raw insert runs neither the `$defaultFn`
  // generator nor the column's JSON encoder — `newId` is the same generator the column declares.
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into incidents (id, source, device_id, sale_id, code, params, severity, detected_at)
    values (${newId()}, ${input.origin.source}, ${input.origin.deviceId}, ${saleId},
            ${input.error.code}, ${JSON.stringify(input.error.params)}, ${input.severity},
            ${input.detectedAt.toISOString()})
    on conflict (source, case when device_id is null then '' else device_id end, code,
                 case when sale_id is null then '' else sale_id end)
      where acknowledged_at is null
    do nothing
    returning id
  `);
  return rows.length > 0;
}

/** Unacknowledged incidents for one source and device, newest first. Only tests call it. */
export async function openIncidents(tx: Transaction, origin: Origin): Promise<Incident[]> {
  const rows = await tx
    .select({
      id: incidents.id,
      source: incidents.source,
      deviceId: incidents.deviceId,
      saleId: incidents.saleId,
      code: incidents.code,
      params: incidents.params,
      severity: incidents.severity,
      detectedAt: incidents.detectedAt,
    })
    .from(incidents)
    .where(
      and(
        eq(incidents.source, origin.source),
        origin.deviceId === null
          ? isNull(incidents.deviceId)
          : eq(incidents.deviceId, origin.deviceId),
        isNull(incidents.acknowledgedAt),
      ),
    )
    .orderBy(desc(incidents.detectedAt));

  return rows.map((row) => ({
    id: row.id,
    ...readOrigin(row.source, row.deviceId),
    saleId: row.saleId as SaleId | null,
    code: row.code,
    params: row.params,
    severity: row.severity as IncidentSeverity,
    detectedAt: new Date(row.detectedAt),
  }));
}

/** An incident as the dashboard alerts read it: who handled it and when, if anyone has. */
export interface TenantIncident extends Incident {
  /** The device's name, kept while the device is switched off; null for a job source. */
  deviceName: string | null;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
}

const tenantIncidentColumns = {
  id: incidents.id,
  source: incidents.source,
  deviceId: incidents.deviceId,
  deviceName: devices.label,
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
  source: string;
  deviceId: string | null;
  deviceName: string | null;
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
    ...readOrigin(row.source, row.deviceId),
    deviceName: row.deviceName,
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
    .leftJoin(devices, eq(devices.id, incidents.deviceId))
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
    .leftJoin(devices, eq(devices.id, incidents.deviceId))
    .where(gte(incidents.acknowledgedAt, handledSince.toISOString()))
    .orderBy(desc(incidents.acknowledgedAt), desc(incidents.id));
  return rows.map(toTenantIncident);
}

/** One incident by id, or `null` when no incident has that id. */
export async function findIncident(tx: Transaction, id: string): Promise<TenantIncident | null> {
  const [row] = await tx
    .select(tenantIncidentColumns)
    .from(incidents)
    .leftJoin(devices, eq(devices.id, incidents.deviceId))
    .where(eq(incidents.id, id));
  return row === undefined ? null : toTenantIncident(row);
}

export async function currentIncidentsOf(
  tx: Transaction,
  input: { origin: Origin; code: string },
): Promise<{ open: TenantIncident | null; lastHandled: TenantIncident | null }> {
  const ofCode = and(
    eq(incidents.source, input.origin.source),
    input.origin.deviceId === null
      ? isNull(incidents.deviceId)
      : eq(incidents.deviceId, input.origin.deviceId),
    eq(incidents.code, input.code),
  );
  const [open] = await tx
    .select(tenantIncidentColumns)
    .from(incidents)
    .leftJoin(devices, eq(devices.id, incidents.deviceId))
    .where(and(ofCode, isNull(incidents.acknowledgedAt)))
    .orderBy(desc(incidents.detectedAt), desc(incidents.id))
    .limit(1);
  const [lastHandled] = await tx
    .select(tenantIncidentColumns)
    .from(incidents)
    .leftJoin(devices, eq(devices.id, incidents.deviceId))
    .where(and(ofCode, isNotNull(incidents.acknowledgedAt)))
    // One sweep's two transactions share a `now`, so a replaced incident and its successor can be
    // handled at one instant; the later-detected of the two is the successor.
    .orderBy(desc(incidents.acknowledgedAt), desc(incidents.detectedAt), desc(incidents.id))
    .limit(1);
  return {
    open: open === undefined ? null : toTenantIncident(open),
    lastHandled: lastHandled === undefined ? null : toTenantIncident(lastHandled),
  };
}

/**
 * Marks an open incident handled, with an optional note, and answers whether it did. Marking an
 * already-handled incident changes nothing, so it keeps its first handler, time and note. Handling
 * frees the `incidents_open_dedup` key: a producer that detects the same condition again records a
 * new incident. A null `personId` is the system handling it.
 */
export async function markIncidentHandled(
  tx: Transaction,
  input: { id: string; personId: string | null; handledAt: Date; note?: string | null },
): Promise<boolean> {
  const changed = await tx
    .update(incidents)
    .set({
      acknowledgedAt: input.handledAt.toISOString(),
      acknowledgedBy: input.personId,
      acknowledgedNote: input.note ?? null,
    })
    .where(and(eq(incidents.id, input.id), isNull(incidents.acknowledgedAt)))
    .returning({ id: incidents.id });
  return changed.length > 0;
}

export type AddIncidentNoteResult = "added" | "note_exists" | "not_handled" | "not_found";

/** Adds a note to a handled incident that has none; a note, once there, is never replaced. */
export async function addIncidentNote(
  tx: Transaction,
  input: { id: string; note: string },
): Promise<AddIncidentNoteResult> {
  const changed = await tx
    .update(incidents)
    .set({ acknowledgedNote: input.note })
    .where(
      and(
        eq(incidents.id, input.id),
        isNotNull(incidents.acknowledgedAt),
        isNull(incidents.acknowledgedNote),
      ),
    )
    .returning({ id: incidents.id });
  if (changed.length > 0) return "added";
  const [row] = await tx
    .select({ acknowledgedAt: incidents.acknowledgedAt })
    .from(incidents)
    .where(eq(incidents.id, input.id));
  if (row === undefined) return "not_found";
  return row.acknowledgedAt === null ? "not_handled" : "note_exists";
}
