import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  UNIQUE_VIOLATION,
  captureError,
  engineErrorMessage,
  isRefusal,
  newId,
  nowIso,
  refusalOn,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { SCHEDULER_MIGRATIONS } from "./migrations.js";

const suite = useVenueDb({
  migrations: [SCHEDULER_MIGRATIONS],
});

/**
 * `created_at` and `updated_at`, which every raw insert below has to supply itself: both are
 * `NOT NULL`, filled by a drizzle `$defaultFn` that raw SQL never runs, with no SQL default.
 */
const NOW = nowIso();

/**
 * The key the unique index is declared ON, as the engine names it in a refusal: SQLite reports no
 * constraint name for a unique violation, only `UNIQUE constraint failed: <table>.<column>, …`.
 */
const RUN_KEY = {
  table: "scheduled_runs",
  columns: ["duty", "period_from", "generation"],
} as const;

describe("the scheduler migration set", () => {
  // Raw inserts, so each case proves the constraint the MIGRATION declares. `id` is a `$defaultFn`
  // too, and an insert omitting it is refused on `NOT NULL` before any constraint under test.
  it("rejects a period whose end does not follow its start", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into scheduled_runs (id, duty, period_from, period_to, state, created_at, updated_at)
        values (${newId()}, 'x', '2026-07-02T00:00:00Z', '2026-07-01T00:00:00Z', 'pending',
                ${NOW}, ${NOW})`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/scheduled_runs_period_ck/);
  });

  it("rejects an unknown state", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into scheduled_runs (id, duty, period_from, period_to, state, created_at, updated_at)
        values (${newId()}, 'x', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 'wat',
                ${NOW}, ${NOW})`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/scheduled_runs_state_ck/);
  });

  it("rejects a negative generation", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into scheduled_runs (id, duty, period_from, period_to, generation, state,
                                    created_at, updated_at)
        values (${newId()}, 'x', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', -1, 'pending',
                ${NOW}, ${NOW})`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/scheduled_runs_generation_ck/);
  });

  it("rejects a negative attempts count", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into scheduled_runs (id, duty, period_from, period_to, attempts, state,
                                    created_at, updated_at)
        values (${newId()}, 'x', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', -1, 'pending',
                ${NOW}, ${NOW})`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/scheduled_runs_attempts_ck/);
  });

  // The runner's gap claim is an insert that does nothing on conflict, so the insert is the lock
  // only while `scheduled_runs_key` is exactly these three columns.
  describe("the scheduled_runs_key unique index", () => {
    it("rejects a duplicate (duty, period_from, generation)", async () => {
      await suite.db.execute(sql`
        insert into scheduled_runs (id, duty, period_from, period_to, generation, state,
                                    created_at, updated_at)
        values (${newId()}, 'dup-duty', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 0,
                'pending', ${NOW}, ${NOW})`);

      const error = await captureError(() =>
        suite.db.execute(sql`
          insert into scheduled_runs (id, duty, period_from, period_to, generation, state,
                                      created_at, updated_at)
          values (${newId()}, 'dup-duty', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 0,
                  'pending', ${NOW}, ${NOW})`),
      );
      expect(refusalOn(error, UNIQUE_VIOLATION, RUN_KEY)).toBe(true);
    });

    it("accepts a re-sweep of the same period that differs only in generation", async () => {
      await suite.db.execute(sql`
        insert into scheduled_runs (id, duty, period_from, period_to, generation, state,
                                    created_at, updated_at)
        values (${newId()}, 'resweep-duty', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 0,
                'pending', ${NOW}, ${NOW})`);

      await suite.db.execute(sql`
        insert into scheduled_runs (id, duty, period_from, period_to, generation, state,
                                    created_at, updated_at)
        values (${newId()}, 'resweep-duty', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 1,
                'pending', ${NOW}, ${NOW})`);

      const rows = await suite.db.execute<{ n: number }>(sql`
        select count(*) as n from scheduled_runs
        where duty = 'resweep-duty'`);
      expect(rows.rows[0].n).toBe(2);
    });
  });
});
