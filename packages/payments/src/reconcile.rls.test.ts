import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { decimal, tenantId as brandTenantId } from "@waitron/shared";
import { recordIncidentOnce } from "@waitron/core";
import { withTenant } from "@waitron/db";
import { reconcilePayments, DEFAULT_SETTLEMENT_LAG_MS } from "./reconcile.js";
import { insertCapturedPayment } from "./store.js";
import { FakeSettlementReport } from "./testing/fake-settlement-report.js";
import { startRealPostgres } from "./testing/postgres.js";
import { seedWorkingOrder } from "../test/seed.js";

// A non-superuser LOGIN role inheriting app_user's grants. Being non-superuser is what makes RLS
// apply at all (a superuser bypasses FORCE ROW LEVEL SECURITY), which is why PGlite cannot prove
// any of this — that is the whole reason this suite exists, exactly as payments.rls.test.ts's own
// header explains. The sweep opens TWO withTenant scopes and touches THREE privileges: SELECT on
// payments + working_orders (T1's listReconcilable join), INSERT on incidents and UPDATE on
// payments (T2's recordIncidentOnce + markReconcileRemediated). A missing grant on any one of them
// is invisible under PGlite's always-superuser connection and only surfaces here.
const PROBE_ROLE = "reconcile_rls_probe";
const PROBE_PASSWORD = "probe";

// vitest.config.ts's hookTimeout, which this container start had before the helper's 60s default.
const postgres = useRealPostgres({
  start: startRealPostgres,
  probeRole: { name: PROBE_ROLE, password: PROBE_PASSWORD, inRole: "app_user" },
  timeoutMs: 180_000,
});

const NOW = new Date("2026-07-25T12:00:00Z");
/** Older than NOW - DEFAULT_SETTLEMENT_LAG_MS, so the in-flight tolerance has expired — the same
 * fixture reconcile.test.ts uses, so the orphan/unsettled shapes below are not an artifact of a
 * boundary this suite happens to dodge. */
const OLD_SETTLED = new Date("2026-07-01T12:00:00Z");
const PERIOD = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };

describe("reconcile under real row-level security", () => {
  it("sweeps, raises an incident and stamps the marker as a non-superuser app_user member", async () => {
    // Seeded as the superuser (admin) — RLS is bypassed for this setup, which is fine: the
    // working_order chain being seeded isn't the thing under test, the sweep below is.
    const seeded = await seedWorkingOrder(postgres.admin, "B33333333");
    await withTenant(postgres.admin, seeded.tenantId, (tx) =>
      insertCapturedPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "rls-1",
        externalRef: "ext-rls-1",
        amount: decimal("10.00"),
        settledAt: OLD_SETTLED,
      }),
    );
    // Abandoned + no sale_id is the orphan shape: the sweep should reverse it, not just report it.
    await postgres.admin.execute(sql`
      update working_orders set status = 'abandoned' where id = ${seeded.workingOrderId}`);

    const probe = await postgres.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const reversed: string[] = [];
      const result = await reconcilePayments(
        {
          db: probe,
          provider: "fake",
          report: new FakeSettlementReport([]),
          reverse: async (ref) => {
            reversed.push(ref);
          },
          incidents: recordIncidentOnce,
          settlementLagMs: DEFAULT_SETTLEMENT_LAG_MS,
        },
        brandTenantId(seeded.tenantId),
        PERIOD,
        NOW,
      );

      // T1's SELECT saw the row through the tenant-isolation policy (join to working_orders
      // included), T2's INSERT satisfied incidents' WITH CHECK, and T2's UPDATE (the
      // reconcile_remediated_at marker) had the grant — none of this would run at all as this
      // probe role without every one of those privileges genuinely being in place.
      expect(result.checked).toBe(1);
      expect(result.orphan).toHaveLength(1);
      expect(result.remediated).toBe(1);
      expect(reversed).toEqual(["rls-1"]);
      // orphan (abandoned, no sale_id) + unsettled (unmatched, past the lag tolerance) — see the
      // read-back below for why this row is genuinely both.
      expect(result.incidentsRaised).toBe(2);
    } finally {
      await probe.close();
    }

    // The incidents and the marker were genuinely committed under RLS — read them back as the
    // superuser, outside the probe's tenant scope. TWO incidents, not one: `rls-1` is abandoned
    // with no sale_id (orphan) AND unmatched by the empty report past the settlement-lag tolerance
    // (unsettled) — classify()'s classes are independent predicates, not a switch, so both fire.
    const inc = await postgres.admin.execute<{ code: string; severity: string }>(
      sql`select code, severity from incidents where tenant_id = ${seeded.tenantId} order by code`,
    );
    expect(inc.rows).toEqual([
      { code: "payment.reconcile_orphan", severity: "error" },
      { code: "payment.reconcile_unsettled", severity: "warning" },
    ]);

    const marker = await postgres.admin.execute<{ reconcile_remediated_at: string | null }>(
      sql`select reconcile_remediated_at from payments where payment_ref = 'rls-1'`,
    );
    expect(marker.rows[0]?.reconcile_remediated_at).not.toBeNull();
  });

  it("sees nothing for a tenant it is not scoped to", async () => {
    const mine = await seedWorkingOrder(postgres.admin, "B44444444");
    const theirs = await seedWorkingOrder(postgres.admin, "B55555555");
    await withTenant(postgres.admin, theirs.tenantId, (tx) =>
      insertCapturedPayment(tx, {
        tenantId: theirs.tenantId,
        workingOrderId: theirs.workingOrderId,
        provider: "fake",
        paymentRef: "rls-theirs",
        externalRef: "ext-rls-theirs",
        amount: decimal("10.00"),
        settledAt: OLD_SETTLED,
      }),
    );

    const probe = await postgres.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const result = await reconcilePayments(
        {
          db: probe,
          provider: "fake",
          report: new FakeSettlementReport([]),
          reverse: async () => {},
          incidents: recordIncidentOnce,
          settlementLagMs: DEFAULT_SETTLEMENT_LAG_MS,
        },
        brandTenantId(mine.tenantId),
        PERIOD,
        NOW,
      );
      // The other tenant's stale payment is invisible: RLS scopes T1 to `mine`, even though the
      // row indisputably exists (just inserted above) and this probe role indisputably holds
      // SELECT on the table (proven by the first test) — the only thing standing between this
      // sweep and that row is the isolation policy's USING clause evaluating tenant_id against
      // `mine`'s GUC rather than `theirs`'s.
      //
      // This now passes for TWO independent reasons, not one: RLS (what this suite exists to
      // prove, and the only thing standing between a non-superuser probe and `theirs`'s row) AND
      // `listReconcilable`/`existingReferences`'s own explicit `tenant_id` predicate (defence-in-
      // depth for a superuser/BYPASSRLS connection, which this probe role is not — see
      // store.test.ts's superuser-only tenant-scoping tests, which are what actually isolate that
      // second layer). Do not read this test going green as proof the RLS assertion is redundant —
      // it is still the only layer this suite is able to falsify.
      expect(result.checked).toBe(0);
      expect(result.unsettled).toEqual([]);
      expect(result.orphan).toEqual([]);
    } finally {
      await probe.close();
    }
  });
});
