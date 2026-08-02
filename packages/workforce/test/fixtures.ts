import { sql } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import { appendToChain } from "../src/chain.js";
import { hashPin } from "../src/verify-pin.js";
import type { WorkforceEntryKind } from "../src/projection.js";

/**
 * Seed helpers for the workforce suites, run as the connection OWNER (superuser) so RLS is bypassed
 * — pure setup, exactly as `@waitron/db`'s own `seedTenant` documents. English fixture strings
 * throughout: this file is under `test/`, out of the English-only guard's `src` scan, but the
 * package's vocabulary is English regardless.
 */

/** A location (centro de trabajo) for the tenant. Returns its id. */
export async function seedLocation(db: Database, tenantId: string): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Main', array['en'], 'Sale on premises')
    returning id`);
  return result.rows[0]!.id;
}

/** A person for the tenant, PIN '1234'. Returns its id. */
export async function seedPerson(db: Database, tenantId: string, name = "Ana"): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    insert into persons (tenant_id, display_name, pin_hash)
    values (${tenantId}, ${name}, ${hashPin("1234")})
    returning id`);
  return result.rows[0]!.id;
}

/** An employment for the person, defaulting to a 40h (2400-minute) contracted week. Returns its id. */
export async function seedEmployment(
  db: Database | Transaction,
  params: { tenantId: string; personId: string; contractedMinutesPerWeek?: number },
): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    insert into employments (
      tenant_id, person_id, contracted_minutes_per_week, contract_type, start_date, pay_rate
    ) values (
      ${params.tenantId}, ${params.personId},
      ${params.contractedMinutesPerWeek ?? 2400}, 'full_time', '2026-01-01', '15.00'
    )
    returning id`);
  return result.rows[0]!.id;
}

/** A draft roster_versions row for the tenant/location. Defaults to a one-week period. Returns its
 * id. Planning data (mutable) — inserted as `draft` with no `published_at`. */
export async function insertRosterVersion(
  db: Database | Transaction,
  params: {
    tenantId: string;
    locationId: string;
    periodStart?: string;
    periodEnd?: string;
  },
): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    insert into roster_versions (tenant_id, location_id, period_start, period_end)
    values (
      ${params.tenantId}, ${params.locationId},
      ${params.periodStart ?? "2026-01-05"}, ${params.periodEnd ?? "2026-01-11"}
    )
    returning id`);
  return result.rows[0]!.id;
}

/** A draft `shifts` row (planning data, `roster_version_id` null until publish). Defaults to a
 * 09:00–17:00 shift on 2026-01-05, wall offset 0. Returns its id. */
export async function insertDraftShift(
  db: Database | Transaction,
  params: {
    tenantId: string;
    personId: string;
    locationId: string;
    startsAt?: string;
    startsOffsetMinutes?: number;
    endsAt?: string;
    endsOffsetMinutes?: number;
    role?: string | null;
    rosterVersionId?: string | null;
  },
): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    insert into shifts (
      tenant_id, person_id, location_id, starts_at, starts_offset_minutes,
      ends_at, ends_offset_minutes, role, roster_version_id
    ) values (
      ${params.tenantId}, ${params.personId}, ${params.locationId},
      ${params.startsAt ?? "2026-01-05T09:00:00Z"}, ${params.startsOffsetMinutes ?? 0},
      ${params.endsAt ?? "2026-01-05T17:00:00Z"}, ${params.endsOffsetMinutes ?? 0},
      ${params.role ?? null}, ${params.rosterVersionId ?? null}
    )
    returning id`);
  return result.rows[0]!.id;
}

/** Appends one clock event THROUGH the Slice-4 chain, so seeded rows are chained exactly as the
 * write path produces them (`recorded_by_person_id` defaults to the subject — self-service).
 *
 * Wrapped in `.transaction()` because `appendToChain` needs a Transaction for its savepoint retry
 * and its `FOR UPDATE` head lock; both a `Database` (BEGIN) and a `Transaction` (SAVEPOINT) expose
 * `.transaction()`, so this fixture works whether a suite hands it a pool or a live tenant tx. */
export async function insertTimeEntry(
  tx: Database | Transaction,
  params: {
    tenantId: string;
    personId: string;
    locationId: string;
    entryKind?: WorkforceEntryKind;
    eventAt?: string;
    offsetMinutes?: number;
  },
): Promise<void> {
  await tx.transaction((inner) =>
    appendToChain(inner, params.tenantId, params.locationId, {
      personId: params.personId,
      entryKind: params.entryKind ?? "in",
      eventAt: params.eventAt ?? "2026-01-05T09:00:00Z",
      eventOffsetMinutes: params.offsetMinutes ?? 0,
      recordedByPersonId: params.personId,
    }),
  );
}
