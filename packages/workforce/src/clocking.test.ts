import { CORE_MIGRATIONS, captureError, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { WorkforceBackend, type ClockEventInput } from "./clocking.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { seedEmployment, seedLocation, seedPerson } from "../test/fixtures.js";

const backend = new WorkforceBackend();

/** What a default `convenio_config` row resolves to; this package cannot import the -es resolver,
 * and `packages/workforce-es`'s `work-summary.test.ts` pins that it resolves to these. */
const DEFAULT_RULESET = {
  workingDaysPerWeek: 5,
  overtimeModel: "daily-accrual",
  dailyTargetMinutes: null,
} as const;

let locationId: string;
let nodeId: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
    locationId = await seedLocation(db);
    nodeId = await seedNode(db, brandLocationId(locationId));
  },
});

async function freshPerson(name: string): Promise<string> {
  return seedPerson(suite.db, name);
}

function event(personId: string, at: string): ClockEventInput {
  return { nodeId, personId, locationId, at, offsetMinutes: 0 };
}

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

async function codeOfRejection(fn: () => Promise<unknown>): Promise<string | undefined> {
  const error = await captureError(fn);
  return error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;
}

describe("clock state machine", () => {
  it("records an in event when the worker is clocked out", async () => {
    const p = await freshPerson("in-1");
    await run((tx) => backend.clockIn(tx, event(p, "2026-01-05T09:00:00Z")));
    const rows = await suite.db.execute<{ entry_kind: string }>(
      sql`select entry_kind from time_entries where person_id = ${p}`,
    );
    expect(rows.rows).toEqual([{ entry_kind: "in" }]);
  });

  it("rejects a second clock-in while already clocked in", async () => {
    const p = await freshPerson("in-2");
    await run((tx) => backend.clockIn(tx, event(p, "2026-01-05T09:00:00Z")));
    const code = await codeOfRejection(() =>
      run((tx) => backend.clockIn(tx, event(p, "2026-01-05T10:00:00Z"))),
    );
    expect(code).toBe("attendance.already_open");
  });

  it("records an out event that closes an open shift", async () => {
    const p = await freshPerson("out-1");
    await run((tx) => backend.clockIn(tx, event(p, "2026-01-05T09:00:00Z")));
    await run((tx) => backend.clockOut(tx, event(p, "2026-01-05T17:00:00Z")));
    const rows = await suite.db.execute<{ entry_kind: string }>(
      sql`select entry_kind from time_entries where person_id = ${p} order by recorded_at, sequence_no`,
    );
    expect(rows.rows.map((r) => r.entry_kind)).toEqual(["in", "out"]);
  });

  it("rejects a clock-out with no open shift", async () => {
    const p = await freshPerson("out-2");
    const code = await codeOfRejection(() =>
      run((tx) => backend.clockOut(tx, event(p, "2026-01-05T17:00:00Z"))),
    );
    expect(code).toBe("attendance.no_open_entry");
  });

  it("records a break_start and break_end within an open shift", async () => {
    const p = await freshPerson("break-1");
    await run((tx) => backend.clockIn(tx, event(p, "2026-01-05T09:00:00Z")));
    await run((tx) => backend.breakStart(tx, event(p, "2026-01-05T13:00:00Z")));
    await run((tx) => backend.breakEnd(tx, event(p, "2026-01-05T13:30:00Z")));
    const rows = await suite.db.execute<{ entry_kind: string }>(
      sql`select entry_kind from time_entries where person_id = ${p} order by recorded_at, sequence_no`,
    );
    expect(rows.rows.map((r) => r.entry_kind)).toEqual(["in", "break_start", "break_end"]);
  });

  it("rejects a break_start when clocked out", async () => {
    const p = await freshPerson("break-2");
    const code = await codeOfRejection(() =>
      run((tx) => backend.breakStart(tx, event(p, "2026-01-05T13:00:00Z"))),
    );
    expect(code).toBe("attendance.no_open_entry");
  });

  it("rejects a second break_start while already on break", async () => {
    const p = await freshPerson("break-3");
    await run((tx) => backend.clockIn(tx, event(p, "2026-01-05T09:00:00Z")));
    await run((tx) => backend.breakStart(tx, event(p, "2026-01-05T13:00:00Z")));
    const code = await codeOfRejection(() =>
      run((tx) => backend.breakStart(tx, event(p, "2026-01-05T13:15:00Z"))),
    );
    expect(code).toBe("attendance.already_open");
  });

  it("rejects a break_end with no open break", async () => {
    const p = await freshPerson("break-4");
    await run((tx) => backend.clockIn(tx, event(p, "2026-01-05T09:00:00Z")));
    const code = await codeOfRejection(() =>
      run((tx) => backend.breakEnd(tx, event(p, "2026-01-05T13:00:00Z"))),
    );
    expect(code).toBe("attendance.no_open_entry");
  });

  it("records the till and the recorder when supplied", async () => {
    const p = await freshPerson("attribution");
    const supervisor = await freshPerson("supervisor");
    await run((tx) =>
      backend.clockIn(tx, {
        nodeId,
        personId: p,
        locationId,
        at: "2026-01-05T09:00:00Z",
        offsetMinutes: 0,
        recordedByPersonId: supervisor,
      }),
    );
    const rows = await suite.db.execute<{ recorded_by_person_id: string }>(
      sql`select recorded_by_person_id from time_entries where person_id = ${p}`,
    );
    expect(rows.rows[0]?.recorded_by_person_id).toBe(supervisor);
  });
});

