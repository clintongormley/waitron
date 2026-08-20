import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { decimal } from "@waitron/shared";
import { getPaymentByRef, insertAcceptedOffline } from "./store.js";
import { getPaymentPolicy } from "./policy.js";
import { seedPaymentPolicy, seedWorkingOrder } from "../test/seed.js";

// A non-superuser LOGIN role, distinct from payments.rls.test.ts's `rls_probe`: both now live in
// the one shared cluster, so the names must differ. Being non-superuser is what makes RLS apply.
const PROBE_ROLE = "rls_probe_policy";
const PROBE_PASSWORD = "probe";

// A clone of the `core_payments` template (CORE + PAYMENTS); the probe connections below authenticate as
// `rls_probe_policy`, a cluster-wide role the package globalSetup creates in place of the per-file
// `probeRole` this suite passed before the shared container.
const postgres = useTemplateDb({ template: "core_payments" });

const SETTLED = new Date("2026-07-23T10:00:00Z");

describe("payment_policy + offline payments under real row-level security", () => {
  it("an app_user role reads its own tenant's policy and offline payment, and only its own", async () => {
    const tenantA = await seedWorkingOrder(postgres.admin, "B31111111");
    const tenantB = await seedWorkingOrder(postgres.admin, "B32222222");
    // Seed A's policy as superuser (RLS bypassed for setup).
    await seedPaymentPolicy(postgres.admin, tenantA.tenantId, "accept_offline", "40.00");

    const probe = await postgres.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // INSERT an accepted_offline payment as rls_probe, scoped to A — proves INSERT grant + WITH CHECK.
      await withTenant(probe, tenantA.tenantId, (tx) =>
        insertAcceptedOffline(tx, {
          tenantId: tenantA.tenantId,
          workingOrderId: tenantA.workingOrderId,
          provider: "fake",
          paymentRef: "off-1",
          amount: decimal("10.00"),
          settledAt: SETTLED,
        }),
      );

      // Read policy + payment scoped to A — proves SELECT grant + USING.
      const policyA = await withTenant(probe, tenantA.tenantId, (tx) =>
        getPaymentPolicy(tx, tenantA.tenantId),
      );
      expect(policyA).toEqual({ offlineMode: "accept_offline", offlineAmountCap: "40.00" });
      const payA = await withTenant(probe, tenantA.tenantId, (tx) =>
        getPaymentByRef(tx, { tenantId: tenantA.tenantId, provider: "fake", paymentRef: "off-1" }),
      );
      expect(payA?.state).toBe("accepted_offline");

      // Same reads scoped to B — the isolation policy hides A's rows.
      const policyB = await withTenant(probe, tenantB.tenantId, (tx) =>
        getPaymentPolicy(tx, tenantA.tenantId),
      );
      expect(policyB).toBeUndefined();
      const payB = await withTenant(probe, tenantB.tenantId, (tx) =>
        getPaymentByRef(tx, { tenantId: tenantA.tenantId, provider: "fake", paymentRef: "off-1" }),
      );
      expect(payB).toBeUndefined();
    } finally {
      await probe.close();
    }
  });
});
