import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  decimal,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { captureAttempting, getPaymentByRef, insertAttempting } from "@waitron/payments";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { FakeStripe } from "./testing/fake-stripe.js";
import { StripeTerminalProvider } from "./provider.js";

// A non-superuser LOGIN role that inherits app_user's grants. Being non-superuser is what makes RLS
// apply to it at all (a superuser bypasses FORCE ROW LEVEL SECURITY, which is exactly why PGlite —
// which always connects as superuser — cannot prove any of this; see this suite's whole reason for
// existing). The app_user membership is what lets it SELECT/INSERT/UPDATE `payments` in the first
// place (0001_payments_rls.sql's REVOKE ALL + targeted GRANT). current_tenant_id() then reads
// `app.tenant_id`, so with no GUC set the tenant-isolation policy matches zero rows. Mirrors
// packages/payments/src/payments.rls.test.ts verbatim.
const PROBE_ROLE = "rls_probe";
const PROBE_PASSWORD = "probe";

let pg: RealPostgres;
let admin: Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
  // `execute(string)` runs the statement verbatim (drizzle wraps a plain string in `sql.raw`
  // internally), so this needs no `drizzle-orm` import — which payments-stripe does not depend on,
  // unlike payments where the mirrored suite lives. Mirrors that suite's role creation otherwise.
  await admin.execute(
    `create role ${PROBE_ROLE} login password '${PROBE_PASSWORD}' in role app_user`,
  );
});

afterAll(async () => {
  await admin.close();
  await pg.stop();
});

const SETTLED = new Date("2026-07-22T10:00:00Z");

// The Stripe adapter's `collect` never writes `payments` directly — it drives the store's
// attempting/capture lifecycle: `insertAttempting` (T1, committed before the network call) then
// `captureAttempting` (T2, on a settled PaymentIntent). `collect` opens its OWN transactions, so it
// can't have `app.tenant_id` set on them from out here; instead this suite exercises that SAME store
// lifecycle directly under the probe/withTenant, proving the tenant-isolation policy the adapter
// relies on holds under a real non-superuser RLS-subject role — the point PGlite (superuser, RLS
// bypassed) cannot make. `provider: "stripe"` is the adapter's real provider id.
describe("stripe attempting/capture lifecycle under real row-level security", () => {
  it("captures an attempting payment under a real RLS role, tenant-isolated", async () => {
    // Seeded as the superuser (admin) — RLS is bypassed, which is fine: the working_order chains
    // being seeded aren't the thing under test, the attempting-insert + capture below is.
    const tenantA = await seedWorkingOrder(admin, "B11111111");
    const tenantB = await seedWorkingOrder(admin, "B22222222");

    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // The single lookup key. Fixed to tenant A and reused for BOTH reads below, so the only thing
      // that changes between the visible read and the hidden read is the withTenant GUC scope — not
      // the key. That is what makes the invisibility under B attributable purely to the RLS policy.
      const key = { tenantId: tenantA.tenantId, provider: "stripe", paymentRef: "r1" };

      // T1 — INSERT the attempting row as rls_probe, scoped to tenant A via withTenant. Succeeding
      // here proves the INSERT grant (0001_payments_rls.sql's `GRANT INSERT ... TO app_user`) and
      // the WITH CHECK half of the tenant-isolation policy (tenant_id = current_tenant_id()).
      await withTenant(probe, tenantA.tenantId, (tx) =>
        insertAttempting(tx, {
          tenantId: tenantA.tenantId,
          workingOrderId: tenantA.workingOrderId,
          provider: "stripe",
          paymentRef: "r1",
          amount: decimal("12.10"),
        }),
      );

      // T2 — resolve that row to `captured` as rls_probe, still scoped to tenant A. The UPDATE
      // matches only a row the isolation policy lets this role see AND write (USING + WITH CHECK),
      // and stamps the settlement time and the PaymentIntent id into `external_ref`.
      await withTenant(probe, tenantA.tenantId, (tx) =>
        captureAttempting(tx, {
          tenantId: tenantA.tenantId,
          provider: "stripe",
          paymentRef: "r1",
          settledAt: SETTLED,
          externalRef: "pi_rls",
        }),
      );

      // Read back as rls_probe, scoped to tenant A. Proves the SELECT grant plus the USING half of
      // the policy — a non-superuser role with no special privilege on this row sees it because it
      // owns the tenant scope the policy checks against — and that the capture landed.
      const seen = await withTenant(probe, tenantA.tenantId, (tx) => getPaymentByRef(tx, key));
      expect(seen?.state).toBe("captured");
      expect(seen?.externalRef).toBe("pi_rls");

      // Same query, SAME key, same row, but scoped to tenant B instead. The row indisputably exists
      // (just read above) and rls_probe indisputably holds SELECT on the table (also just proven) —
      // the only thing standing between this query and that row is the isolation policy's USING
      // clause evaluating tenant_id = current_tenant_id() against B's GUC. It returns nothing, which
      // is the isolation guarantee actually holding under a real RLS-subject role rather than being
      // assumed from the migration text.
      const hidden = await withTenant(probe, tenantB.tenantId, (tx) => getPaymentByRef(tx, key));
      expect(hidden).toBeUndefined();
    } finally {
      await probe.close();
    }
  });

  // The suite header above notes that `collect` opens its own transactions and so "can't have
  // `app.tenant_id` set on them from out here", then exercises the store lifecycle under
  // withTenant instead. That proves the POLICY holds; it infers the ADAPTER is therefore fine.
  // This test makes the adapter itself the subject, which is the step that inference skipped.
  it("collect() writes its attempting row when handed the only Database handle the API can build", async () => {
    const t = await seedWorkingOrder(admin, freshNif());
    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const provider = new StripeTerminalProvider({
        client: new FakeStripe(),
        db: probe,
        tenantId: brandTenantId(t.tenantId),
        resolveReader: () => Promise.resolve("reader_1"),
        poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
      });
      const result = await provider.collect({
        tenantId: brandTenantId(t.tenantId),
        tillId: brandTillId(t.tillId),
        workingOrderId: brandWorkingOrderId(t.workingOrderId),
        amount: decimal("10.00"),
      });
      expect(result.state).toBe("captured");
    } finally {
      await probe.close();
    }
  });
});
