import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  AppError,
  decimal,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { PAYMENTS_MIGRATIONS, getPaymentByRef, insertCapturedPayment } from "@waitron/payments";
import type { PaymentRow } from "@waitron/payments";
import { FakeStripe } from "./testing/fake-stripe.js";
import { StripeTerminalProvider } from "./provider.js";
import { reverseViaStripe } from "./reverse.js";
import type { StripeClient } from "./client.js";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";

const pg = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const TEST_NODE_ID = "11111111-1111-4111-8111-111111111111";

const noSleep = (): Promise<void> => Promise.resolve();
function providerFor(client: StripeClient): StripeTerminalProvider {
  return new StripeTerminalProvider({
    client,
    db: pg.db,
    nodeId: TEST_NODE_ID,
    poll: { maxAttempts: 3, intervalMs: 0, sleep: noSleep },
  });
}
async function collectParams(nif = freshNif()) {
  const s = await seedWorkingOrder(pg.db, nif);
  return {
    tillId: brandTillId(s.tillId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    amount: decimal("12.10"),
    readerRef: "reader_1",
    _seeded: s,
  };
}
function rowFor(paymentRef: string): Promise<PaymentRow | undefined> {
  return pg.db.transaction((tx) => getPaymentByRef(tx, { provider: "stripe", paymentRef }));
}
/** Written directly rather than through `collect`, which mints its own `pi_` id: the resolver tests
 * need to choose the stored `external_ref`. */
async function capturedPayment(externalRef: string): Promise<{ paymentRef: string }> {
  const seeded = await seedWorkingOrder(pg.db, freshNif());
  const paymentRef = `ref-${externalRef}`;
  await withTransaction(pg.db, (tx) =>
    insertCapturedPayment(tx, {
      workingOrderId: seeded.workingOrderId,
      provider: "stripe",
      paymentRef,
      externalRef,
      amount: decimal("12.10"),
      settledAt: new Date("2026-07-24T10:00:00Z"),
    }),
  );
  return { paymentRef };
}

describe("StripeTerminalProvider.collect", () => {
  it("captures: attempting -> captured, settledAt set, external_ref = the PI id", async () => {
    const fake = new FakeStripe();
    const p = await collectParams();
    const result = await providerFor(fake).collect(p);
    expect(result.state).toBe("captured");
    expect(result.settledAt).not.toBeNull();
    expect(result.paymentRef).toMatch(/^[0-9a-f-]{36}$/); // a uuid, NOT the pi id
    const row = await rowFor(result.paymentRef);
    expect(row?.state).toBe("captured");
    expect(row?.externalRef).toMatch(/^pi_/);
  });

  it("declines: attempting -> failed, settledAt null", async () => {
    const fake = new FakeStripe();
    fake.declineNext();
    const p = await collectParams();
    const result = await providerFor(fake).collect(p);
    expect(result.state).toBe("failed");
    expect(result.settledAt).toBeNull();
    const row = await rowFor(result.paymentRef);
    expect(row?.state).toBe("failed");
  });

  it("throws when no readerRef is supplied — a Terminal collect cannot proceed without a reader", async () => {
    const p = await collectParams();
    const { readerRef, ...noReader } = p;
    void readerRef;
    await expect(providerFor(new FakeStripe()).collect(noReader)).rejects.toThrow(/readerRef/);
  });

  it("times out: a stalled reader is cancelled and the payment fails", async () => {
    const fake = new FakeStripe();
    fake.stallNext();
    const p = await collectParams();
    const result = await providerFor(fake).collect(p);
    expect(result.state).toBe("failed");
    const row = await rowFor(result.paymentRef);
    expect(row?.state).toBe("failed");
  });

  it("network error before completion: attempting -> failed (the drive catch)", async () => {
    const failing: StripeClient = {
      createPaymentIntent: () => Promise.reject(new Error("network down")),
      processPaymentIntent: () => Promise.resolve(),
      readerOutcome: () => Promise.resolve({ status: "succeeded" }),
      cancelReaderAction: () => Promise.resolve(),
      refund: () => Promise.resolve({ id: "re_x", status: "succeeded" }),
    };
    const p = await collectParams();
    const result = await providerFor(failing).collect(p);
    expect(result.state).toBe("failed");
    expect(result.settledAt).toBeNull();
    const row = await rowFor(result.paymentRef);
    expect(row?.state).toBe("failed");
    expect(row?.externalRef).toBeNull();
  });

  it("network error mid-poll: attempting -> failed (the drive catch covers the poll loop too)", async () => {
    // The poll loop itself must be inside `drive`'s try, so this resolves the row to `failed`
    // rather than throwing out of `collect`.
    const fake = new FakeStripe();
    fake.throwOnPollNext();
    const p = await collectParams();
    const result = await providerFor(fake).collect(p);
    expect(result.state).toBe("failed");
    expect(result.settledAt).toBeNull();
    const row = await rowFor(result.paymentRef);
    expect(row?.state).toBe("failed");
  });

  it("a timed-out collect still fails cleanly when cancelling the reader action is refused", async () => {
    const cancels: string[] = [];
    const client: StripeClient = {
      createPaymentIntent: () => Promise.resolve({ id: "pi_stalled" }),
      processPaymentIntent: () => Promise.resolve(),
      readerOutcome: () => Promise.resolve({ status: "in_progress" }),
      cancelReaderAction: (readerId) => {
        cancels.push(readerId);
        return Promise.reject(new Error("reader unreachable"));
      },
      refund: () => Promise.resolve({ id: "re_x", status: "succeeded" }),
    };
    const p = await collectParams();
    const result = await providerFor(client).collect(p);
    expect(cancels).toEqual(["reader_1"]);
    expect(result.state).toBe("failed");
    const row = await rowFor(result.paymentRef);
    expect(row?.state).toBe("failed");
  });

  it("a network error still fails cleanly when cancelling the reader action is refused", async () => {
    const cancels: string[] = [];
    const client: StripeClient = {
      createPaymentIntent: () => Promise.reject(new Error("network down")),
      processPaymentIntent: () => Promise.resolve(),
      readerOutcome: () => Promise.resolve({ status: "succeeded" }),
      cancelReaderAction: (readerId) => {
        cancels.push(readerId);
        return Promise.reject(new Error("reader unreachable"));
      },
      refund: () => Promise.resolve({ id: "re_x", status: "succeeded" }),
    };
    const p = await collectParams();
    const result = await providerFor(client).collect(p);
    expect(cancels).toEqual(["reader_1"]);
    expect(result.state).toBe("failed");
    const row = await rowFor(result.paymentRef);
    expect(row?.state).toBe("failed");
  });

  it("polls the reader with the default real-timer sleep between attempts", async () => {
    // No `sleep` override, so the production default (`setTimeout`) runs; `intervalMs: 0` keeps it
    // instant.
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
      nodeId: TEST_NODE_ID,
      poll: { maxAttempts: 3, intervalMs: 0 },
    });
    const result = await provider.collect(p);
    expect(result.state).toBe("captured");
    expect(polls).toBe(2);
  });
});

