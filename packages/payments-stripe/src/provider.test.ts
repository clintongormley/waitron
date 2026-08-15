import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import {
  AppError,
  decimal,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS, getPaymentByRef, insertCapturedPayment } from "@waitron/payments";
import type { PaymentRow } from "@waitron/payments";
import { FakeStripe } from "./testing/fake-stripe.js";
import { StripeTerminalProvider } from "./provider.js";
import { reverseViaStripe } from "./reverse.js";
import type { StripeClient } from "./client.js";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";

// This suite seeds a FRESH tenant per test (via `freshNif`), like `payments`'s own wiring test — so
// nothing is truncated between tests and the raw `payments` rows never collide. Rows are read back
// through the neutral store's `getPaymentByRef` (which returns `state`/`externalRef`/`settledAt`),
// keeping this adapter package free of a direct `drizzle-orm` dependency.

const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

// The provider's sync-origin node id. Value is irrelevant to these assertions (this container migrates
// core+payments only, no sync capture triggers), but the option is required — it is threaded into the
// adapter's withTenant so enrolled `payments` writes capture a real origin (design §4d(B)).
const TEST_NODE_ID = "11111111-1111-4111-8111-111111111111";

const noSleep = (): Promise<void> => Promise.resolve();
/** A terminal provider is a per-tenant object, so the tenant has to exist before the provider does
 * — which is why every caller below seeds its working order FIRST and threads the tenant in here. */
