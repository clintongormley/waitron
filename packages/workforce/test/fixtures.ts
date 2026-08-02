import { sql } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
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

/** Appends one clock event. `recorded_by_person_id` defaults to the subject (self-service). */
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
  await tx.execute(sql`
    insert into time_entries (
      tenant_id, person_id, location_id, entry_kind, event_at, event_offset_minutes,
      recorded_by_person_id
    ) values (
      ${params.tenantId}, ${params.personId}, ${params.locationId},
      ${params.entryKind ?? "in"}, ${params.eventAt ?? "2026-01-05T09:00:00Z"},
      ${params.offsetMinutes ?? 0}, ${params.personId}
    )`);
}
