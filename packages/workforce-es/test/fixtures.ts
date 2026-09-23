import type { Database, Transaction } from "@waitron/db";
import { convenioConfig } from "../src/schema/convenio-config.js";

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
 * A `convenio_config` row for the location. With no overrides it is a DEFAULT row — only
 * location_id is set, so every rule takes its DB-default (the ET statutory floor /
 * today's default), which is what lets D2.0 reproduce current behaviour. Pass `workingDaysPerWeek`
 * or `overtimeModel` to override a single rule.
 */
export async function seedConvenioConfig(
  db: Database | Transaction,
  params: {
    locationId: string;
    workingDaysPerWeek?: number;
    overtimeModel?: "daily_accrual" | "period_net";
  },
): Promise<void> {
  // Through drizzle rather than raw SQL: `id` and `created_at` take their value from the table's
  // `$defaultFn`, which drizzle runs per insert. They are NOT SQL DEFAULTs, so a raw insert that
  // named neither would be refused `NOT NULL constraint failed: convenio_config.id`. A rule column
  // the caller did not override is still left out of the statement, so it takes the column DEFAULT
  // the migration declares — which is what a "default row" means here.
  await db.insert(convenioConfig).values({
    locationId: params.locationId,
    ...(params.workingDaysPerWeek === undefined
      ? {}
      : { workingDaysPerWeek: params.workingDaysPerWeek }),
    ...(params.overtimeModel === undefined ? {} : { overtimeModel: params.overtimeModel }),
  });
}
