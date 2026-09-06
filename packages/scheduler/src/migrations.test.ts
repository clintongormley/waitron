import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, captureError, pgErrorCode, pgErrorMessage } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { SCHEDULER_MIGRATIONS } from "./migrations.js";

/** A single real tenant row, seeded once — the unique-index tests below need the FK to actually
 * hold (unlike the CHECK-violation tests, which fail before the FK is ever consulted and so can
 * get away with a `gen_random_uuid()` tenant that names nothing). */
let tenantId: string;

const suite = usePgliteDb({
  // Core first — the tenants foreign key. Ordering across packages is the runtime's job and
  // nothing enforces it, so it is explicit here.
  migrations: [CORE_MIGRATIONS, SCHEDULER_MIGRATIONS],
  setup: async (db) => {
    const seeded = await db.execute<{ id: string }>(sql`
      insert into tenants (country, tax_id, legal_name) values ('ES', 'B00000001', 'Scheduler Test Tenant')
      returning id`);
    tenantId = seeded.rows[0].id;
  },
});

describe("the scheduler migration set", () => {
  // `.rejects.toThrow(...)` does NOT work here: drizzle wraps the driver error in
  // `DrizzleQueryError`, whose OWN `.message` is `Failed query: <sql>\nparams: ...` — not the
  // real Postgres text. Verified live. `pgErrorCode`/`pgErrorMessage` unwrap `.cause` to reach the
  // real driver error, exactly the pattern packages/fiscal-verifactu/src/migrations.test.ts and
  // packages/db/src/immutability.test.ts already use for the same reason.
  it("rejects a period whose end does not follow its start", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into scheduled_runs (tenant_id, duty, period_from, period_to, state)
        values (gen_random_uuid(), 'x', '2026-07-02T00:00:00Z', '2026-07-01T00:00:00Z', 'pending')`),
    );
    expect(pgErrorCode(error)).toBe("23514"); // check_violation
    expect(pgErrorMessage(error)).toMatch(/scheduled_runs_period_ck/);
  });

  it("rejects an unknown state", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into scheduled_runs (tenant_id, duty, period_from, period_to, state)
        values (gen_random_uuid(), 'x', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 'wat')`),
    );
    expect(pgErrorCode(error)).toBe("23514"); // check_violation
    expect(pgErrorMessage(error)).toMatch(/scheduled_runs_state_ck/);
  });

  it("rejects a negative generation", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into scheduled_runs (tenant_id, duty, period_from, period_to, generation, state)
        values (gen_random_uuid(), 'x', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', -1, 'pending')`),
    );
    expect(pgErrorCode(error)).toBe("23514"); // check_violation
    expect(pgErrorMessage(error)).toMatch(/scheduled_runs_generation_ck/);
  });

  it("rejects a negative attempts count", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into scheduled_runs (tenant_id, duty, period_from, period_to, attempts, state)
        values (gen_random_uuid(), 'x', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', -1, 'pending')`),
    );
    expect(pgErrorCode(error)).toBe("23514"); // check_violation
    expect(pgErrorMessage(error)).toMatch(/scheduled_runs_attempts_ck/);
  });

  // The single most load-bearing constraint in this schema: the runner's gap claim is an
  // `INSERT ... ON CONFLICT (tenant_id, duty, period_from, generation) DO NOTHING`, so "the insert
  // IS the lock" is true only if `scheduled_runs_key` really is exactly those four columns. A typo
  // that dropped `generation` from the index would pass every other test in this file.
  describe("the scheduled_runs_key unique index", () => {
    it("rejects a duplicate (tenant_id, duty, period_from, generation)", async () => {
      await suite.db.execute(sql`
        insert into scheduled_runs (tenant_id, duty, period_from, period_to, generation, state)
        values (${tenantId}, 'dup-duty', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 0, 'pending')`);

      const error = await captureError(() =>
        suite.db.execute(sql`
          insert into scheduled_runs (tenant_id, duty, period_from, period_to, generation, state)
          values (${tenantId}, 'dup-duty', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 0, 'pending')`),
      );
      expect(pgErrorCode(error)).toBe("23505"); // unique_violation
      expect(pgErrorMessage(error)).toMatch(/scheduled_runs_key/);
    });

    it("accepts a re-sweep of the same period that differs only in generation", async () => {
      await suite.db.execute(sql`
        insert into scheduled_runs (tenant_id, duty, period_from, period_to, generation, state)
        values (${tenantId}, 'resweep-duty', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 0, 'pending')`);

      // Same key in every column EXCEPT generation — this is the re-sweep case the column exists
      // for. If `generation` were ever dropped from the index (or the wrong column substituted in
      // it), this second insert would collide on the first row's key and throw, failing this test.
      await suite.db.execute(sql`
        insert into scheduled_runs (tenant_id, duty, period_from, period_to, generation, state)
        values (${tenantId}, 'resweep-duty', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 1, 'pending')`);

      const rows = await suite.db.execute<{ n: number }>(sql`
        select count(*)::int as n from scheduled_runs
        where tenant_id = ${tenantId} and duty = 'resweep-duty'`);
      expect(rows.rows[0].n).toBe(2);
    });
  });
});
