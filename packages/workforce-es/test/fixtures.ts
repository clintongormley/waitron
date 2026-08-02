import { sql } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import { hashPin } from "@waitron/workforce";

/**
 * Seed helpers for the workforce-es suites, run as the connection OWNER (superuser) so RLS is
 * bypassed — pure setup, exactly as `@waitron/db`'s own `seedTenant` documents. Spanish is permitted
 * in this exempt package, but fixture strings stay English (the data is regime-neutral; only the
 * legal rendering is Spanish).
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

/** An employment for the person, defaulting to a 40h (2400-minute) contracted week. */
export async function seedEmployment(
  db: Database | Transaction,
  params: { tenantId: string; personId: string; contractedMinutesPerWeek?: number },
): Promise<void> {
  await db.execute(sql`
    insert into employments (
      tenant_id, person_id, contracted_minutes_per_week, contract_type, start_date, pay_rate
    ) values (
      ${params.tenantId}, ${params.personId},
      ${params.contractedMinutesPerWeek ?? 2400}, 'full_time', '2026-01-01', '15.00'
    )`);
}

/**
 * A `convenio_config` row for the (tenant, location). With no overrides it is a DEFAULT row — only
 * tenant_id and location_id are set, so every rule takes its DB-default (the ET statutory floor /
 * today's default), which is what lets D2.0 reproduce current behaviour. Pass `workingDaysPerWeek`
 * or `overtimeModel` to override a single rule.
 */
export async function seedConvenioConfig(
  db: Database | Transaction,
  params: {
    tenantId: string;
    locationId: string;
    workingDaysPerWeek?: number;
    overtimeModel?: "daily_accrual" | "period_net";
  },
): Promise<void> {
  const cols = [sql`tenant_id`, sql`location_id`];
  const vals = [sql`${params.tenantId}`, sql`${params.locationId}`];
  if (params.workingDaysPerWeek !== undefined) {
    cols.push(sql`working_days_per_week`);
    vals.push(sql`${params.workingDaysPerWeek}`);
  }
  if (params.overtimeModel !== undefined) {
    cols.push(sql`overtime_model`);
    vals.push(sql`${params.overtimeModel}`);
  }
  await db.execute(sql`
    insert into convenio_config (${sql.join(cols, sql`, `)})
    values (${sql.join(vals, sql`, `)})`);
}