function providerFor(client: StripeClient, tenantId: TenantId): StripeTerminalProvider {
  return new StripeTerminalProvider({
    client,
    db: pg.db,
    tenantId,
    nodeId: TEST_NODE_ID,
    resolveReader: () => Promise.resolve("reader_1"),
    poll: { maxAttempts: 3, intervalMs: 0, sleep: noSleep },
  });
}
async function collectParams(nif = freshNif()) {
  const s = await seedWorkingOrder(pg.db, nif);
  return {
    tenantId: brandTenantId(s.tenantId),
    tillId: brandTillId(s.tillId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    amount: decimal("12.10"),
    _seeded: s,
  };
}
function rowFor(tenantId: string, paymentRef: string): Promise<PaymentRow | undefined> {
  return pg.db.transaction((tx) =>
    getPaymentByRef(tx, { tenantId, provider: "stripe", paymentRef }),
  );
}
/** A `captured` stripe payment on a fresh tenant whose `external_ref` is EXACTLY the supplied
 * string. Written directly rather than through `collect`, which mints its own `pi_` id: the
 * resolver tests are about which reference the reversal path hands the processor, so the stored one
 * has to be chosen by the test. Returns the payment ref to reverse. */
async function capturedPayment(
  externalRef: string,
): Promise<{ paymentRef: string; tenantId: TenantId }> {
  const seeded = await seedWorkingOrder(pg.db, freshNif());
  const paymentRef = `ref-${externalRef}`;
  await withTenant(pg.db, seeded.tenantId, (tx) =>
    insertCapturedPayment(tx, {
      tenantId: seeded.tenantId,
      workingOrderId: seeded.workingOrderId,
      provider: "stripe",
      paymentRef,
      externalRef,
      amount: decimal("12.10"),
      settledAt: new Date("2026-07-24T10:00:00Z"),
    }),
  );
  return { paymentRef, tenantId: brandTenantId(seeded.tenantId) };
}

describe("StripeTerminalProvider.collect", () => {
  it("captures: attempting -> captured, settledAt set, external_ref = the PI id", async () => {
    const fake = new FakeStripe();
    const p = await collectParams();
    const result = await providerFor(fake, p.tenantId).collect(p);
    expect(result.state).toBe("captured");
    expect(result.settledAt).not.toBeNull();
    expect(result.paymentRef).toMatch(/^[0-9a-f-]{36}$/); // a uuid, NOT the pi id
    const row = await rowFor(p._seeded.tenantId, result.paymentRef);
    expect(row?.state).toBe("captured");
    expect(row?.externalRef).toMatch(/^pi_/);
  });

  it("declines: attempting -> failed, settledAt null", async () => {
    const fake = new FakeStripe();
    fake.declineNext();
    const p = await collectParams();
    const result = await providerFor(fake, p.tenantId).collect(p);
    expect(result.state).toBe("failed");
    expect(result.settledAt).toBeNull();
    const row = await rowFor(p._seeded.tenantId, result.paymentRef);
    expect(row?.state).toBe("failed");
  });

  it("times out: a stalled reader is cancelled and the payment fails", async () => {
    const fake = new FakeStripe();
    fake.stallNext();
    const p = await collectParams();
    const result = await providerFor(fake, p.tenantId).collect(p);
    expect(result.state).toBe("failed");
    const row = await rowFor(p._seeded.tenantId, result.paymentRef);
    expect(row?.state).toBe("failed");
  });

  it("network error before completion: attempting -> failed (the drive catch)", async () => {
    // A client whose network call rejects before the reader ever runs. The committed `attempting`
    // row must still resolve to `failed` (T2), and `collect` must return a `PaymentResult`, never
    // throw — the caller always gets a terminal outcome.
    const failing: StripeClient = {
      createPaymentIntent: () => Promise.reject(new Error("network down")),
      processPaymentIntent: () => Promise.resolve(),
      readerOutcome: () => Promise.resolve({ status: "succeeded" }),
      cancelReaderAction: () => Promise.resolve(),
      refund: () => Promise.resolve({ id: "re_x", status: "succeeded" }),
    };
    const p = await collectParams();
    const result = await providerFor(failing, p.tenantId).collect(p);
    expect(result.state).toBe("failed");
    expect(result.settledAt).toBeNull();
    const row = await rowFor(p._seeded.tenantId, result.paymentRef);
    expect(row?.state).toBe("failed");
    expect(row?.externalRef).toBeNull();
  });

  it("network error mid-poll: attempting -> failed (the drive catch covers the poll loop too)", async () => {
    // readerOutcome rejects on its next call (simulating a network blip while polling) — the poll
    // loop itself must be inside `drive`'s try, so this resolves the row to `failed` rather than
    // throwing out of `collect`.
    const fake = new FakeStripe();
    fake.throwOnPollNext();
    const p = await collectParams();
    const result = await providerFor(fake, p.tenantId).collect(p);
    expect(result.state).toBe("failed");
    expect(result.settledAt).toBeNull();
    const row = await rowFor(p._seeded.tenantId, result.paymentRef);
    expect(row?.state).toBe("failed");
  });

  it("polls the reader with the default real-timer sleep between attempts", async () => {
    // No `sleep` override, so the production default (`setTimeout`) runs; `intervalMs: 0` keeps it
    // instant. The reader is in_progress once, then succeeds, so the loop sleeps exactly once on the
    // real timer before capturing — exercising the shipped default poll delay.
    let polls = 0;
    const client: StripeClient = {
      createPaymentIntent: () => Promise.resolve({ id: "pi_default_sleep" }),
      processPaymentIntent: () => Promise.resolve(),
      readerOutcome: () => Promise.resolve({ status: polls++ === 0 ? "in_progress" : "succeeded" }),
      cancelReaderAction: () => Promise.resolve(),
      refund: () => Promise.resolve({ id: "re_x", status: "succeeded" }),
    };
    const p = await collectParams();
    const provider = new StripeTerminalProvider({
      client,
      db: pg.db,
      tenantId: p.tenantId,
      nodeId: TEST_NODE_ID,
      resolveReader: () => Promise.resolve("reader_1"),
      poll: { maxAttempts: 3, intervalMs: 0 }, // no sleep override -> default setTimeout(0)
    });
    const result = await provider.collect(p);
    expect(result.state).toBe("captured");
    expect(polls).toBe(2);
  });
});

describe("StripeTerminalProvider tenant mis-wiring", () => {
  it("refuses a collect whose params name a different tenant than the provider serves", async () => {
    const mine = await collectParams();
    const other = await collectParams();
    const provider = providerFor(new FakeStripe(), mine.tenantId);

    const error = await provider.collect(other).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("stripe.tenant_mismatch");
  });
});

describe("StripeTerminalProvider reversals", () => {
  it("refund: full refund via Stripe -> state refunded", async () => {
    const fake = new FakeStripe();
    const p = await collectParams();
    const provider = providerFor(fake, p.tenantId);
    const paid = await provider.collect(p);
    const refunded = await provider.refund(paid.paymentRef);
    expect(refunded.state).toBe("refunded");
  });

  it("partialRefund: reports the refunded amount and sets partially_refunded", async () => {
    const fake = new FakeStripe();
    const p = await collectParams(); // amount 12.10
    const provider = providerFor(fake, p.tenantId);
    const paid = await provider.collect(p);
    const refunded = await provider.partialRefund(paid.paymentRef, decimal("5.00"));
    expect(refunded.amount).toBe(decimal("5.00"));
    expect(refunded.state).toBe("partially_refunded");
  });

  it("void: reverses a captured payment to voided", async () => {
    const fake = new FakeStripe();
    const p = await collectParams();
    const provider = providerFor(fake, p.tenantId);
    const paid = await provider.collect(p);
    const voided = await provider.void(paid.paymentRef);
    expect(voided.state).toBe("voided");
  });

  it("a Stripe refund refusal records a failed refund and leaves the payment captured", async () => {
    const fake = new FakeStripe();
    const p = await collectParams();
    const provider = providerFor(fake, p.tenantId);
    const paid = await provider.collect(p);
    fake.refundFailsNext();
    const result = await provider.refund(paid.paymentRef);
    expect(result.state).toBe("captured"); // unchanged — nothing was returned
  });

  it("a Stripe PARTIAL refund refusal reports the attempted amount, not the capture", async () => {
    const fake = new FakeStripe();
    const p = await collectParams();
    const provider = providerFor(fake, p.tenantId);
    const paid = await provider.collect(p); // amount 12.10
    fake.refundFailsNext();
    const result = await provider.partialRefund(paid.paymentRef, decimal("5.00"));
    expect(result.state).toBe("captured"); // unchanged — nothing was returned
    expect(result.amount).toBe(decimal("5.00")); // the attempted amount, NOT 12.10
  });

  it("a second void throws payment.not_voidable from the local pre-check WITHOUT calling Stripe again", async () => {
    const fake = new FakeStripe();
    const refundSpy = vi.spyOn(fake, "refund");
    const p = await collectParams();
    const provider = providerFor(fake, p.tenantId);
    const paid = await provider.collect(p);
    const voided = await provider.void(paid.paymentRef);
    expect(voided.state).toBe("voided");
    expect(refundSpy).toHaveBeenCalledTimes(1);

    const error = await provider.void(paid.paymentRef).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_voidable");
    // The pre-check fired before the network call — the second void never reached Stripe.
    expect(refundSpy).toHaveBeenCalledTimes(1);
  });

  it("throws payment.not_found for an unknown paymentRef", async () => {
    const fake = new FakeStripe();
    // Any tenant: the ref does not exist, so nothing is ever read. Seeding a working order here
    // would cost four inserts to express "some tenant".
    const provider = providerFor(fake, brandTenantId(randomUUID()));
    await expect(provider.refund("no-such-ref")).rejects.toThrow();
  });

  it("throws payment.not_found for a payment with no external_ref (e.g. a declined collect)", async () => {
    const fake = new FakeStripe();
    fake.declineNext();
    const p = await collectParams();
    const provider = providerFor(fake, p.tenantId);
    const failed = await provider.collect(p);
    expect(failed.state).toBe("failed");
    await expect(provider.refund(failed.paymentRef)).rejects.toThrow();
  });
});

describe("reverseViaStripe's processor-ref resolution", () => {
  it("passes the stored external ref to the processor unchanged by default", async () => {
    // The identity default is what keeps the terminal and on-device callers byte-identical: neither
    // supplies a resolver, so the stored `external_ref` must reach `stripe.refunds` untouched.
    const client = new FakeStripe();
    const { paymentRef, tenantId } = await capturedPayment("pi_plain");
    await reverseViaStripe(pg.db, client, "stripe", paymentRef, "refund", undefined, {
      tenantId,
      nodeId: TEST_NODE_ID,
    });
    expect(client.lastRefund?.paymentIntentId).toBe("pi_plain");
  });

  it("resolves the external ref through the supplied resolver before refunding", async () => {
    const client = new FakeStripe();
    const { paymentRef, tenantId } = await capturedPayment("cs_hosted");
    await reverseViaStripe(pg.db, client, "stripe", paymentRef, "refund", undefined, {
      tenantId,
      nodeId: TEST_NODE_ID,
      resolveProcessorRef: (ref) => Promise.resolve(ref === "cs_hosted" ? "pi_resolved" : ref),
    });
    // A hosted payment stores the SESSION id; the refund API needs the PaymentIntent, and before
    // this hook every hosted orphan reversal failed permanently.
    expect(client.lastRefund?.paymentIntentId).toBe("pi_resolved");
  });

  it("resolves only AFTER the local reversibility pre-check has passed", async () => {
    // The resolution is a network call, so it obeys the same T1/T2 rule as the refund itself: an
    // invalid local state must fail fast without touching the processor at all — not even to look
    // an identifier up.
    const client = new FakeStripe();
    const { paymentRef, tenantId } = await capturedPayment("cs_precheck");
    let resolved = 0;
    const resolve = (ref: string): Promise<string> => {
      resolved += 1;
      return Promise.resolve(ref);
    };
    await reverseViaStripe(pg.db, client, "stripe", paymentRef, "void", undefined, {
      tenantId,
      nodeId: TEST_NODE_ID,
      resolveProcessorRef: resolve,
    });
    expect(resolved).toBe(1);
    // Second void: `assertReversible` throws on the now-`voided` row before any resolution happens.
    await expect(
      reverseViaStripe(pg.db, client, "stripe", paymentRef, "void", undefined, {
        tenantId,
        nodeId: TEST_NODE_ID,
        resolveProcessorRef: resolve,
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(resolved).toBe(1);
  });
});

describe("reverseViaStripe's tenant scoping", () => {
  it("refuses another tenant's payment before any money moves, and still reverses the owner's", async () => {
    // `findPaymentByRef` is deliberately untenanted (the `PaymentProvider` reversal methods carry
    // only a payment ref), which left the one query on the reconcile path that goes on to move money
    // relying on RLS alone, while its two siblings on that path (`listReconcilable`,
    // `existingReferences`) each carry an explicit tenant predicate as documented defence-in-depth.
    //
    // This test can only exist BECAUSE PGlite connects as superuser and bypasses FORCE ROW LEVEL
    // SECURITY: the lookup genuinely returns the other tenant's row, so what rejects it is the
    // explicit predicate and nothing else. That is exactly the condition the predicate defends —
    // an RLS-unenforced connection, or one whose tenant GUC was never set.
    const owner = await seedWorkingOrder(pg.db, freshNif());
    const stranger = await seedWorkingOrder(pg.db, freshNif());
    const paymentRef = "ref-cross-tenant";
    await withTenant(pg.db, owner.tenantId, (tx) =>
      insertCapturedPayment(tx, {
        tenantId: owner.tenantId,
        workingOrderId: owner.workingOrderId,
        provider: "stripe",
        paymentRef,
        externalRef: "pi_cross_tenant",
        amount: decimal("12.10"),
        settledAt: new Date("2026-07-24T10:00:00Z"),
      }),
    );
    const client = new FakeStripe();

    const error = await reverseViaStripe(pg.db, client, "stripe", paymentRef, "refund", undefined, {
      tenantId: brandTenantId(stranger.tenantId),
      nodeId: TEST_NODE_ID,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
    expect(client.lastRefund).toBeUndefined(); // nothing reached Stripe

    // The predicate SCOPES rather than blocks: the owning tenant's reversal goes through untouched.
    const ok = await reverseViaStripe(pg.db, client, "stripe", paymentRef, "refund", undefined, {
      tenantId: brandTenantId(owner.tenantId),
      nodeId: TEST_NODE_ID,
    });
    expect(ok.state).toBe("refunded");
    expect(client.lastRefund?.paymentIntentId).toBe("pi_cross_tenant");
  });
});

describe("StripeTerminalProvider.forward", () => {
  it("forward is a no-op for the server-driven provider (no device-local offline queue)", async () => {
    // Any tenant: this forward returns a hardcoded all-zeros result without touching the database.
    const provider = new StripeTerminalProvider({
      client: new FakeStripe(),
      db: pg.db,
      tenantId: brandTenantId(randomUUID()),
      nodeId: TEST_NODE_ID,
      resolveReader: () => Promise.resolve("reader_1"),
    });
    expect(await provider.forward(new Date("2026-07-24T10:00:00Z"))).toEqual({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    });
  });
});