describe("StripeTerminalProvider reversals", () => {
  it("refund: full refund via Stripe -> state refunded", async () => {
    const fake = new FakeStripe();
    const p = await collectParams();
    const provider = providerFor(fake);
    const paid = await provider.collect(p);
    const refunded = await provider.refund(paid.paymentRef);
    expect(refunded.state).toBe("refunded");
  });

  it("partialRefund: reports the refunded amount and sets partially_refunded", async () => {
    const fake = new FakeStripe();
    const p = await collectParams(); // amount 12.10
    const provider = providerFor(fake);
    const paid = await provider.collect(p);
    const refunded = await provider.partialRefund(paid.paymentRef, decimal("5.00"));
    expect(refunded.amount).toBe(decimal("5.00"));
    expect(refunded.state).toBe("partially_refunded");
  });

  it("void: reverses a captured payment to voided", async () => {
    const fake = new FakeStripe();
    const p = await collectParams();
    const provider = providerFor(fake);
    const paid = await provider.collect(p);
    const voided = await provider.void(paid.paymentRef);
    expect(voided.state).toBe("voided");
  });

  it("a Stripe refund refusal records a failed refund and leaves the payment captured", async () => {
    const fake = new FakeStripe();
    const p = await collectParams();
    const provider = providerFor(fake);
    const paid = await provider.collect(p);
    fake.refundFailsNext();
    const result = await provider.refund(paid.paymentRef);
    expect(result.state).toBe("captured"); // unchanged — nothing was returned
  });

  it("a Stripe PARTIAL refund refusal reports the attempted amount, not the capture", async () => {
    const fake = new FakeStripe();
    const p = await collectParams();
    const provider = providerFor(fake);
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
    const provider = providerFor(fake);
    const paid = await provider.collect(p);
    const voided = await provider.void(paid.paymentRef);
    expect(voided.state).toBe("voided");
    expect(refundSpy).toHaveBeenCalledTimes(1);

    const error = await provider.void(paid.paymentRef).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_voidable");
    expect(refundSpy).toHaveBeenCalledTimes(1);
  });

  it("throws payment.not_found for an unknown paymentRef", async () => {
    const fake = new FakeStripe();
    const provider = providerFor(fake);
    await expect(provider.refund("no-such-ref")).rejects.toThrow();
  });

  it("throws payment.not_found for a payment with no external_ref (e.g. a declined collect)", async () => {
    const fake = new FakeStripe();
    fake.declineNext();
    const p = await collectParams();
    const provider = providerFor(fake);
    const failed = await provider.collect(p);
    expect(failed.state).toBe("failed");
    await expect(provider.refund(failed.paymentRef)).rejects.toThrow();
  });
});

