import { CORE_MIGRATIONS, captureError, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { AppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { WorkforceBackend, type ClockEventInput } from "./clocking.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { seedEmployment, seedLocation, seedPerson } from "../test/fixtures.js";

const backend = new WorkforceBackend();

let tenantId: string;
let locationId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
    locationId = await seedLocation(db, tenantId);
  },
});

/** A fresh person per test, so each test's clock state is isolated in the shared append-only table. */
async function freshPerson(name: string): Promise<string> {
  return seedPerson(suite.db, tenantId, name);
}

function event(personId: string, at: string): ClockEventInput {
  return { tenantId, personId, locationId, at, offsetMinutes: 0 };
}

/** Runs a backend call inside a tenant transaction, the shape a till caller uses. */
function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.db, tenantId, fn);
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
      sql`select entry_kind from time_entries where person_id = ${p} order by ingest_seq`,
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
      sql`select entry_kind from time_entries where person_id = ${p} order by ingest_seq`,
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
        tenantId,
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
  /** Clocks a plain 08:00→17:00 (9h) day for a person. */
  async function nineHourDay(personId: string, date: string): Promise<void> {
    await run((tx) => backend.clockIn(tx, event(personId, `${date}T08:00:00Z`)));
    await run((tx) => backend.clockOut(tx, event(personId, `${date}T17:00:00Z`)));
  }

  it("reports worked and both overtime figures against the employment's contracted week", async () => {
    // Five 9h days against a 40h (2400) week. Every day is 60 over its 8h (480) target, so the two
    // models agree at 300 here; the daily target is 2400 ÷ 5 = 480 (`dailyContractedTargetMinutes`).
    const p = await freshPerson("summary-over");
    await seedEmployment(suite.db, { tenantId, personId: p, contractedMinutesPerWeek: 2400 });
    for (const day of ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"]) {
      await nineHourDay(p, day);
    }
    const summary = await run((tx) =>
      backend.workSummary(tx, {
        tenantId,
        personId: p,
        period: { start: "2026-01-05", end: "2026-01-12" },
      }),
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
    // A two-week period against a 2400-minute week is a 4800-minute PERIOD-NET baseline. One 9h day
    // (540) is well under it, so period-net overtime is zero — proving the baseline is
    // period-length-scaled, not a bare weekly figure. The daily model is unaffected by period length:
    // that same day is still 60 over its 8h target, so the two figures legitimately diverge here.
    const p = await freshPerson("summary-scaled");
    await seedEmployment(suite.db, { tenantId, personId: p, contractedMinutesPerWeek: 2400 });
    await nineHourDay(p, "2026-01-05");
    const summary = await run((tx) =>
      backend.workSummary(tx, {
        tenantId,
        personId: p,
        period: { start: "2026-01-05", end: "2026-01-19" },
      }),
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

  it("throws employment.not_found when the person has no employment", async () => {
    const p = await freshPerson("summary-no-employment");
    const code = await codeOfRejection(() =>
      run((tx) =>
        backend.workSummary(tx, {
          tenantId,
          personId: p,
          period: { start: "2026-01-05", end: "2026-01-12" },
        }),
      ),
    );
    expect(code).toBe("employment.not_found");
  });
});
