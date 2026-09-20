import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  compareDecimal,
  decimal,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { PAYMENTS_MIGRATIONS, getPaymentByRef } from "@waitron/payments";
import { openIncidents } from "@waitron/core";
import { FakeStripeDevice } from "./testing/fake-stripe-device.js";
import { StripeOnDeviceProvider } from "./device-provider.js";
import { freshNif, seedPaymentPolicy, seedWorkingOrder } from "@waitron/payments/test/seed.js";

const pg = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const AT = new Date("2026-07-24T10:00:00Z");
// The provider's sync-origin node id — required option, value irrelevant here (no sync triggers in
// this core+payments container); threaded into the adapter's withTransaction (design §4d(B)).
const TEST_NODE_ID = "11111111-1111-4111-8111-111111111111";

function providerFor(client: FakeStripeDevice): StripeOnDeviceProvider {
  return new StripeOnDeviceProvider({
    client,
    db: pg.db,
    nodeId: TEST_NODE_ID,
  });
}

function collectParams(s: { tillId: string; workingOrderId: string }, allowOffline?: boolean) {
  return {
    tillId: brandTillId(s.tillId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    amount: decimal("10.00"),
    ...(allowOffline === undefined ? {} : { allowOffline }),
  };
}

describe("StripeOnDeviceProvider.collect", () => {
  it("online capture writes a captured row with the PI id in external_ref", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
    const provider = providerFor(new FakeStripeDevice());
    const r = await provider.collect(collectParams(s));
    expect(r.state).toBe("captured");
    expect(r.settledAt).not.toBeNull();
    const row = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, { provider: "stripe", paymentRef: r.paymentRef }),
    );
    expect(row?.state).toBe("captured");
    expect(row?.externalRef).toMatch(/^pi_/);
  });

  it("accepted_offline (policy allows, consent given, under cap) chains immediately with offline:true", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
    await seedPaymentPolicy(pg.db, "accept_offline", "50.00");
    const client = new FakeStripeDevice();
    client.nextCollect("offline"); // the gate must ACCEPT (policy + consent + under cap) for the device to store
    const provider = providerFor(client);
    const r = await provider.collect(collectParams(s, true));
    expect(r.state).toBe("accepted_offline");
    expect(r.offline).toBe(true);
    expect(r.settledAt).not.toBeNull();
  });

  it("gate refuses offline (no policy) → device yields network_unavailable → nothing persisted", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
    // No policy row → resolveOfflineDecision refuses → offlineAllowed=false is passed to the device →
    // the offline scenario yields network_unavailable. This makes the gate wiring load-bearing.
    const client = new FakeStripeDevice();
    client.nextCollect("offline");
    const provider = providerFor(client);
    const r = await provider.collect(collectParams(s, true));
    expect(r.state).toBe("network_unavailable");
    expect(r.settledAt).toBeNull();
    const row = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, { provider: "stripe", paymentRef: r.paymentRef }),
    );
    expect(row).toBeUndefined();
  });

  it("stamps the working order and payment ref into the device PaymentIntent metadata", async () => {
    // The same attribution hint the hosted create carries, for the same reason: this provider
    // collects on the reader BEFORE it writes, so a crash in between leaves a captured charge with
    // no local row — reconcile's `missingLocal`. Without these keys such a settlement can never be
    // named to a till, so nobody is told about money we hold no record of. Mirrors
    // hosted-provider.test.ts's "stamps the working order and payment ref into the session metadata".
    const s = await seedWorkingOrder(pg.db, freshNif());
    const client = new FakeStripeDevice();
    const provider = providerFor(client);
    const r = await provider.collect(collectParams(s));
    expect(client.lastCollect?.metadata).toEqual({
      working_order_id: s.workingOrderId,
      payment_ref: r.paymentRef,
    });
  });

  it("derives a stable wo idempotency key across two collects, decoupled from the random payment_ref (§4)", async () => {
    // §4 capture idempotency, on-device half: the device PaymentIntent-creation idempotency key is
    // derived from the working order (stable across retries → one PI → charged once), DECOUPLED from
    // the per-attempt random `paymentRef`. `metadata.payment_ref` stays that random ref (the
    // attribution hint the reconcile audit reads). `lastCollect` records what the device was handed.
    const s = await seedWorkingOrder(pg.db, freshNif());
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
    // Decoupling: the Stripe key is neither random ref, and working_order_id is stamped unchanged.
    expect(firstKey).not.toBe(firstMetaRef);
    expect(client.lastCollect?.metadata.working_order_id).toBe(s.workingOrderId);
  });

  it("declined writes a failed row", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
    const client = new FakeStripeDevice();
    client.nextCollect("declined");
    const provider = providerFor(client);
    const r = await provider.collect(collectParams(s));
    expect(r.state).toBe("failed");
    const row = await pg.db.transaction((tx) =>
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

describe("StripeOnDeviceProvider.forward", () => {
  it("settles a cleared offline payment and declines a refused one (+ one incident), empty queue = zeros", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
    await seedPaymentPolicy(pg.db, "accept_offline", "50.00");
    const client = new FakeStripeDevice();
    const provider = providerFor(client);

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

    const rowA = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, { provider: "stripe", paymentRef: a.paymentRef }),
    );
    const rowB = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, { provider: "stripe", paymentRef: b.paymentRef }),
    );
    expect(rowA?.state).toBe("settled");
    expect(rowB?.state).toBe("declined");
    const incidents = await pg.db.transaction((tx) => openIncidents(tx, brandTillId(s.tillId)));
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

  it("reports a nextDueAt while a ref is still pending on the device", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
    await seedPaymentPolicy(pg.db, "accept_offline", "50.00");
    const client = new FakeStripeDevice();
    const provider = providerFor(client);

    client.nextCollect("offline");
    const a = await provider.collect(collectParams(s, true));
    client.nextCollect("offline");
    const b = await provider.collect(collectParams(s, true));

    // The device resolves `a` and says nothing about `b` — the ordinary case where a ref has
    // neither cleared nor been refused yet. `forward` leaves it for "a later pass".
    client.queueResult({ settled: [a.paymentRef], declined: [] });
    const result = await provider.forward(AT);

    // Precondition: `b` really is still outstanding.
    const rowB = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, { provider: "stripe", paymentRef: b.paymentRef }),
    );
    expect(rowB?.state).toBe("accepted_offline");

    // `ForwardResult.nextDueAt` is documented as "null = nothing pending". Something IS pending,
    // so a host that sleeps until the earliest nextDueAt must be told to come back — otherwise
    // this row stays accepted_offline for ever and the card revenue is never cleared.
    expect(result.nextDueAt).not.toBeNull();
  });
});

describe("StripeOnDeviceProvider reversals", () => {
  it("refunds a captured payment; a Stripe-refused refund leaves state unchanged", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
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
    const s = await seedWorkingOrder(pg.db, freshNif());
    const client = new FakeStripeDevice();
    const provider = providerFor(client);
    const paid = await provider.collect(collectParams(s));

    const voided = await provider.void(paid.paymentRef);
    expect(voided.state).toBe("voided");
  });

  it("partialRefund: reports the refunded amount, not the capture, and sets partially_refunded", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
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
    // Any tenant: `connectionToken` only calls the fake client and touches no database.
    const provider = providerFor(new FakeStripeDevice());

    const { secret } = await provider.connectionToken();
    expect(typeof secret).toBe("string");
    expect(secret.length).toBeGreaterThan(0);
    expect(secret).toMatch(/^pst_/);
  });
});
