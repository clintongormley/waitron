import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  compareDecimal,
  decimal,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { PAYMENTS_MIGRATIONS, getPaymentByRef } from "@waitron/payments";
import { openIncidents } from "@waitron/core";
import { FakeStripeDevice } from "./testing/fake-stripe-device.js";
import { StripeOnDeviceProvider } from "./device-provider.js";
import { freshNif, seedPaymentPolicy, seedWorkingOrder } from "@waitron/payments/test/seed.js";

let db: Database;
beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, PAYMENTS_MIGRATIONS);
}, 60_000);
afterAll(async () => {
  await db.close();
});

const AT = new Date("2026-07-24T10:00:00Z");

function collectParams(
  s: { tenantId: string; tillId: string; workingOrderId: string },
  allowOffline?: boolean,
) {
  return {
    tenantId: brandTenantId(s.tenantId),
    tillId: brandTillId(s.tillId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    amount: decimal("10.00"),
    ...(allowOffline === undefined ? {} : { allowOffline }),
  };
}

describe("StripeOnDeviceProvider.collect", () => {
  it("online capture writes a captured row with the PI id in external_ref", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    const provider = new StripeOnDeviceProvider({ client: new FakeStripeDevice(), db });
    const r = await provider.collect(collectParams(s));
    expect(r.state).toBe("captured");
    expect(r.settledAt).not.toBeNull();
    const row = await db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "stripe", paymentRef: r.paymentRef }),
    );
    expect(row?.state).toBe("captured");
    expect(row?.externalRef).toMatch(/^pi_/);
  });

  it("accepted_offline (policy allows, consent given, under cap) chains immediately with offline:true", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    await seedPaymentPolicy(db, s.tenantId, "accept_offline", "50.00");
    const client = new FakeStripeDevice();
    client.nextCollect("offline"); // the gate must ACCEPT (policy + consent + under cap) for the device to store
    const provider = new StripeOnDeviceProvider({ client, db });
    const r = await provider.collect(collectParams(s, true));
    expect(r.state).toBe("accepted_offline");
    expect(r.offline).toBe(true);
    expect(r.settledAt).not.toBeNull();
  });

  it("gate refuses offline (no policy) → device yields network_unavailable → nothing persisted", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    // No policy row → resolveOfflineDecision refuses → offlineAllowed=false is passed to the device →
    // the offline scenario yields network_unavailable. This makes the gate wiring load-bearing.
    const client = new FakeStripeDevice();
    client.nextCollect("offline");
    const provider = new StripeOnDeviceProvider({ client, db });
    const r = await provider.collect(collectParams(s, true));
    expect(r.state).toBe("network_unavailable");
    expect(r.settledAt).toBeNull();
    const row = await db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "stripe", paymentRef: r.paymentRef }),
    );
    expect(row).toBeUndefined();
  });

  it("declined writes a failed row", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    const client = new FakeStripeDevice();
    client.nextCollect("declined");
    const provider = new StripeOnDeviceProvider({ client, db });
    const r = await provider.collect(collectParams(s));
    expect(r.state).toBe("failed");
    const row = await db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "stripe", paymentRef: r.paymentRef }),
    );
    expect(row?.state).toBe("failed");
  });
});

describe("StripeOnDeviceProvider.forward", () => {
  it("settles a cleared offline payment and declines a refused one (+ one incident), empty queue = zeros", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    await seedPaymentPolicy(db, s.tenantId, "accept_offline", "50.00");
    const client = new FakeStripeDevice();
    const provider = new StripeOnDeviceProvider({ client, db });

    // Two offline-accepted payments (policy accepts + consent + under cap → the device stores).
    client.nextCollect("offline");
    const a = await provider.collect(collectParams(s, true));
    client.nextCollect("offline");
    const b = await provider.collect(collectParams(s, true));

    // The device queue: a cleared, b refused.
    client.queueResult({ settled: [a.paymentRef], declined: [b.paymentRef] });
    const result = await provider.forward(AT);
    expect(result).toMatchObject({
      forwarded: 1,
      declined: 1,
      incidentsRaised: 1,
      nextDueAt: null,
    });

    const rowA = await db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "stripe", paymentRef: a.paymentRef }),
    );
    const rowB = await db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "stripe", paymentRef: b.paymentRef }),
    );
    expect(rowA?.state).toBe("settled");
    expect(rowB?.state).toBe("declined");
    const incidents = await db.transaction((tx) => openIncidents(tx, brandTillId(s.tillId)));
    expect(incidents).toHaveLength(1);
    expect(incidents[0].code).toBe("payment.offline_forward_declined");

    // Empty queue → zeros.
    expect(await provider.forward(AT)).toEqual({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    });
  });
});

describe("StripeOnDeviceProvider reversals", () => {
  it("refunds a captured payment; a Stripe-refused refund leaves state unchanged", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    const client = new FakeStripeDevice();
    const provider = new StripeOnDeviceProvider({ client, db });
    const paid = await provider.collect(collectParams(s));

    client.refundFailsNext();
    const failed = await provider.refund(paid.paymentRef);
    expect(failed.state).toBe("captured"); // unchanged — no money moved

    const ok = await provider.refund(paid.paymentRef);
    expect(ok.state).toBe("refunded");
  });

  it("void: reverses a captured payment to voided", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    const client = new FakeStripeDevice();
    const provider = new StripeOnDeviceProvider({ client, db });
    const paid = await provider.collect(collectParams(s));

    const voided = await provider.void(paid.paymentRef);
    expect(voided.state).toBe("voided");
  });

  it("partialRefund: reports the refunded amount, not the capture, and sets partially_refunded", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    const client = new FakeStripeDevice();
    const provider = new StripeOnDeviceProvider({ client, db });
    const paid = await provider.collect(collectParams(s)); // amount 10.00

    const refunded = await provider.partialRefund(paid.paymentRef, decimal("4.00"));
    expect(refunded.state).toBe("partially_refunded");
    expect(compareDecimal(refunded.amount, decimal("4.00"))).toBe(0);
  });
});

describe("StripeOnDeviceProvider.connectionToken", () => {
  it("mints a connection token for the device to initialise its on-device SDK", async () => {
    const provider = new StripeOnDeviceProvider({ client: new FakeStripeDevice(), db });

    const { secret } = await provider.connectionToken();
    expect(typeof secret).toBe("string");
    expect(secret.length).toBeGreaterThan(0);
    expect(secret).toMatch(/^pst_/);
  });
});
