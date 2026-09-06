import { sql } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";

/**
 * Seed helpers for the workforce-es suites. `seedLocation`, `seedPerson` and `seedEmployment` are
 * RE-EXPORTED from `@waitron/workforce`'s own fixtures — the identical inserts, kept in one place so
 * the -es copies cannot drift from the canonical ones. `@waitron/workforce` has no
 * `exports` map, so the deep `test/` path resolves — exactly as `packages/payments-stripe`'s
 * suites import `@waitron/payments/test/seed.js`. `seedConvenioConfig` stays local: it is
 * workforce-es-specific (there is no `convenio_config` table in the generic package).
 *
 * The canonical helpers use the fixture connection directly. Spanish is permitted in this exempt package,
 * but fixture strings stay English (the data is regime-neutral; only the legal rendering is Spanish).
 */
export { seedEmployment, seedLocation, seedPerson } from "@waitron/workforce/test/fixtures.js";

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
