import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  UNIQUE_VIOLATION,
  captureError,
  isPgError,
  newId,
  nowIso,
  pgErrorMessage,
  refusalOn,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { SCHEDULER_MIGRATIONS } from "./migrations.js";

const suite = useVenueDb({
  // Core is not needed by these cases: every one passed with core removed from this list, and with
  // the two sets reversed (measured 2026-09-23). It is listed first, in manifest order.
  migrations: [CORE_MIGRATIONS, SCHEDULER_MIGRATIONS],
});

/**
 * `created_at` and `updated_at`, which every raw insert below has to supply itself.
 *
 * Both are `NOT NULL` with their value coming from a JavaScript `$defaultFn` generator
 * (`nowIso`, `./schema/scheduled-runs.ts`), and `drizzle/0000_baseline.sql` declares no SQL
 * DEFAULT for either — drizzle runs a generator for a BUILDER insert and never for raw SQL.
 * Hoisted out of the templates rather than interpolated, so no `sql` template in this package's
 * source carries a clock call at all (`scripts/postgres-sql-residue.test.ts` reads the template
 * text and cannot tell `nowIso()` apart from a PostgreSQL `now()` by eye).
 */
const NOW = nowIso();

/**
 * The key the unique index is declared ON, as the engine names it in a refusal.
 *
 * SQLite reports no CONSTRAINT NAME for a unique violation: the message is
 * `UNIQUE constraint failed: <table>.<column>, …`, which is why the assertion below reads the
 * table and columns rather than the string `scheduled_runs_key`. Measured 2026-09-22 on Node
 * v26.7.0 against this table's generated DDL: a second insert of the same three values gives
 * errcode 2067 and exactly that message, in declaration order.
 */
const RUN_KEY = {
  table: "scheduled_runs",
  columns: ["duty", "period_from", "generation"],
} as const;

describe("the scheduler migration set", () => {
  // Every insert here stays raw deliberately: what it proves is the constraint the MIGRATION
  // declares, not the values drizzle would send. `id` is supplied for the reason `NOW` states —
  // it too is a `$defaultFn` generator (`newId`) rather than a column default, so an insert
  // omitting it is refused `NOT NULL constraint failed: scheduled_runs.id` before any constraint
  // under test is reached, and every case below would pass on the wrong refusal.
  it("rejects a period whose end does not follow its start", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into scheduled_runs (id, duty, period_from, period_to, state, created_at, updated_at)
        values (${newId()}, 'x', '2026-07-02T00:00:00Z', '2026-07-01T00:00:00Z', 'pending',
                ${NOW}, ${NOW})`),
    );
    // `23514` was PostgreSQL's SQLSTATE for a CHECK violation; this engine reports extended result
    // code 275, which `CHECK_VIOLATION` names (`packages/db/src/sql-state.ts`). A CHECK is the one
    // refusal class SQLite still names, so the constraint-name half carries over unchanged —
    // measured on Node v26.7.0, the refusal reads
    // `CHECK constraint failed: scheduled_runs_period_ck`.
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    expect(pgErrorMessage(error)).toMatch(/scheduled_runs_period_ck/);
  });

  it("rejects an unknown state", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into scheduled_runs (id, duty, period_from, period_to, state, created_at, updated_at)
        values (${newId()}, 'x', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 'wat',
                ${NOW}, ${NOW})`),
    );
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    expect(pgErrorMessage(error)).toMatch(/scheduled_runs_state_ck/);
  });

  it("rejects a negative generation", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into scheduled_runs (id, duty, period_from, period_to, generation, state,
                                    created_at, updated_at)
        values (${newId()}, 'x', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', -1, 'pending',
                ${NOW}, ${NOW})`),
    );
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    expect(pgErrorMessage(error)).toMatch(/scheduled_runs_generation_ck/);
  });

  it("rejects a negative attempts count", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into scheduled_runs (id, duty, period_from, period_to, attempts, state,
                                    created_at, updated_at)
        values (${newId()}, 'x', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', -1, 'pending',
                ${NOW}, ${NOW})`),
    );
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    expect(pgErrorMessage(error)).toMatch(/scheduled_runs_attempts_ck/);
  });

  // The single most load-bearing constraint in this schema: the runner's gap claim is an
  // `INSERT ... ON CONFLICT (duty, period_from, generation) DO NOTHING`, so "the insert IS the
  // lock" is true only if `scheduled_runs_key` really is exactly those three columns. A typo
  // that dropped `generation` from the index would pass every other test in this file.
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
      // The PostgreSQL version asserted SQLSTATE `23505` plus the index's NAME in the message.
      // The name is not available here, and the replacement is stronger rather than weaker: it
      // pins the very thing the name stood in for — the exact columns, in declaration order — so a
      // key that gained, lost or reordered a column fails this, where a name match would not.
      // `UNIQUE_VIOLATION` is a list because SQLite splits the class PostgreSQL folded into one
      // SQLSTATE: 2067 for a unique index, 1555 for a primary key (`packages/db/src/sql-state.ts`).
      // Control, measured 2026-09-22 on Node v26.7.0: reinserting a duplicate `id` instead gives
      // 1555 and `UNIQUE constraint failed: scheduled_runs.id`, which this assertion REFUSES —
      // it is the key that is being identified, not merely "some row already existed".
      expect(refusalOn(error, UNIQUE_VIOLATION, RUN_KEY)).toBe(true);
    });

    it("accepts a re-sweep of the same period that differs only in generation", async () => {
      await suite.db.execute(sql`
        insert into scheduled_runs (id, duty, period_from, period_to, generation, state,
                                    created_at, updated_at)
        values (${newId()}, 'resweep-duty', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 0,
                'pending', ${NOW}, ${NOW})`);

      // Same key in every column EXCEPT generation — this is the re-sweep case the column exists
      // for. If `generation` were ever dropped from the index (or the wrong column substituted in
      // it), this second insert would collide on the first row's key and throw, failing this test.
      await suite.db.execute(sql`
        insert into scheduled_runs (id, duty, period_from, period_to, generation, state,
                                    created_at, updated_at)
        values (${newId()}, 'resweep-duty', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 1,
                'pending', ${NOW}, ${NOW})`);

      // No `::int`: the cast only flattened PostgreSQL's bigint `count` to a JavaScript number,
      // and this engine returns one already — measured 2026-09-22 on Node v26.7.0,
      // `select count(*) as n` over this table gives `{ n: 2 }` with `typeof n === "number"`,
      // while `count(*)::int` is refused at PREPARE with `unrecognized token: ":"`.
      const rows = await suite.db.execute<{ n: number }>(sql`
        select count(*) as n from scheduled_runs
        where duty = 'resweep-duty'`);
      expect(rows.rows[0].n).toBe(2);
    });
  });
});
