import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import {
  AppError,
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

const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const AT = new Date("2026-07-24T10:00:00Z");

/** An on-device provider is a per-till, therefore per-tenant, object, so the tenant has to exist
 * before the provider does. Mirrors `provider.test.ts`'s `providerFor`. */
function providerFor(client: FakeStripeDevice, s: { tenantId: string }): StripeOnDeviceProvider {
  return new StripeOnDeviceProvider({ client, db: pg.db, tenantId: brandTenantId(s.tenantId) });
}

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
    const s = await seedWorkingOrder(pg.db, freshNif());
    const provider = providerFor(new FakeStripeDevice(), s);
    const r = await provider.collect(collectParams(s));
    expect(r.state).toBe("captured");
    expect(r.settledAt).not.toBeNull();
    const row = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "stripe", paymentRef: r.paymentRef }),
    );
    expect(row?.state).toBe("captured");
    expect(row?.externalRef).toMatch(/^pi_/);
  });

  it("accepted_offline (policy allows, consent given, under cap) chains immediately with offline:true", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
    await seedPaymentPolicy(pg.db, s.tenantId, "accept_offline", "50.00");
    const client = new FakeStripeDevice();
    client.nextCollect("offline"); // the gate must ACCEPT (policy + consent + under cap) for the device to store
    const provider = providerFor(client, s);
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
    const provider = providerFor(client, s);
    const r = await provider.collect(collectParams(s, true));
    expect(r.state).toBe("network_unavailable");
    expect(r.settledAt).toBeNull();
    const row = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "stripe", paymentRef: r.paymentRef }),
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
    const provider = providerFor(client, s);
    const r = await provider.collect(collectParams(s));
    expect(client.lastCollect?.metadata).toEqual({
      working_order_id: s.workingOrderId,
      payment_ref: r.paymentRef,
    });
  });

  it("declined writes a failed row", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
    const client = new FakeStripeDevice();
    client.nextCollect("declined");
    const provider = providerFor(client, s);
    const r = await provider.collect(collectParams(s));
    expect(r.state).toBe("failed");
    const row = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "stripe", paymentRef: r.paymentRef }),
    );
    expect(row?.state).toBe("failed");
  });
});

describe("StripeOnDeviceProvider tenant mis-wiring", () => {
  it("refuses a collect whose params name a different tenant than the provider serves, before charging", async () => {
    const mine = await seedWorkingOrder(pg.db, freshNif());
    const other = await seedWorkingOrder(pg.db, freshNif());
    const client = new FakeStripeDevice();
    const provider = providerFor(client, mine);

    // A host that wired this provider to `mine` but handed it `other`'s working order.
    const error = await provider.collect(collectParams(other)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("stripe.tenant_mismatch");

    // The point of the guard: it fires BEFORE the device is asked for money. Without it the
    // mismatch surfaces at insertCapturedPayment — after `collectOnDevice` has taken the card
    // payment — which is the branch's own worst defect re-created as designed behaviour.
    expect(client.lastCollect).toBeNull();
  });

  it("accepts a params tenant that differs only in UUID case", async () => {
    // `tenantId()` validates case-insensitively and returns the value unchanged, so a host reading
    // its tenant from config in upper case and a caller carrying the canonical lower-case form
    // Postgres renders hold the SAME tenant. A `!==` comparison would reject every sale.
    const s = await seedWorkingOrder(pg.db, freshNif());
    const provider = new StripeOnDeviceProvider({
      client: new FakeStripeDevice(),
      db: pg.db,
      tenantId: brandTenantId(s.tenantId.toUpperCase()),
    });
    const r = await provider.collect(collectParams(s));
    expect(r.state).toBe("captured");
  });
});

describe("StripeOnDeviceProvider.forward", () => {
  it("settles a cleared offline payment and declines a refused one (+ one incident), empty queue = zeros", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
    await seedPaymentPolicy(pg.db, s.tenantId, "accept_offline", "50.00");
    const client = new FakeStripeDevice();
    const provider = providerFor(client, s);

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
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "stripe", paymentRef: a.paymentRef }),
    );
    const rowB = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "stripe", paymentRef: b.paymentRef }),
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
    await seedPaymentPolicy(pg.db, s.tenantId, "accept_offline", "50.00");
    const client = new FakeStripeDevice();
    const provider = providerFor(client, s);

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
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "stripe", paymentRef: b.paymentRef }),
    );
    expect(rowB?.state).toBe("accepted_offline");

    // `ForwardResult.nextDueAt` is documented as "null = nothing pending". Something IS pending,
    // so a host that sleeps until the earliest nextDueAt must be told to come back — otherwise
    // this row stays accepted_offline for ever and the card revenue is never cleared.
    expect(result.nextDueAt).not.toBeNull();
  });
});

describe("StripeOnDeviceProvider.forward tenant isolation", () => {
  it("does not forward another tenant's accepted_offline payment", async () => {
    // The explicit `tenant_id` predicate in `forwardableWhere`, asserted directly rather than
    // incidentally. Under PGlite the RLS policy is bypassed (superuser), so the predicate is the
    // ONLY thing scoping this — which is exactly the condition it was added to defend, and the
    // reason a hermetic forward test means anything.
    const mine = await seedWorkingOrder(pg.db, freshNif());
    const theirs = await seedWorkingOrder(pg.db, freshNif());
    await seedPaymentPolicy(pg.db, theirs.tenantId, "accept_offline", "50.00");

    const theirClient = new FakeStripeDevice();
    theirClient.nextCollect("offline");
    const theirs_ = await providerFor(theirClient, theirs).collect(collectParams(theirs, true));
    expect(theirs_.state).toBe("accepted_offline");

    // My provider sweeps. The device would happily settle their ref if it were listed.
    const myClient = new FakeStripeDevice();
    myClient.queueResult({ settled: [theirs_.paymentRef], declined: [] });
    const result = await providerFor(myClient, mine).forward(AT);

    expect(result).toEqual({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
    const row = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, {
        tenantId: theirs.tenantId,
        provider: "stripe",
        paymentRef: theirs_.paymentRef,
      }),
    );
    expect(row?.state).toBe("accepted_offline"); // untouched
  });
});

describe("StripeOnDeviceProvider reversals", () => {
  it("refunds a captured payment; a Stripe-refused refund leaves state unchanged", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
    const client = new FakeStripeDevice();
    const provider = providerFor(client, s);
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
    const provider = providerFor(client, s);
    const paid = await provider.collect(collectParams(s));

    const voided = await provider.void(paid.paymentRef);
    expect(voided.state).toBe("voided");
  });

  it("partialRefund: reports the refunded amount, not the capture, and sets partially_refunded", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
    const client = new FakeStripeDevice();
    const provider = providerFor(client, s);
    const paid = await provider.collect(collectParams(s)); // amount 10.00

    const refunded = await provider.partialRefund(paid.paymentRef, decimal("4.00"));
    expect(refunded.state).toBe("partially_refunded");
    expect(compareDecimal(refunded.amount, decimal("4.00"))).toBe(0);
  });
});

describe("StripeOnDeviceProvider.connectionToken", () => {
  it("mints a connection token for the device to initialise its on-device SDK", async () => {
    // Any tenant: `connectionToken` only calls the fake client and touches no database.
    const provider = providerFor(new FakeStripeDevice(), { tenantId: randomUUID() });

    const { secret } = await provider.connectionToken();
    expect(typeof secret).toBe("string");
    expect(secret.length).toBeGreaterThan(0);
    expect(secret).toMatch(/^pst_/);
  });
});
