import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { captureError, pgErrorMessage, withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { DEFAULTS } from "./derive.js";
import { runDue } from "./run.js";
import { FakeDuty } from "./testing/fake-duty.js";
import { startRealPostgres } from "./testing/postgres.js";
import { seedTenant } from "@waitron/db/testing/seed.js";

// A non-superuser LOGIN role inheriting app_user's grants. Being non-superuser is what makes RLS
// apply at all — a superuser bypasses FORCE ROW LEVEL SECURITY, which is why PGlite cannot prove
// any of this. runDue touches three privileges on scheduled_runs: SELECT (readSnapshot), INSERT
// (claimGap, enqueueSuccessor) and UPDATE (claimRow, completeRun). A missing grant on any one of
// them is invisible under PGlite and only surfaces here.
const PROBE_ROLE = "scheduler_rls_probe";
const PROBE_PASSWORD = "probe";

const NOW = new Date("2026-07-25T04:00:00Z");

const suite = useRealPostgres({
  start: startRealPostgres,
  probeRole: { name: PROBE_ROLE, password: PROBE_PASSWORD, inRole: "app_user" },
});

describe("the scheduler under real row-level security", () => {
  it("claims, runs and completes as a non-superuser app_user member", async () => {
    const tenantId = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const duty = new FakeDuty("rls.duty", () =>
        Promise.resolve({ summary: { ok: true }, resweepAfter: new Date("2026-07-26T04:00:00Z") }),
      );
      const result = await runDue({ db: probe, duties: [duty], ...DEFAULTS }, [tenantId], NOW);
      expect(result.ran).toHaveLength(1);
      expect(result.ran[0]).toMatchObject({ outcome: "succeeded" });
      expect(result.skipped).toEqual([]);
    } finally {
      await probe.close();
    }
  });

  it("hides another tenant's runs", async () => {
    const mine = await seedTenant(suite.admin);
    const theirs = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await runDue({ db: probe, duties: [new FakeDuty("rls.duty")], ...DEFAULTS }, [theirs], NOW);

      // Read back as the superuser, which bypasses RLS: without this, a `runDue` that silently
      // claimed nothing for `theirs` (an unrelated bug, nothing to do with isolation) would leave
      // the table empty and the scoped read below would report "0" for the wrong reason — hiding
      // nothing is not the same as hiding something. This is the assertion that tells them apart.
      const actual = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from scheduled_runs where tenant_id = ${theirs}`,
      );
      expect(actual.rows[0]!.count).toBe("1");

      const visible = await withTenant(probe, mine, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) as count from scheduled_runs`),
      );
      expect(visible.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("refuses to write a row for a tenant other than the scoped one", async () => {
    const mine = await seedTenant(suite.admin);
    const theirs = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // Not `.rejects.toThrow(/row-level security/i)`: drizzle-orm wraps every failed query in a
      // `DrizzleQueryError` whose own `.message` is `Failed query: ...` — the actual Postgres text
      // lives on `.cause`, per packages/db's tenancy.test.ts and testing/errors.ts. `pgErrorMessage`
      // is exported from @waitron/db precisely for a module package's own suite to read the real
      // driver message instead of asserting against the wrapper's generic text.
      const error = await captureError(() =>
        withTenant(probe, mine, (tx) =>
          tx.execute(sql`
            insert into scheduled_runs (tenant_id, duty, period_from, period_to, state)
            values (${theirs}, 'x', '2026-07-24T00:00:00Z', '2026-07-25T00:00:00Z', 'pending')`),
        ),
      );
      expect(pgErrorMessage(error)).toMatch(/row-level security/i);
    } finally {
      await probe.close();
    }
  });
});
