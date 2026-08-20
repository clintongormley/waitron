import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import {
  decimal,
  tenantId as brandTenantId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { getPaymentByRef, insertInitiated, resolvePaymentTenant } from "@waitron/payments";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { FakeStripeHosted } from "./testing/fake-stripe-hosted.js";
import { StripeHostedProvider } from "./hosted-provider.js";

// The non-superuser LOGIN role this suite connects AS (`pg.connectAs`). It is created once,
// cluster-wide, in the package's globalSetup (`src/testing/global-setup.ts`) — not per file, because
// a shared container is one cluster — with `inRole: "app_user"`; see that file's header.
const PROBE_ROLE = "rls_probe_hosted";
const PROBE_PASSWORD = "probe";

const suite = useTemplateDb({ template: "core_payments" });

describe("hosted initiated rows under real row-level security", () => {
  it("isolates an initiated stripe row by tenant and resolves it untenanted by session id", async () => {
    const a = await seedWorkingOrder(suite.admin, "B31111111");
    const b = await seedWorkingOrder(suite.admin, "B32222222");
    const key = { tenantId: a.tenantId, provider: "stripe", paymentRef: "hosted-r1" };
    const sessionId = "cs_rls_hosted";

    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // The store call initiate makes — written as rls_probe, scoped to tenant A via withTenant.
      // `insertInitiated`'s NewPayment fields are plain strings (no branding needed here).
      await withTenant(probe, a.tenantId, (tx) =>
        insertInitiated(tx, {
          tenantId: a.tenantId,
          workingOrderId: a.workingOrderId,
          provider: "stripe",
          paymentRef: "hosted-r1",
          externalRef: sessionId,
          amount: decimal("12.10"),
        }),
      );

      // Tenant A sees it; tenant B (SAME key) does not — isolation holds under a real RLS role.
      const seen = await withTenant(probe, a.tenantId, (tx) => getPaymentByRef(tx, key));
      expect(seen?.state).toBe("initiated");
      expect(seen?.externalRef).toBe(sessionId);
      const hidden = await withTenant(probe, b.tenantId, (tx) => getPaymentByRef(tx, key));
      expect(hidden).toBeUndefined();

      // The inbound-webhook case: resolve the tenant from (provider, session id) with NO GUC set. A
      // plain unscoped read returns nothing (isolation fails closed); the SECURITY DEFINER seam
      // crosses and returns ONLY the tenant id.
      const resolved = await resolvePaymentTenant(probe, "stripe", sessionId);
      expect(resolved).toBe(a.tenantId);
    } finally {
      await probe.close();
    }
  });

  // The third adapter that carried the same impossible "TENANT-SCOPED `Database` handle"
  // requirement. It scopes from `params.tenantId` now — `initiate` is its only database method.
  it("initiate() writes its initiated row when handed the only Database handle the API can build", async () => {
    const t = await seedWorkingOrder(suite.admin, freshNif());
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const provider = new StripeHostedProvider({ client: new FakeStripeHosted(), db: probe });
      const res = await provider.initiate({
        tenantId: brandTenantId(t.tenantId),
        workingOrderId: brandWorkingOrderId(t.workingOrderId),
        amount: decimal("12.10"),
        paymentRef: "hosted-rls-1",
      });
      expect(res.externalRef).toBeTruthy();
    } finally {
      await probe.close();
    }
  });
});
