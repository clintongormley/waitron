import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { WorkforceBackend, WORKFORCE_MIGRATIONS } from "@waitron/workforce";
import { resolveWorkTimeRuleset } from "./convenio.js";
import { WORKFORCE_ES_MIGRATIONS } from "./migrations.js";
import { seedConvenioConfig, seedEmployment, seedLocation, seedPerson } from "../test/fixtures.js";

const backend = new WorkforceBackend();
let tenantId: string;

const suite = usePgliteDb({
  // Core first — the tenants/locations FKs. Then workforce (persons/employments/time_entries) and
  // workforce-es (convenio_config): the end-to-end path reads all three.
  migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS, WORKFORCE_ES_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
  },
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.db, tenantId, fn);
}

async function clockDay(
  personId: string,
  locationId: string,
  date: string,
  from: string,
  to: string,
): Promise<void> {
  await run((tx) =>
    backend.clockIn(tx, {
      tenantId,
      personId,
      locationId,
      at: `${date}T${from}:00Z`,
      offsetMinutes: 0,
    }),
  );
  await run((tx) =>
    backend.clockOut(tx, {
      tenantId,
      personId,
      locationId,
      at: `${date}T${to}:00Z`,
      offsetMinutes: 0,
    }),
  );
}

describe("workSummary driven by a resolved convenio_config ruleset", () => {
  it("reproduces today's numbers exactly from a DEFAULT convenio_config row", async () => {
    // The behaviour-preserving proof (§3, §7): with a default convenio_config row — working_days=5,
    // overtime_model=daily_accrual — the resolved ruleset drives workSummary to the SAME output the
    // hard-coded defaults produced. Five 9h days against a 40h week: 2700 worked, 300 overtime, each
    // day 60 over its 480 target. These are the identical figures clocking.test.ts pins for the
    // pre-D2 path.
    const locationId = await seedLocation(suite.db, tenantId);
    const personId = await seedPerson(suite.db, tenantId, "es-default");
    await seedEmployment(suite.db, { tenantId, personId, contractedMinutesPerWeek: 2400 });
    await seedConvenioConfig(suite.db, { tenantId, locationId });
    for (const day of ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"]) {
      await clockDay(personId, locationId, day, "08:00", "17:00");
    }

    const ruleset = await run((tx) => resolveWorkTimeRuleset(tx, { tenantId, locationId }));
    const summary = await run((tx) =>
      backend.workSummary(
        tx,
        { tenantId, personId, period: { start: "2026-01-05", end: "2026-01-12" } },
        ruleset,
      ),
    );

    expect(summary).toEqual({
      workedMinutes: 2700,
      contractedMinutes: 2400,
      dailyAccrualOvertimeMinutes: 300,
      periodNetOvertimeMinutes: 300,
      overtimeMinutes: 300,
      days: ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"].map(
        (workDate) => ({
          workDate,
          workedMinutes: 540,
          contractedTargetMinutes: 480,
          overtimeMinutes: 60,
        }),
      ),
    });
  });

  it("changes only the headline when the convenio's overtime_model is flipped to period_net", async () => {
    // Same worked data, two convenio_config rows differing ONLY in overtime_model. A 9h day then a 7h
    // day is 60 daily-accrual but 0 period-net against a full-week baseline. The two rulesets must
    // move ONLY the headline `overtimeMinutes`; both underlying figures are computed regardless and
    // stay identical between the two calls.
    const dailyLoc = await seedLocation(suite.db, tenantId);
    const periodLoc = await seedLocation(suite.db, tenantId);
    const personId = await seedPerson(suite.db, tenantId, "es-model");
    await seedEmployment(suite.db, { tenantId, personId, contractedMinutesPerWeek: 2400 });
    await seedConvenioConfig(suite.db, {
      tenantId,
      locationId: dailyLoc,
      overtimeModel: "daily_accrual",
    });
    await seedConvenioConfig(suite.db, {
      tenantId,
      locationId: periodLoc,
      overtimeModel: "period_net",
    });
    await clockDay(personId, dailyLoc, "2026-01-05", "08:00", "17:00"); // 9h
    await clockDay(personId, dailyLoc, "2026-01-06", "09:00", "16:00"); // 7h

    const query = {
      tenantId,
      personId,
      period: { start: "2026-01-05", end: "2026-01-12" },
    } as const;
    const dailyRuleset = await run((tx) =>
      resolveWorkTimeRuleset(tx, { tenantId, locationId: dailyLoc }),
    );
    const periodRuleset = await run((tx) =>
      resolveWorkTimeRuleset(tx, { tenantId, locationId: periodLoc }),
    );
    const daily = await run((tx) => backend.workSummary(tx, query, dailyRuleset));
    const period = await run((tx) => backend.workSummary(tx, query, periodRuleset));

    expect(daily.overtimeMinutes).toBe(60);
    expect(period.overtimeMinutes).toBe(0);
    // Only the headline moved: both underlying figures are identical between the two calls.
    expect(daily.dailyAccrualOvertimeMinutes).toBe(60);
    expect(period.dailyAccrualOvertimeMinutes).toBe(60);
    expect(daily.periodNetOvertimeMinutes).toBe(0);
    expect(period.periodNetOvertimeMinutes).toBe(0);
  });
});
