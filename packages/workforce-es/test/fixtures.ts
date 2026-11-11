import type { Database, Transaction } from "@waitron/db";
import { convenioConfig } from "../src/schema/convenio-config.js";

/**
 * Fixture strings stay English: the data is regime-neutral; only the legal rendering is Spanish.
 */
export { seedEmployment, seedLocation, seedPerson } from "@waitron/workforce/test/fixtures.js";

export async function seedConvenioConfig(
  db: Database | Transaction,
  params: {
    workingDaysPerWeek?: number;
    overtimeModel?: "daily_accrual" | "period_net";
  } = {},
): Promise<void> {
  await db.insert(convenioConfig).values({
    id: 1,
    ...(params.workingDaysPerWeek === undefined
      ? {}
      : { workingDaysPerWeek: params.workingDaysPerWeek }),
    ...(params.overtimeModel === undefined ? {} : { overtimeModel: params.overtimeModel }),
  });
}
