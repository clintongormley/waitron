import { describe, expect, it } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import {
  decimal,
  tenantId as brandTenantId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { FakeStripeHosted } from "./testing/fake-stripe-hosted.js";
import { StripeHostedProvider } from "./hosted-provider.js";

// The non-superuser LOGIN role this suite connects AS (`pg.connectAs`). It is created once,
// cluster-wide, in the package's globalSetup (`src/testing/global-setup.ts`) — not per file, because
// a shared container is one cluster — with `inRole: "app_user"`; see that file's header.
const PROBE_ROLE = "rls_probe_hosted";
const PROBE_PASSWORD = "probe";

const suite = useTemplateDb({ template: "core_payments" });

describe("the stripe hosted-checkout adapter against a real database", () => {
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