describe("workSummary", () => {
  async function nineHourDay(personId: string, date: string): Promise<void> {
    await run((tx) => backend.clockIn(tx, event(personId, `${date}T08:00:00Z`)));
    await run((tx) => backend.clockOut(tx, event(personId, `${date}T17:00:00Z`)));
  }

  it("reports worked and both overtime figures against the employment's contracted week", async () => {
    // Every day runs 60 over its 480 target, so the two models agree at 300.
    const p = await freshPerson("summary-over");
    await seedEmployment(suite.db, { personId: p, contractedMinutesPerWeek: 2400 });
    for (const day of ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"]) {
      await nineHourDay(p, day);
    }
    const summary = await run((tx) =>
      backend.workSummary(
        tx,
        {
          personId: p,
          period: { start: "2026-01-05", end: "2026-01-12" },
        },
        DEFAULT_RULESET,
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

  it("scales the period-net baseline to the period length while the daily model stays per-day", async () => {
    // Two weeks make a 4800 period-net baseline, so one 9h day is no period-net overtime but is still
    // 60 over its daily target.
    const p = await freshPerson("summary-scaled");
    await seedEmployment(suite.db, { personId: p, contractedMinutesPerWeek: 2400 });
    await nineHourDay(p, "2026-01-05");
    const summary = await run((tx) =>
      backend.workSummary(
        tx,
        {
          personId: p,
          period: { start: "2026-01-05", end: "2026-01-19" },
        },
        DEFAULT_RULESET,
      ),
    );
    expect(summary).toEqual({
      workedMinutes: 540,
      contractedMinutes: 4800,
      dailyAccrualOvertimeMinutes: 60,
      periodNetOvertimeMinutes: 0,
      overtimeMinutes: 60,
      days: [
        {
          workDate: "2026-01-05",
          workedMinutes: 540,
          contractedTargetMinutes: 480,
          overtimeMinutes: 60,
        },
      ],
    });
  });

  it("sizes the daily target from a supplied working_days_per_week, not the 5-day default", async () => {
    // 2400 ÷ 6 = 400, so a 9h day is 140 over it, where 5 days would give 480 and 60.
    const p = await freshPerson("summary-6day");
    await seedEmployment(suite.db, { personId: p, contractedMinutesPerWeek: 2400 });
    await nineHourDay(p, "2026-01-05");
    const summary = await run((tx) =>
      backend.workSummary(
        tx,
        { personId: p, period: { start: "2026-01-05", end: "2026-01-12" } },
        { ...DEFAULT_RULESET, workingDaysPerWeek: 6 },
      ),
    );
    expect(summary.days[0]?.contractedTargetMinutes).toBe(400);
    expect(summary.dailyAccrualOvertimeMinutes).toBe(140);
  });

  it("uses an explicit dailyTargetMinutes override as the daily-accrual target, bypassing the weekly derivation", async () => {
    // The override bypasses the weekly ÷ working-days derivation, which would give 480 and 60.
    const p = await freshPerson("summary-daily-override");
    await seedEmployment(suite.db, { personId: p, contractedMinutesPerWeek: 2400 });
    await nineHourDay(p, "2026-01-05");
    const summary = await run((tx) =>
      backend.workSummary(
        tx,
        { personId: p, period: { start: "2026-01-05", end: "2026-01-12" } },
        { ...DEFAULT_RULESET, dailyTargetMinutes: 400 },
      ),
    );
    expect(summary.days[0]?.contractedTargetMinutes).toBe(400);
    expect(summary.dailyAccrualOvertimeMinutes).toBe(140);
  });

  it("selects the headline overtime model from the options, changing only the headline", async () => {
    // 60 daily-accrual but 0 period-net; flipping the model must move only the headline.
    const p = await freshPerson("summary-model");
    await seedEmployment(suite.db, { personId: p, contractedMinutesPerWeek: 2400 });
    await run((tx) => backend.clockIn(tx, event(p, "2026-01-05T08:00:00Z"))); // 9h
    await run((tx) => backend.clockOut(tx, event(p, "2026-01-05T17:00:00Z")));
    await run((tx) => backend.clockIn(tx, event(p, "2026-01-06T09:00:00Z"))); // 7h
    await run((tx) => backend.clockOut(tx, event(p, "2026-01-06T16:00:00Z")));
    const query = { personId: p, period: { start: "2026-01-05", end: "2026-01-12" } };

    const daily = await run((tx) =>
      backend.workSummary(tx, query, { ...DEFAULT_RULESET, overtimeModel: "daily-accrual" }),
    );
    const period = await run((tx) =>
      backend.workSummary(tx, query, { ...DEFAULT_RULESET, overtimeModel: "period-net" }),
    );

    expect(daily.overtimeMinutes).toBe(60);
    expect(period.overtimeMinutes).toBe(0);
    expect(period.dailyAccrualOvertimeMinutes).toBe(60);
    expect(period.periodNetOvertimeMinutes).toBe(0);
    expect(daily.dailyAccrualOvertimeMinutes).toBe(period.dailyAccrualOvertimeMinutes);
    expect(daily.periodNetOvertimeMinutes).toBe(period.periodNetOvertimeMinutes);
  });

  it("throws employment.not_found when the person has no employment", async () => {
    const p = await freshPerson("summary-no-employment");
    const code = await codeOfRejection(() =>
      run((tx) =>
        backend.workSummary(
          tx,
          {
            personId: p,
            period: { start: "2026-01-05", end: "2026-01-12" },
          },
          DEFAULT_RULESET,
        ),
      ),
    );
    expect(code).toBe("employment.not_found");
  });
});
