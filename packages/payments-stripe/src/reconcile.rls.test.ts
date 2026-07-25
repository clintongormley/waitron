import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal, tenantId as brandTenantId } from "@waitron/shared";
import { insertCapturedPayment } from "@waitron/payments";
import { seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { StripeReconciler } from "./reconciler.js";
import { FakeStripeReport } from "./testing/fake-stripe-report.js";
import { FakeStripe } from "./testing/fake-stripe.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";

// A non-superuser LOGIN role that inherits app_user's grants — the same shape as
// stripe.rls.test.ts/device.rls.test.ts/hosted.rls.test.ts's own probe roles. Named uniquely to this
// suite (rather than reusing one generic name across all four) for grep-ability — a permission error
// naming `rls_probe_reconcile` says which suite it came from without opening the file — and as a
// safety margin should a future change ever make these suites share one container; today each suite's
// own `startRealPostgres()` call starts a FRESH container with its own `pg_roles`, so no two of these
// role-creation statements can actually collide.
const PROBE_ROLE = "rls_probe_reconcile";
const PROBE_PASSWORD = "probe";

let pg: RealPostgres;
let admin: Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
  // `execute(string)` runs the statement verbatim (drizzle wraps a plain string in `sql.raw`
  // internally), so this needs no `drizzle-orm` import — payments-stripe does not depend on it in
  // its own test files. Mirrors hosted.rls.test.ts/stripe.rls.test.ts/device.rls.test.ts verbatim.
  await admin.execute(
    `create role ${PROBE_ROLE} login password '${PROBE_PASSWORD}' in role app_user`,
  );
}, 180_000);

afterAll(async () => {
  await admin.close();
  await pg.stop();
});

const OLD = new Date("2026-07-01T12:00:00Z");
const NOW = new Date("2026-07-25T12:00:00Z");
const PERIOD = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };

/**
 * `packages/payments/src/reconcile.rls.test.ts` already proves the neutral `reconcilePayments`
 * engine's own grants under real RLS — SELECT on payments+working_orders (T1's listReconcilable
 * join), INSERT on incidents and UPDATE on payments (T2's recordIncidentOnce + markReconcileRemediated)
 * — but it does so with a stub `reverse: async (ref) => { reversed.push(ref) }` that touches no table
 * at all. `StripeReconciler` is the one caller whose `reverse` is real: it delegates to
 * `reverseViaStripe`, which opens its OWN transactions against `payments`/`payment_refunds`
 * (`findPaymentByRef`, `assertReversible`, `recordRefund`/`recordVoid`/`recordFailedRefund`). Driving
 * the sweep through `StripeReconciler` itself, as a genuine non-superuser `app_user` member, is the
 * only way to exercise THAT path's privileges too — PGlite's `reconciler.test.ts` cannot, because
 * PGlite always connects as superuser and bypasses FORCE ROW LEVEL SECURITY outright.
 */
