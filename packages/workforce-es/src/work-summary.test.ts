import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, venueLocationId, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { jobOrigin } from "@waitron/shared";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WorkforceBackend, WORKFORCE_MIGRATIONS } from "@waitron/workforce";
import { resolveWorkTimeRuleset } from "./convenio.js";
import { WORKFORCE_ES_MIGRATIONS } from "./migrations.js";
import { seedConvenioConfig, seedEmployment, seedPerson } from "../test/fixtures.js";

const backend = new WorkforceBackend();

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS, WORKFORCE_ES_MIGRATIONS],
  setup: async (db) => {
    await seedVenue(db);
  },
});

// `resetPerTest: false` keeps the venue; each case's convenio_config row is removed after it.
afterEach(async () => {
  await suite.db.execute(sql`delete from convenio_config`);
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

async function clockDay(
  personId: string,
  nodeId: string,
  date: string,
  from: string,
  to: string,
): Promise<void> {
  await run((tx) =>
    backend.clockIn(tx, {
      nodeId,
      personId,
      at: `${date}T${from}:00Z`,
      offsetMinutes: 0,
      origin: jobOrigin("dashboard"),
    }),
  );
  await run((tx) =>
    backend.clockOut(tx, {
      nodeId,
      personId,
      at: `${date}T${to}:00Z`,
      offsetMinutes: 0,
      origin: jobOrigin("dashboard"),
    }),
  );
}

describe("workSummary driven by a resolved convenio_config ruleset", () => {
  it("reproduces today's numbers exactly from a DEFAULT convenio_config row", async () => {
    // Five 9h days against a 40h week: 2700 worked, 300 overtime, each day 60 over its 480 target.
    const locationId = await venueLocationId(suite.db);
    const nodeId = await seedNode(suite.db);
    const personId = await seedPerson(suite.db, "es-default");
    await seedEmployment(suite.db, { personId, contractedMinutesPerWeek: 2400 });
    await seedConvenioConfig(suite.db, { locationId });
    for (const day of ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"]) {
      await clockDay(personId, nodeId, day, "08:00", "17:00");
    }

    const ruleset = await run((tx) => resolveWorkTimeRuleset(tx));
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
    // Same worked data, two convenio_config rows differing ONLY in overtime_model, read one after
    // the other. A 9h day then a 7h day is 60 daily-accrual but 0 period-net against a full-week
    // baseline.
    const locationId = await venueLocationId(suite.db);
    const dailyNode = await seedNode(suite.db);
    const personId = await seedPerson(suite.db, "es-model");
    await seedEmployment(suite.db, { personId, contractedMinutesPerWeek: 2400 });
    await clockDay(personId, dailyNode, "2026-01-05", "08:00", "17:00"); // 9h
    await clockDay(personId, dailyNode, "2026-01-06", "09:00", "16:00"); // 7h

    const query = {
      personId,
      period: { start: "2026-01-05", end: "2026-01-12" },
    } as const;
    await seedConvenioConfig(suite.db, { locationId, overtimeModel: "daily_accrual" });
    const dailyRuleset = await run((tx) => resolveWorkTimeRuleset(tx));
    await suite.db.execute(sql`delete from convenio_config`);
    await seedConvenioConfig(suite.db, { locationId, overtimeModel: "period_net" });
    const periodRuleset = await run((tx) => resolveWorkTimeRuleset(tx));
    const daily = await run((tx) => backend.workSummary(tx, query, dailyRuleset));
    const period = await run((tx) => backend.workSummary(tx, query, periodRuleset));

    expect(daily.overtimeMinutes).toBe(60);
    expect(period.overtimeMinutes).toBe(0);
    expect(daily.dailyAccrualOvertimeMinutes).toBe(60);
    expect(period.dailyAccrualOvertimeMinutes).toBe(60);
    expect(daily.periodNetOvertimeMinutes).toBe(0);
    expect(period.periodNetOvertimeMinutes).toBe(0);
  });
});
