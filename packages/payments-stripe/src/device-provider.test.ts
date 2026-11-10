import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  compareDecimal,
  decimal,
  workingOrderId as brandWorkingOrderId,
  deviceOrigin,
} from "@waitron/shared";
import {
  PAYMENTS_MIGRATIONS,
  getPaymentByRef,
  insertAttempting,
  recordResolution,
} from "@waitron/payments";
import { FakeStripeDevice } from "./testing/fake-stripe-device.js";
import { StripeOnDeviceProvider } from "./device-provider.js";
import type { NodeId } from "@waitron/shared";
import {
  billPaymentOfRow,
  freshNif,
  seedBillPayment,
  seedWorkingOrder,
} from "@waitron/payments/test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const AT = new Date("2026-07-24T10:00:00Z");

function providerFor(client: FakeStripeDevice): StripeOnDeviceProvider {
  return new StripeOnDeviceProvider({
    client,
    db: suite.db,
  });
}

function collectParams(s: { deviceId: string; workingOrderId: string; nodeId: NodeId }) {
  return {
    origin: deviceOrigin(s.deviceId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    nodeId: s.nodeId,
    amount: decimal("10.00"),
  };
}

describe("StripeOnDeviceProvider.collect after a Terminal PaymentIntent of the order was cancelled", () => {
  it("uses the order's next key, because Stripe's replayed response to the old key names the cancelled PaymentIntent", async () => {
    const s = await seedWorkingOrder(suite.db, freshNif());
    await withTransaction(suite.db, async (tx) => {
      const key = { provider: "stripe", paymentRef: "terminal-stuck" };
      await insertAttempting(tx, {
        origin: deviceOrigin(s.deviceId),
        ...key,
        workingOrderId: s.workingOrderId,
        nodeId: s.nodeId,
        amount: decimal("10.00"),
      });
      const row = await getPaymentByRef(tx, key);
      await recordResolution(tx, {
        paymentId: row!.id,
        workingOrderId: s.workingOrderId,
        personId: "22222222-2222-4222-8222-222222222222",
        outcome: "failed",
        cancelledAtProvider: true,
        providerStatus: "requires_payment_method",
        resolvedAt: AT,
      });
    });
    const client = new FakeStripeDevice();
    await providerFor(client).collect(collectParams(s));
    expect(client.lastCollect?.idempotencyKey).toBe(`wo_${s.workingOrderId}_r1`);
  });
});

describe("StripeOnDeviceProvider.collect", () => {
  it("online capture writes a captured row with the PI id in external_ref", async () => {
    const s = await seedWorkingOrder(suite.db, freshNif());
    const provider = providerFor(new FakeStripeDevice());
    const r = await provider.collect(collectParams(s));
    expect(r.state).toBe("captured");
    expect(r.settledAt).not.toBeNull();
    const row = await suite.db.transaction((tx) =>
      getPaymentByRef(tx, { provider: "stripe", paymentRef: r.paymentRef }),
    );
    expect(row?.state).toBe("captured");
    expect(row?.externalRef).toMatch(/^pi_/);
  });

  it("network unavailable writes nothing", async () => {
    const s = await seedWorkingOrder(suite.db, freshNif());
    const client = new FakeStripeDevice();
    client.nextCollect("offline");
    const provider = providerFor(client);
    const r = await provider.collect(collectParams(s));
    expect(r.state).toBe("network_unavailable");
    expect(r.settledAt).toBeNull();
    const row = await suite.db.transaction((tx) =>
      getPaymentByRef(tx, { provider: "stripe", paymentRef: r.paymentRef }),
    );
    expect(row).toBeUndefined();
  });

  it("stamps the working order and payment ref into the device PaymentIntent metadata", async () => {
    // This provider collects BEFORE it writes, so a crash in between leaves a captured charge with
    // no local row, and these keys are its only link back to a till.
    const s = await seedWorkingOrder(suite.db, freshNif());
    const client = new FakeStripeDevice();
    const provider = providerFor(client);
    const r = await provider.collect(collectParams(s));
    expect(client.lastCollect?.metadata).toEqual({
      working_order_id: s.workingOrderId,
      payment_ref: r.paymentRef,
    });
  });

  it("derives a stable wo idempotency key across two collects, decoupled from the random payment_ref (§4)", async () => {
    const s = await seedWorkingOrder(suite.db, freshNif());
    const client = new FakeStripeDevice();
    const provider = providerFor(client);

    const first = await provider.collect(collectParams(s));
    const firstKey = client.lastCollect?.idempotencyKey;
    const firstMetaRef = client.lastCollect?.metadata.payment_ref;
    const second = await provider.collect(collectParams(s));
    const secondKey = client.lastCollect?.idempotencyKey;
    const secondMetaRef = client.lastCollect?.metadata.payment_ref;

    // The Stripe key is derived from the working order and identical across retries...
    expect(firstKey).toBe(`wo_${s.workingOrderId}`);
    expect(secondKey).toBe(firstKey);
    // ...while metadata.payment_ref stays the random local ref (== PaymentResult.paymentRef) and moves.
    expect(firstMetaRef).toBe(first.paymentRef);
    expect(secondMetaRef).toBe(second.paymentRef);
    expect(secondMetaRef).not.toBe(firstMetaRef);
    expect(firstKey).not.toBe(firstMetaRef);
    expect(client.lastCollect?.metadata.working_order_id).toBe(s.workingOrderId);
  });

  it("declined writes a failed row", async () => {
    const s = await seedWorkingOrder(suite.db, freshNif());
    const client = new FakeStripeDevice();
    client.nextCollect("declined");
    const provider = providerFor(client);
    const r = await provider.collect(collectParams(s));
    expect(r.state).toBe("failed");
    const row = await suite.db.transaction((tx) =>
      getPaymentByRef(tx, { provider: "stripe", paymentRef: r.paymentRef }),
    );
    expect(row?.state).toBe("failed");
  });
});

describe("StripeOnDeviceProvider.resolvePending", () => {
  it("resolvePending is all-zeros (the device SDK returns a terminal outcome before collect writes its row)", async () => {
    const provider = providerFor(new FakeStripeDevice());
    expect(await provider.resolvePending(AT)).toEqual({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    });
  });
});

describe("StripeOnDeviceProvider reversals", () => {
  it("refunds a captured payment; a Stripe-refused refund leaves state unchanged", async () => {
    const s = await seedWorkingOrder(suite.db, freshNif());
    const client = new FakeStripeDevice();
    const provider = providerFor(client);
    const paid = await provider.collect(collectParams(s));

    client.refundFailsNext();
    const failed = await provider.refund(paid.paymentRef);
    expect(failed.state).toBe("captured"); // unchanged — no money moved

    const ok = await provider.refund(paid.paymentRef);
    expect(ok.state).toBe("refunded");
  });

  it("void: reverses a captured payment to voided", async () => {
    const s = await seedWorkingOrder(suite.db, freshNif());
    const client = new FakeStripeDevice();
    const provider = providerFor(client);
    const paid = await provider.collect(collectParams(s));

    const voided = await provider.void(paid.paymentRef);
    expect(voided.state).toBe("voided");
  });

  it("partialRefund: reports the refunded amount, not the capture, and sets partially_refunded", async () => {
    const s = await seedWorkingOrder(suite.db, freshNif());
    const client = new FakeStripeDevice();
    const provider = providerFor(client);
    const paid = await provider.collect(collectParams(s)); // amount 10.00

    const refunded = await provider.partialRefund(paid.paymentRef, decimal("4.00"));
    expect(refunded.state).toBe("partially_refunded");
    expect(compareDecimal(refunded.amount, decimal("4.00"))).toBe(0);
  });
});

describe("StripeOnDeviceProvider.connectionToken", () => {
  it("mints a connection token for the device to initialise its on-device SDK", async () => {
    const provider = providerFor(new FakeStripeDevice());

    const { secret } = await provider.connectionToken();
    expect(typeof secret).toBe("string");
    expect(secret.length).toBeGreaterThan(0);
    expect(secret).toMatch(/^pst_/);
  });
});

describe("StripeOnDeviceProvider.collect for a bill payment", () => {
  it.each([
    ["online", "captured"],
    ["declined", "failed"],
  ] as const)(
    "keys the PaymentIntent on the bill payment and names it on the %s row",
    async (scenario, state) => {
      const s = await seedWorkingOrder(suite.db, freshNif());

      const billPaymentId = await seedBillPayment(suite.db, s);
      const client = new FakeStripeDevice();
      client.nextCollect(scenario);

      const r = await providerFor(client).collect({
        ...collectParams(s),
        billPaymentId,
      });

      expect(r.state).toBe(state);
      expect(client.lastCollect?.idempotencyKey).toBe(`bp_${billPaymentId}`);
      expect(await billPaymentOfRow(suite.db, r.paymentRef)).toBe(billPaymentId);
    },
  );
});
