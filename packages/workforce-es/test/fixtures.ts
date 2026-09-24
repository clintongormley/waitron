import type { Database, Transaction } from "@waitron/db";
import { convenioConfig } from "../src/schema/convenio-config.js";

/**
 * `@waitron/workforce` has no `exports` map, so the deep `test/` path resolves.
 *
 * Fixture strings stay English: the data is regime-neutral; only the legal rendering is Spanish.
 */
export { seedEmployment, seedLocation, seedPerson } from "@waitron/workforce/test/fixtures.js";

/**
 * A `convenio_config` row for the location. With no overrides it is a DEFAULT row — only
 * location_id is set, so every rule takes its DB-default (the ET statutory floor /
 * today's default). Pass `workingDaysPerWeek` or `overtimeModel` to override a single rule.
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
  // `$defaultFn`, which drizzle runs per insert; they are NOT SQL DEFAULTs. A rule column the caller
  // did not override is left out of the statement, so it takes the column DEFAULT the migration
  // declares.
  await db.insert(convenioConfig).values({
    locationId: params.locationId,
    ...(params.workingDaysPerWeek === undefined
      ? {}
      : { workingDaysPerWeek: params.workingDaysPerWeek }),
    ...(params.overtimeModel === undefined ? {} : { overtimeModel: params.overtimeModel }),
  });
}
