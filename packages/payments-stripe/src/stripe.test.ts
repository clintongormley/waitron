import { describe, expect, it } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import {
  decimal,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { FakeStripe } from "./testing/fake-stripe.js";
import { StripeTerminalProvider } from "./provider.js";

// A non-superuser LOGIN role that inherits app_user's grants. The app_user membership is what lets
// it SELECT/INSERT/UPDATE `payments` at all (0001_payments_baseline_sql.sql's REVOKE ALL + targeted GRANT);
// PGlite connects as a superuser holding every grant, so a missing one is invisible there. The role
// is created once, cluster-wide, in the package's globalSetup (`src/testing/global-setup.ts`) — not
// per file, because a shared container is one cluster; this suite connects AS it with `pg.connectAs`.
const PROBE_ROLE = "rls_probe";
const PROBE_PASSWORD = "probe";

const suite = useTemplateDb({ template: "core_payments" });

// `StripeTerminalProvider.collect` never writes `payments` directly — it drives the store's
// attempting/capture lifecycle (`insertAttempting`, committed before the network call, then
// `captureAttempting` on a settled PaymentIntent) inside transactions IT opens. So the adapter, not
// the store, is the subject here: it is handed the only kind of `Database` handle a host can build
// and must still land a captured row. `provider: "stripe"` is the adapter's real provider id.
describe("the stripe terminal adapter against a real database", () => {
  it("collect() writes its attempting row when handed the only Database handle the API can build", async () => {
    const t = await seedWorkingOrder(suite.admin, freshNif());
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const provider = new StripeTerminalProvider({
        client: new FakeStripe(),
        db: probe,
        tenantId: brandTenantId(t.tenantId),
        nodeId: "11111111-1111-4111-8111-111111111111",
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
