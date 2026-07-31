import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { decimal } from "@waitron/shared";
import { getPaymentByRef, insertAcceptedOffline } from "./store.js";
import { getPaymentPolicy } from "./policy.js";
import { startRealPostgres } from "./testing/postgres.js";
import { seedPaymentPolicy, seedWorkingOrder } from "../test/seed.js";

// A non-superuser LOGIN role distinct from payments.rls.test.ts's `rls_probe` so the two suites'
// roles never collide if they were ever run against the same container/instance.
const PROBE_ROLE = "rls_probe_policy";
const PROBE_PASSWORD = "probe";

// vitest.config.ts's hookTimeout, which this container start had before the helper's 60s default.
const postgres = useRealPostgres({
  start: startRealPostgres,
  probeRole: { name: PROBE_ROLE, password: PROBE_PASSWORD, inRole: "app_user" },
  timeoutMs: 180_000,
});

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
