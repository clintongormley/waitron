import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WorkforceBackend, WORKFORCE_MIGRATIONS } from "@waitron/workforce";
import { resolveWorkTimeRuleset } from "./convenio.js";
import { WORKFORCE_ES_MIGRATIONS } from "./migrations.js";
import { seedConvenioConfig, seedEmployment, seedLocation, seedPerson } from "../test/fixtures.js";

const backend = new WorkforceBackend();

const suite = useVenueDb({
  resetPerTest: false,
  // Core first (tenants/locations FKs), then identity (persons), then workforce
  // (employments/time_entries, which FK persons) and workforce-es (convenio_config): the end-to-end
  // path reads all four.
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS, WORKFORCE_ES_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
  },
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

async function clockDay(
  personId: string,
  nodeId: string,
  locationId: string,
  date: string,
  from: string,
  to: string,
): Promise<void> {
  await run((tx) =>
    backend.clockIn(tx, {
      nodeId,
      personId,
      locationId,
      at: `${date}T${from}:00Z`,
      offsetMinutes: 0,
    }),
  );
  await run((tx) =>
    backend.clockOut(tx, {
      nodeId,
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
    const locationId = await seedLocation(suite.db);
    const nodeId = await seedNode(suite.db, brandLocationId(locationId));
    const personId = await seedPerson(suite.db, "es-default");
    await seedEmployment(suite.db, { personId, contractedMinutesPerWeek: 2400 });
    await seedConvenioConfig(suite.db, { locationId });
    for (const day of ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"]) {
      await clockDay(personId, nodeId, locationId, day, "08:00", "17:00");
    }

    const ruleset = await run((tx) => resolveWorkTimeRuleset(tx, { locationId }));
    const summary = await run((tx) =>
      backend.workSummary(
        tx,
        { personId, period: { start: "2026-01-05", end: "2026-01-12" } },
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
    const dailyLoc = await seedLocation(suite.db);
    const dailyNode = await seedNode(suite.db, brandLocationId(dailyLoc));
    const periodLoc = await seedLocation(suite.db);
    const personId = await seedPerson(suite.db, "es-model");
    await seedEmployment(suite.db, { personId, contractedMinutesPerWeek: 2400 });
    await seedConvenioConfig(suite.db, {
      locationId: dailyLoc,
      overtimeModel: "daily_accrual",
    });
    await seedConvenioConfig(suite.db, {
      locationId: periodLoc,
      overtimeModel: "period_net",
    });
    await clockDay(personId, dailyNode, dailyLoc, "2026-01-05", "08:00", "17:00"); // 9h
    await clockDay(personId, dailyNode, dailyLoc, "2026-01-06", "09:00", "16:00"); // 7h

    const query = {
      personId,
      period: { start: "2026-01-05", end: "2026-01-12" },
    } as const;
    const dailyRuleset = await run((tx) => resolveWorkTimeRuleset(tx, { locationId: dailyLoc }));
    const periodRuleset = await run((tx) => resolveWorkTimeRuleset(tx, { locationId: periodLoc }));
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
