// Real PostgreSQL: exercises the database path through a non-superuser LOGIN and its grants.
import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import {
  decimal,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { getPaymentByRef, insertAcceptedOffline, insertCapturedPayment } from "@waitron/payments";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { FakeStripeDevice } from "./testing/fake-stripe-device.js";
import { StripeOnDeviceProvider } from "./device-provider.js";

// The non-superuser LOGIN role this suite connects AS (`pg.connectAs`). It is created once,
// cluster-wide, in the package's globalSetup (`src/testing/global-setup.ts`) — not per file, because
// a shared container is one cluster — with `inRole: "app_user"`; see that file's header.
const PROBE_ROLE = "rls_probe_device";
const PROBE_PASSWORD = "probe";

const suite = useTemplateDb({ template: "core_payments" });

const SETTLED = new Date("2026-07-24T10:00:00Z");
// The provider's sync-origin node id — required option, value irrelevant here (this container migrates
// core+payments only, no sync capture triggers); threaded into the adapter's withTenant (design §4d(B)).
const TEST_NODE_ID = "11111111-1111-4111-8111-111111111111";

describe("the stripe on-device adapter against a real database", () => {
  it("forward() clears an offline payment when given the only Database handle the API can build", async () => {
    const t = await seedWorkingOrder(suite.admin, freshNif());
    await withTenant(suite.admin, t.tenantId, (tx) =>
      insertAcceptedOffline(tx, {
        tenantId: t.tenantId,
        workingOrderId: t.workingOrderId,
        provider: "stripe",
        paymentRef: "dev-off-fwd",
        amount: decimal("10.00"),
        settledAt: SETTLED,
        externalRef: "pi_dev_fwd",
      }),
    );

    // `connectAs` returns what `createPostgresDb` returns — the only kind of handle @waitron/db
    // exports a way to build. This adapter's options USED TO demand a "TENANT-SCOPED `Database`
    // handle" instead, which cannot exist (`withTenant` scopes transaction-locally, from inside a
    // transaction it opens itself), and `forward` consequently listed zero rows under a real role.
    // This asserts it works when handed the handle a host can actually supply.
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const client = new FakeStripeDevice();
      client.queueResult({ settled: ["dev-off-fwd"], declined: [] });
      const provider = new StripeOnDeviceProvider({
        client,
        db: probe,
        tenantId: brandTenantId(t.tenantId),
        nodeId: TEST_NODE_ID,
      });

      const result = await provider.forward(new Date("2026-07-24T11:00:00Z"));
      expect(result.forwarded).toBe(1);

      const row = await withTenant(suite.admin, t.tenantId, (tx) =>
        getPaymentByRef(tx, {
          tenantId: t.tenantId,
          provider: "stripe",
          paymentRef: "dev-off-fwd",
        }),
      );
      expect(row?.state).toBe("settled");
    } finally {
      await probe.close();
    }
  });

  it("collect() captures on the same handle — the interactive till path, not just forward", async () => {
    const t = await seedWorkingOrder(suite.admin, freshNif());
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const provider = new StripeOnDeviceProvider({
        client: new FakeStripeDevice(),
        db: probe,
        tenantId: brandTenantId(t.tenantId),
        nodeId: TEST_NODE_ID,
      });
      const r = await provider.collect({
        tenantId: brandTenantId(t.tenantId),
        tillId: brandTillId(t.tillId),
        workingOrderId: brandWorkingOrderId(t.workingOrderId),
        amount: decimal("10.00"),
      });
      expect(r.state).toBe("captured");
    } finally {
      await probe.close();
    }
  });

  // reverse.ts described this exact failure and then, on the strength of a requirement that could
  // not be met, defaulted these callers to omitting `tenantId`. Its own words for the consequence:
  // "the reversal fails closed with payment.not_found — for a payment that is sitting right
  // there… it fails every single time." `tenantId` is required there now.
  it("refund() reverses a captured payment on the only Database handle the API can build", async () => {
    const t = await seedWorkingOrder(suite.admin, freshNif());
    await withTenant(suite.admin, t.tenantId, (tx) =>
      insertCapturedPayment(tx, {
        tenantId: t.tenantId,
        workingOrderId: t.workingOrderId,
        provider: "stripe",
        paymentRef: "dev-rev-1",
        amount: decimal("10.00"),
        settledAt: SETTLED,
        externalRef: "pi_dev_rev",
      }),
    );

    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const provider = new StripeOnDeviceProvider({
        client: new FakeStripeDevice(),
        db: probe,
        tenantId: brandTenantId(t.tenantId),
        nodeId: TEST_NODE_ID,
      });
      const r = await provider.refund("dev-rev-1");
      expect(r.state).toBe("refunded");
    } finally {
      await probe.close();
    }
  });
});