describe("reverseViaStripe's processor-ref resolution", () => {
  it("passes the stored external ref to the processor unchanged by default", async () => {
    // The terminal and on-device providers supply no resolver.
    const client = new FakeStripe();
    const { paymentRef } = await capturedPayment("pi_plain");
    await reverseViaStripe(pg.db, client, "stripe", paymentRef, "refund", undefined, {
      nodeId: TEST_NODE_ID,
    });
    expect(client.lastRefund?.paymentIntentId).toBe("pi_plain");
  });

  it("resolves the external ref through the supplied resolver before refunding", async () => {
    const client = new FakeStripe();
    const { paymentRef } = await capturedPayment("cs_hosted");
    await reverseViaStripe(pg.db, client, "stripe", paymentRef, "refund", undefined, {
      nodeId: TEST_NODE_ID,
      resolveProcessorRef: (ref) => Promise.resolve(ref === "cs_hosted" ? "pi_resolved" : ref),
    });
    // A hosted payment stores the SESSION id; the refund API needs the PaymentIntent.
    expect(client.lastRefund?.paymentIntentId).toBe("pi_resolved");
  });

  it("resolves only AFTER the local reversibility pre-check has passed", async () => {
    // The resolution is a network call: an invalid local state must fail without touching the
    // processor at all.
    const client = new FakeStripe();
    const { paymentRef } = await capturedPayment("cs_precheck");
    let resolved = 0;
    const resolve = (ref: string): Promise<string> => {
      resolved += 1;
      return Promise.resolve(ref);
    };
    await reverseViaStripe(pg.db, client, "stripe", paymentRef, "void", undefined, {
      nodeId: TEST_NODE_ID,
      resolveProcessorRef: resolve,
    });
    expect(resolved).toBe(1);
    // Second void: `assertReversible` throws on the now-`voided` row before any resolution happens.
    await expect(
      reverseViaStripe(pg.db, client, "stripe", paymentRef, "void", undefined, {
        nodeId: TEST_NODE_ID,
        resolveProcessorRef: resolve,
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(resolved).toBe(1);
  });
});

describe("StripeTerminalProvider.forward", () => {
  it("forward is a no-op for the server-driven provider (no device-local offline queue)", async () => {
    const provider = new StripeTerminalProvider({
      client: new FakeStripe(),
      db: pg.db,
      nodeId: TEST_NODE_ID,
    });
    expect(await provider.forward(new Date("2026-07-24T10:00:00Z"))).toEqual({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    });
  });
});

describe("StripeTerminalProvider.resolvePending", () => {
  it("resolvePending is all-zeros (drive resolves stalls to failed inside collect)", async () => {
    const provider = new StripeTerminalProvider({
      client: new FakeStripe(),
      db: pg.db,
      nodeId: TEST_NODE_ID,
    });
    expect(await provider.resolvePending(new Date("2026-07-24T10:00:00Z"))).toEqual({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    });
  });
});
