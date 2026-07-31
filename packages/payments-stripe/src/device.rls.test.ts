import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  decimal,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import {
  getPaymentByRef,
  insertAcceptedOffline,
  insertCapturedPayment,
  listAcceptedOffline,
} from "@waitron/payments";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { FakeStripeDevice } from "./testing/fake-stripe-device.js";
import { StripeOnDeviceProvider } from "./device-provider.js";

const PROBE_ROLE = "rls_probe_device";
const PROBE_PASSWORD = "probe";

let pg: RealPostgres;
let admin: Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
  await admin.execute(
    `create role ${PROBE_ROLE} login password '${PROBE_PASSWORD}' in role app_user`,
  );
});
afterAll(async () => {
  if (admin !== undefined) await admin.close();
  if (pg !== undefined) await pg.stop();
});

const SETTLED = new Date("2026-07-24T10:00:00Z");

describe("on-device accepted_offline lifecycle under real row-level security", () => {
  it("lists and reads its own tenant's offline payment, and only its own", async () => {
    const tenantA = await seedWorkingOrder(admin, "B41111111");
    const tenantB = await seedWorkingOrder(admin, "B42222222");

    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const key = { tenantId: tenantA.tenantId, provider: "stripe", paymentRef: "dev-off-1" };

      await withTenant(probe, tenantA.tenantId, (tx) =>
        insertAcceptedOffline(tx, {
          tenantId: tenantA.tenantId,
          workingOrderId: tenantA.workingOrderId,
          provider: "stripe",
          paymentRef: "dev-off-1",
          amount: decimal("10.00"),
          settledAt: SETTLED,
          externalRef: "pi_dev_rls",
        }),
      );

      // listAcceptedOffline under tenant A sees the row.
      const listedA = await withTenant(probe, tenantA.tenantId, (tx) =>
        listAcceptedOffline(tx, tenantA.tenantId, "stripe"),
      );
      expect(listedA.map((r) => r.paymentRef)).toContain("dev-off-1");

      const seen = await withTenant(probe, tenantA.tenantId, (tx) => getPaymentByRef(tx, key));
      expect(seen?.state).toBe("accepted_offline");
      expect(seen?.externalRef).toBe("pi_dev_rls");

      // Under tenant B the isolation policy hides A's row from both the read and the list. The list
      // call deliberately asks for tenant A's id from inside B's scope — a caller reaching for
      // another tenant's rows outright — so the ONLY thing that can return nothing is the policy.
      // (Passing B's own id would prove nothing: the explicit predicate alone would empty it.)
      const listedB = await withTenant(probe, tenantB.tenantId, (tx) =>
        listAcceptedOffline(tx, tenantA.tenantId, "stripe"),
      );
      expect(listedB.map((r) => r.paymentRef)).not.toContain("dev-off-1");
      const hidden = await withTenant(probe, tenantB.tenantId, (tx) => getPaymentByRef(tx, key));
      expect(hidden).toBeUndefined();
    } finally {
      await probe.close();
    }
  });

  it("forward() clears an offline payment when given the only Database handle the API can build", async () => {
    const t = await seedWorkingOrder(admin, freshNif());
    await withTenant(admin, t.tenantId, (tx) =>
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
    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const client = new FakeStripeDevice();
      client.queueResult({ settled: ["dev-off-fwd"], declined: [] });
      const provider = new StripeOnDeviceProvider({
        client,
        db: probe,
        tenantId: brandTenantId(t.tenantId),
      });

      const result = await provider.forward(new Date("2026-07-24T11:00:00Z"));
      expect(result.forwarded).toBe(1);

      const row = await withTenant(admin, t.tenantId, (tx) =>
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
    const t = await seedWorkingOrder(admin, freshNif());
    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const provider = new StripeOnDeviceProvider({
        client: new FakeStripeDevice(),
        db: probe,
        tenantId: brandTenantId(t.tenantId),
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
    const t = await seedWorkingOrder(admin, freshNif());
    await withTenant(admin, t.tenantId, (tx) =>
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

    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const provider = new StripeOnDeviceProvider({
        client: new FakeStripeDevice(),
        db: probe,
        tenantId: brandTenantId(t.tenantId),
      });
      const r = await provider.refund("dev-rev-1");
      expect(r.state).toBe("refunded");
    } finally {
      await probe.close();
    }
  });
});