describe("reconcile sweep through StripeReconciler under real row-level security", () => {
  it("finds a captured orphan on an abandoned working order, raises its incident, stamps the remediation marker, and auto-reverses it", async () => {
    const seeded = await seedWorkingOrder(admin, "B51111111");
    const paymentRef = "ref-rls-orphan";
    const externalRef = "pi_rls_orphan";

    // Seeded as admin (superuser, RLS bypassed) — setup, not the thing under test, exactly as the
    // sibling RLS suites seed via seedWorkingOrder(admin, ...): a captured stripe payment with no
    // sale on a working order that then abandons — the auto-reversible orphan shape (reconciler.test.ts's
    // `abandonedOrphan` helper, inlined here since this file has no PGlite fixture to share it with).
    await withTenant(admin, seeded.tenantId, (tx) =>
      insertCapturedPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "stripe",
        paymentRef,
        externalRef,
        amount: decimal("10.00"),
        settledAt: OLD,
      }),
    );
    await admin.execute(
      `update working_orders set status = 'abandoned' where id = '${seeded.workingOrderId}'`,
    );

    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // externalRef has no `cs_` prefix, so the reversal's session resolver passes it straight
      // through unresolved — no `sessions` needed, mirroring reconciler.test.ts's terminal-orphan case.
      // That also means the hosted `cs_` → PaymentIntent resolution branch (`paymentIntentForSession`)
      // is never exercised under a REAL non-superuser role by this suite — an intentional gap, not an
      // oversight: that lookup is a pure network call to Stripe, touching no table, so it opens no
      // transaction, sets no GUC and needs no grant. It adds no privilege or RLS surface for a
      // real-Postgres suite to prove; reconciler.test.ts's PGlite suite already exercises the branch
      // itself (`cs_orphan` → `pi_orphan`) against the fake client, which is all the resolution logic
      // needs.
      const client = new FakeStripeReport({
        settlements: [
          { paymentIntentId: externalRef, chargeId: "ch_rls", amountMinor: 1000, settledAt: OLD },
        ],
      });
      const refunder = new FakeStripe();
      const sweep = new StripeReconciler({
        db: probe,
        resolveAccount: () => Promise.resolve({ report: client, refund: refunder }),
      });

      // The sweep itself, driven entirely by `rls_probe_reconcile`: T1's listReconcilable (SELECT
      // payments+working_orders), T2's recordIncidentOnce (INSERT incidents) and
      // markReconcileRemediated (UPDATE payments). A missing grant on any of them surfaces here as a
      // thrown Postgres permission error rather than a returned result.
      const result = await sweep.reconcile(brandTenantId(seeded.tenantId), PERIOD, NOW);

      // Found — T1's SELECT (through the tenant-isolation policy, join to working_orders included)
      // saw the row and classify() called it an orphan.
      expect(result.orphan).toHaveLength(1);
      expect(result.orphan[0].paymentRef).toBe(paymentRef);
      // Exactly one: the aggregate `payment.reconcile_orphan` incident. A second would only appear
      // if the auto-reversal below FAILED (a `payment.reconcile_remediation_failed` incident) — so
      // `toBe(1)` rather than `toBeGreaterThan(0)` also asserts the reversal did not fail, which
      // `result.remediated`/`result.remediationFailures` below confirm directly.
      expect(result.incidentsRaised).toBe(1);

      // Auto-reversal actually FIRED — the assertion this whole suite exists for, and the one no
      // PGlite test can make. `reverseViaStripe` opens its own transactions for
      // `findPaymentByRef`/`assertReversible` and `recordRefund`, and a bare `db.transaction()`
      // sets no `app.tenant_id` GUC: with the tenant unscoped, `current_tenant_id()` is NULL, the
      // `payments` tenant-isolation policy matches zero rows, and the reversal fails closed with
      // `payment.not_found` for the very row the sweep just found. So `remediated === 1` here
      // proves the reversal path is genuinely TENANT-SCOPED (`StripeReconciler` supplies the tenant
      // it was swept for, and `reverseViaStripe` runs both database phases through `withTenant`) —
      // and that it holds every grant those phases need as an ordinary `app_user` member.
      // reconciler.test.ts asserts the same numbers and cannot show any of it: PGlite connects as
      // superuser and bypasses FORCE ROW LEVEL SECURITY, so an untenanted transaction reads the row
      // regardless and the untenanted version of this code passes there too.
      expect(result.remediated).toBe(1);
      expect(result.remediationFailures).toEqual([]);
      // Money genuinely handed back, against the stored PaymentIntent: the sweep reached the
      // processor, so the failure was not merely swallowed into a zero count.
      expect(refunder.lastRefund?.paymentIntentId).toBe(externalRef);

      // Read back under the PROBE's own tenant scope, not admin — so this also exercises the
      // incidents SELECT grant (proven for `payments` by hosted.rls.test.ts/device.rls.test.ts, but
      // not yet for `incidents` anywhere in this package) rather than merely trusting the in-memory
      // result.
      const readBack = await withTenant(probe, seeded.tenantId, async (tx) => {
        const inc = await tx.execute<{ code: string }>(
          `select code from incidents where till_id = '${seeded.tillId}' order by code`,
        );
        const pay = await tx.execute<{ reconcile_remediated_at: string | null; state: string }>(
          `select reconcile_remediated_at, state from payments where payment_ref = '${paymentRef}'`,
        );
        return {
          incidentCodes: inc.rows.map((r) => r.code),
          remediatedAt: pay.rows[0]?.reconcile_remediated_at ?? null,
          state: pay.rows[0]?.state ?? null,
        };
      });

      // Incident inserted — T2's INSERT genuinely committed a real row, not merely returned a count.
      expect(readBack.incidentCodes).toContain("payment.reconcile_orphan");

      // Marker stamped — T2's UPDATE genuinely committed, read back as its own persisted column. This
      // is stamped BEFORE the reversal is attempted (reconcile.ts's own doc comment on why), so it is
      // true regardless of whether the later reversal call itself succeeds against the fake client.
      expect(readBack.remediatedAt).not.toBeNull();

      // The reversal's OWN write committed too, under the probe's scope — `recordRefund` inserts a
      // `payment_refunds` row and transitions the payment, so a full refund lands the row on
      // `refunded`. This is the half of the reversal that runs AFTER the network call, and it is the
      // only assertion here that covers `payment_refunds`'s grants and policy at all.
      expect(readBack.state).toBe("refunded");
    } finally {
      await probe.close();
    }
  });
});
