import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  AppError,
  decimal,
  workingOrderId as brandWorkingOrderId,
  deviceOrigin,
} from "@waitron/shared";
import {
  PAYMENTS_MIGRATIONS,
  failAttempting,
  getPaymentByRef,
  insertAttempting,
  insertCapturedPayment,
  listAttempting,
  recordResolution,
  stampAttemptingRef,
} from "@waitron/payments";
import type { PaymentRow } from "@waitron/payments";
import { FakeStripe } from "./testing/fake-stripe.js";
import { StripeTerminalProvider } from "./provider.js";
import { reverseViaStripe } from "./reverse.js";
import { stripeClient } from "./stripe-client.js";
import type { StripeClient } from "./client.js";
import {
  billPaymentOfRow,
  freshNif,
  seedBillPayment,
  seedWorkingOrder,
} from "@waitron/payments/test/seed.js";
import type { DeviceOrigin } from "@waitron/shared";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const noSleep = (): Promise<void> => Promise.resolve();
/** For a hand-built client whose test never reads or cancels a PaymentIntent, nor refunds with a
 * key. */
const UNUSED_CALLS: Pick<
  StripeClient,
  "retrievePaymentIntent" | "cancelPaymentIntent" | "createRefund" | "listRefunds"
> = {
  retrievePaymentIntent: () => Promise.reject(new Error("not expected in this test")),
  cancelPaymentIntent: () => Promise.reject(new Error("not expected in this test")),
  createRefund: () => Promise.reject(new Error("not expected in this test")),
  listRefunds: () => Promise.reject(new Error("not expected in this test")),
};
function providerFor(client: StripeClient): StripeTerminalProvider {
  return new StripeTerminalProvider({
    client,
    db: suite.db,
    poll: { maxAttempts: 3, intervalMs: 0, sleep: noSleep },
  });
}
async function collectParams(nif = freshNif()) {
  const s = await seedWorkingOrder(suite.db, nif);
  return {
    origin: deviceOrigin(s.deviceId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    amount: decimal("12.10"),
    readerRef: "reader_1",
    _seeded: s,
  };
}
function rowFor(paymentRef: string): Promise<PaymentRow | undefined> {
  return suite.db.transaction((tx) => getPaymentByRef(tx, { provider: "stripe", paymentRef }));
}
/** Written directly rather than through `collect`, which mints its own `pi_` id: the resolver tests
 * need to choose the stored `external_ref`. */
async function capturedPayment(externalRef: string): Promise<{ paymentRef: string }> {
  const seeded = await seedWorkingOrder(suite.db, freshNif());
  const paymentRef = `ref-${externalRef}`;
  await withTransaction(suite.db, (tx) =>
    insertCapturedPayment(tx, {
      origin: deviceOrigin(seeded.deviceId),
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
      ...UNUSED_CALLS,
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
      ...UNUSED_CALLS,
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
      ...UNUSED_CALLS,
    };
    const p = await collectParams();
    const result = await providerFor(client).collect(p);
    expect(cancels).toEqual(["reader_1"]);
    expect(result.state).toBe("failed");
    const row = await rowFor(result.paymentRef);
    expect(row?.state).toBe("failed");
  });

  it("a reader cancel that throws before returning a promise is best-effort: the payment fails cleanly", async () => {
    const client: StripeClient = {
      createPaymentIntent: () => Promise.reject(new Error("network down")),
      processPaymentIntent: () => Promise.resolve(),
      readerOutcome: () => Promise.resolve({ status: "succeeded" }),
      cancelReaderAction: () => {
        throw new Error("stripe client broke synchronously");
      },
      refund: () => Promise.resolve({ id: "re_x", status: "succeeded" }),
      ...UNUSED_CALLS,
    };
    const p = await collectParams();
    const result = await providerFor(client).collect(p);
    expect(result.state).toBe("failed");
    expect((await rowFor(result.paymentRef))?.state).toBe("failed");
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
      ...UNUSED_CALLS,
    };
    const p = await collectParams();
    const provider = new StripeTerminalProvider({
      client,
      db: suite.db,
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
    await reverseViaStripe(suite.db, client, "stripe", paymentRef, "refund", undefined);
    expect(client.lastRefund?.paymentIntentId).toBe("pi_plain");
  });

  it("resolves the external ref through the supplied resolver before refunding", async () => {
    const client = new FakeStripe();
    const { paymentRef } = await capturedPayment("cs_hosted");
    await reverseViaStripe(suite.db, client, "stripe", paymentRef, "refund", undefined, {
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
    await reverseViaStripe(suite.db, client, "stripe", paymentRef, "void", undefined, {
      resolveProcessorRef: resolve,
    });
    expect(resolved).toBe(1);
    // Second void: `assertReversible` throws on the now-`voided` row before any resolution happens.
    await expect(
      reverseViaStripe(suite.db, client, "stripe", paymentRef, "void", undefined, {
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
      db: suite.db,
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
      db: suite.db,
    });
    expect(await provider.resolvePending(new Date("2026-07-24T10:00:00Z"))).toEqual({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    });
  });
});

/** The one `attempting` stripe row of a working order, as `collect` wrote it. */
async function attemptingRowOf(workingOrderId: string): Promise<{ paymentRef: string }> {
  const rows = await suite.db.transaction((tx) => listAttempting(tx, "stripe"));
  const mine = rows.filter((r) => r.workingOrderId === workingOrderId);
  expect(mine).toHaveLength(1);
  return mine[0]!;
}

describe("StripeTerminalProvider.collect stamps the PaymentIntent before the reader processes it", () => {
  it("the row carries the PaymentIntent id, still attempting, when the reader is asked to process it", async () => {
    const fake = new FakeStripe();
    const seen: { state: string | undefined; externalRef: string | null | undefined }[] = [];
    const p = await collectParams();
    const client: StripeClient = {
      createPaymentIntent: (params) => fake.createPaymentIntent(params),
      processPaymentIntent: async (readerId, piId) => {
        const { paymentRef } = await attemptingRowOf(p.workingOrderId);
        const row = await rowFor(paymentRef);
        seen.push({ state: row?.state, externalRef: row?.externalRef });
        expect(row?.externalRef).toBe(piId);
        return fake.processPaymentIntent(readerId, piId);
      },
      readerOutcome: (r) => fake.readerOutcome(r),
      cancelReaderAction: (r) => fake.cancelReaderAction(r),
      refund: (params) => fake.refund(params),
      ...UNUSED_CALLS,
    };
    const result = await providerFor(client).collect(p);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.state).toBe("attempting");
    expect(seen[0]!.externalRef).toMatch(/^pi_/);
    expect(result.state).toBe("captured");
  });

  it("another payment already holding the PaymentIntent: the reader never processes it and the row fails", async () => {
    const fake = new FakeStripe();
    const { paymentRef: holder } = await capturedPayment("pi_held");
    const cancels: string[] = [];
    const client: StripeClient = {
      createPaymentIntent: () => Promise.resolve({ id: "pi_held" }),
      processPaymentIntent: (readerId, piId) => fake.processPaymentIntent(readerId, piId),
      readerOutcome: (r) => fake.readerOutcome(r),
      cancelReaderAction: (r) => {
        cancels.push(r);
        return Promise.resolve();
      },
      refund: (params) => fake.refund(params),
      ...UNUSED_CALLS,
    };
    const p = await collectParams();
    const result = await providerFor(client).collect(p);
    expect(result.state).toBe("failed");
    expect(result.settledAt).toBeNull();
    expect(fake.processedReaders).toEqual([]);
    // The reader may be serving the payment that holds this PaymentIntent.
    expect(cancels).toEqual([]);
    expect((await rowFor(result.paymentRef))?.state).toBe("failed");
    expect((await rowFor(holder))?.state).toBe("captured");
  });

  it("a row resolved by someone else before the stamp: the reader never processes it and collect reports failed", async () => {
    const fake = new FakeStripe();
    const p = await collectParams();
    const cancels: string[] = [];
    const client: StripeClient = {
      createPaymentIntent: async (params) => {
        const { paymentRef } = await attemptingRowOf(p.workingOrderId);
        await suite.db.transaction((tx) => failAttempting(tx, { provider: "stripe", paymentRef }));
        return fake.createPaymentIntent(params);
      },
      processPaymentIntent: (readerId, piId) => fake.processPaymentIntent(readerId, piId),
      readerOutcome: (r) => fake.readerOutcome(r),
      cancelReaderAction: (r) => {
        cancels.push(r);
        return Promise.resolve();
      },
      refund: (params) => fake.refund(params),
      ...UNUSED_CALLS,
    };
    const result = await providerFor(client).collect(p);
    expect(result.state).toBe("failed");
    expect(result.settledAt).toBeNull();
    expect(fake.processedReaders).toEqual([]);
    expect(cancels).toEqual([]);
    expect((await rowFor(result.paymentRef))?.state).toBe("failed");
  });

  it("a stamp refused for any reason but a held PaymentIntent: collect rejects, the row stays attempting unstamped, and the reader never processes it", async () => {
    const fake = new FakeStripe();
    const p = await collectParams();
    await suite.db.execute(
      sql`create trigger refuse_stamp before update of external_ref on payments
          when new.external_ref is not null
          begin select raise(abort, 'probe: stamp refused'); end`,
    );
    try {
      await expect(providerFor(fake).collect(p)).rejects.toThrow(/probe: stamp refused/);
    } finally {
      await suite.db.execute(sql`drop trigger refuse_stamp`);
    }
    const { paymentRef } = await attemptingRowOf(p.workingOrderId);
    const row = await rowFor(paymentRef);
    expect(row?.state).toBe("attempting");
    expect(row?.externalRef).toBeNull();
    expect(fake.processedReaders).toEqual([]);
  });
});

const NOW = new Date("2026-09-26T12:00:00Z");
const MANAGER = "22222222-2222-4222-8222-222222222222";
const AUDIT = { personId: MANAGER };

/** An `attempting` stripe row as a crash leaves it, optionally stamped with a PaymentIntent. */
async function abandonedRow(
  externalRef: string | null,
  on?: { workingOrderId: string; origin: DeviceOrigin },
): Promise<{ paymentRef: string; paymentId: string; workingOrderId: string }> {
  const seeded = on === undefined ? await seedWorkingOrder(suite.db, freshNif()) : undefined;
  const woId = on?.workingOrderId ?? seeded!.workingOrderId;
  const origin = on?.origin ?? deviceOrigin(seeded!.deviceId);
  const paymentRef = `abandoned-${externalRef ?? "unstamped"}-${Math.random()}`;
  const key = { provider: "stripe", paymentRef };
  return withTransaction(suite.db, async (tx) => {
    await insertAttempting(tx, { ...key, origin, workingOrderId: woId, amount: decimal("12.10") });
    if (externalRef !== null) await stampAttemptingRef(tx, key, externalRef);
    const row = await getPaymentByRef(tx, key);
    return { paymentRef, paymentId: row!.id, workingOrderId: woId };
  });
}

describe("StripeTerminalProvider.resolveAbandonedAttempt", () => {
  it("a row with no PaymentIntent never reached the reader: failed, nothing cancelled, Stripe not asked", async () => {
    const fake = new FakeStripe();
    const retrieve = vi.spyOn(fake, "retrievePaymentIntent");
    const { paymentRef } = await abandonedRow(null);
    expect(await providerFor(fake).resolveAbandonedAttempt(paymentRef, NOW, AUDIT)).toEqual({
      outcome: "failed",
      cancelledAtProvider: false,
    });
    expect(retrieve).not.toHaveBeenCalled();
    expect((await rowFor(paymentRef))?.state).toBe("failed");
  });

  it("Stripe unreachable: unknown/unreachable, the row untouched", async () => {
    const fake = new FakeStripe();
    fake.setIntent("pi_unreach", { status: "requires_payment_method", amount: 1210 });
    fake.unreachableNext();
    const { paymentRef } = await abandonedRow("pi_unreach");
    expect(await providerFor(fake).resolveAbandonedAttempt(paymentRef, NOW, AUDIT)).toEqual({
      outcome: "unknown",
      reason: "unreachable",
    });
    expect((await rowFor(paymentRef))?.state).toBe("attempting");
    expect(fake.cancelledIntents).toEqual([]);
  });

  it("succeeded for the row's amount: captured, settled at `now`, keeping the PaymentIntent id", async () => {
    const fake = new FakeStripe();
    fake.setIntent("pi_paid", { status: "succeeded", amount: 1210, amountReceived: 1210 });
    const { paymentRef } = await abandonedRow("pi_paid");
    expect(await providerFor(fake).resolveAbandonedAttempt(paymentRef, NOW, AUDIT)).toEqual({
      outcome: "captured",
    });
    const row = await rowFor(paymentRef);
    expect(row?.state).toBe("captured");
    expect(row?.settledAt).toBe(NOW.toISOString());
    expect(row?.externalRef).toBe("pi_paid");
  });

  it("succeeded for a different amount: unknown/ambiguous, the row untouched", async () => {
    const fake = new FakeStripe();
    fake.setIntent("pi_short", { status: "succeeded", amount: 1210, amountReceived: 1000 });
    const { paymentRef } = await abandonedRow("pi_short");
    expect(await providerFor(fake).resolveAbandonedAttempt(paymentRef, NOW, AUDIT)).toEqual({
      outcome: "unknown",
      reason: "ambiguous",
      providerStatus: "succeeded",
    });
    expect((await rowFor(paymentRef))?.state).toBe("attempting");
  });

  it("already canceled at Stripe: failed, and the PaymentIntent counts as cancelled at the provider", async () => {
    const fake = new FakeStripe();
    fake.setIntent("pi_gone", { status: "canceled", amount: 1210 });
    const { paymentRef } = await abandonedRow("pi_gone");
    expect(await providerFor(fake).resolveAbandonedAttempt(paymentRef, NOW, AUDIT)).toEqual({
      outcome: "failed",
      cancelledAtProvider: true,
    });
    expect(fake.cancelledIntents).toEqual([]);
    expect((await rowFor(paymentRef))?.state).toBe("failed");
  });

  it.each([
    "requires_payment_method",
    "requires_confirmation",
    "requires_action",
    "requires_capture",
    "processing",
  ])("%s: cancelled at Stripe, then failed", async (status) => {
    const fake = new FakeStripe();
    const id = `pi_${status}`;
    fake.setIntent(id, { status, amount: 1210 });
    const { paymentRef } = await abandonedRow(id);
    expect(await providerFor(fake).resolveAbandonedAttempt(paymentRef, NOW, AUDIT)).toEqual({
      outcome: "failed",
      cancelledAtProvider: true,
    });
    expect(fake.cancelledIntents).toEqual([id]);
    expect((await rowFor(paymentRef))?.state).toBe("failed");
  });

  it("the cancel loses a race to the card: the re-read shows it succeeded, so the row is captured", async () => {
    const fake = new FakeStripe();
    fake.setIntent("pi_race", { status: "requires_payment_method", amount: 1210 });
    fake.cancelRacesNext();
    const { paymentRef } = await abandonedRow("pi_race");
    expect(await providerFor(fake).resolveAbandonedAttempt(paymentRef, NOW, AUDIT)).toEqual({
      outcome: "captured",
    });
    expect((await rowFor(paymentRef))?.state).toBe("captured");
  });

  /** A client scripted call by call, for the sequences the fake does not model. */
  function scripted(
    reads: (() => Promise<{ status: string; amountReceived?: number }>)[],
    cancel: () => Promise<{ status: string }>,
  ): StripeClient & { cancels: number } {
    const fake = new FakeStripe();
    const client = {
      createPaymentIntent: (params: Parameters<StripeClient["createPaymentIntent"]>[0]) =>
        fake.createPaymentIntent(params),
      processPaymentIntent: (r: string, pi: string) => fake.processPaymentIntent(r, pi),
      readerOutcome: (r: string) => fake.readerOutcome(r),
      cancelReaderAction: (r: string) => fake.cancelReaderAction(r),
      refund: (params: Parameters<StripeClient["refund"]>[0]) => fake.refund(params),
      createRefund: (params: Parameters<StripeClient["createRefund"]>[0]) =>
        fake.createRefund(params),
      listRefunds: (pi: string) => fake.listRefunds(pi),
      retrievePaymentIntent: async (id: string) => {
        const next = reads.shift();
        if (next === undefined) throw new Error("unexpected retrieve");
        const r = await next();
        return { id, amount: 1210, amountReceived: 0, ...r };
      },
      cancelPaymentIntent: () => {
        client.cancels += 1;
        return cancel();
      },
      cancels: 0,
    };
    return client;
  }

  it("the cancel is refused but the re-read shows canceled: failed, cancelled at the provider", async () => {
    const client = scripted(
      [
        () => Promise.resolve({ status: "processing" }),
        () => Promise.resolve({ status: "canceled" }),
      ],
      () => Promise.reject(new Error("network blip")),
    );
    const { paymentRef } = await abandonedRow("pi_blip");
    expect(await providerFor(client).resolveAbandonedAttempt(paymentRef, NOW, AUDIT)).toEqual({
      outcome: "failed",
      cancelledAtProvider: true,
    });
    expect(client.cancels).toBe(1);
    expect((await rowFor(paymentRef))?.state).toBe("failed");
  });

  it("after the cancel the re-read shows it succeeded for a different amount: unknown/ambiguous", async () => {
    const client = scripted(
      [
        () => Promise.resolve({ status: "processing" }),
        () => Promise.resolve({ status: "succeeded", amountReceived: 500 }),
      ],
      () => Promise.reject(new Error("cannot cancel")),
    );
    const { paymentRef } = await abandonedRow("pi_part");
    expect(await providerFor(client).resolveAbandonedAttempt(paymentRef, NOW, AUDIT)).toEqual({
      outcome: "unknown",
      reason: "ambiguous",
      providerStatus: "succeeded",
    });
    expect((await rowFor(paymentRef))?.state).toBe("attempting");
  });

  it("the cancel is refused and the re-read still shows processing: unknown/ambiguous with that status", async () => {
    const client = scripted(
      [
        () => Promise.resolve({ status: "processing" }),
        () => Promise.resolve({ status: "processing" }),
      ],
      () => Promise.reject(new Error("cannot cancel")),
    );
    const { paymentRef } = await abandonedRow("pi_stuck");
    expect(await providerFor(client).resolveAbandonedAttempt(paymentRef, NOW, AUDIT)).toEqual({
      outcome: "unknown",
      reason: "ambiguous",
      providerStatus: "processing",
    });
    expect((await rowFor(paymentRef))?.state).toBe("attempting");
  });

  it("Stripe becomes unreachable after the cancel: unknown/unreachable, the row untouched", async () => {
    const client = scripted(
      [
        () => Promise.resolve({ status: "requires_payment_method" }),
        () => Promise.reject(new Error("stripe unreachable")),
      ],
      () => Promise.resolve({ status: "canceled" }),
    );
    const { paymentRef } = await abandonedRow("pi_lost");
    expect(await providerFor(client).resolveAbandonedAttempt(paymentRef, NOW, AUDIT)).toEqual({
      outcome: "unknown",
      reason: "unreachable",
    });
    expect((await rowFor(paymentRef))?.state).toBe("attempting");
  });

  it("a read that throws before returning a promise: unknown/unreachable, the row untouched", async () => {
    const client: StripeClient = {
      ...scripted([], () => Promise.resolve({ status: "canceled" })),
      retrievePaymentIntent: () => {
        throw new Error("stripe client broke synchronously");
      },
    };
    const { paymentRef } = await abandonedRow("pi_sync_read");
    expect(await providerFor(client).resolveAbandonedAttempt(paymentRef, NOW, AUDIT)).toEqual({
      outcome: "unknown",
      reason: "unreachable",
    });
    expect((await rowFor(paymentRef))?.state).toBe("attempting");
  });

  it("a cancel that throws before returning a promise is best-effort: the re-read decides", async () => {
    const client = scripted(
      [
        () => Promise.resolve({ status: "processing" }),
        () => Promise.resolve({ status: "canceled" }),
      ],
      () => {
        throw new Error("stripe client broke synchronously");
      },
    );
    const { paymentRef } = await abandonedRow("pi_sync_cancel");
    expect(await providerFor(client).resolveAbandonedAttempt(paymentRef, NOW, AUDIT)).toEqual({
      outcome: "failed",
      cancelledAtProvider: true,
    });
    expect(client.cancels).toBe(1);
    expect((await rowFor(paymentRef))?.state).toBe("failed");
  });

  it("a status this code does not know: unknown/ambiguous with that status, nothing cancelled", async () => {
    const fake = new FakeStripe();
    fake.setIntent("pi_odd", { status: "requires_source", amount: 1210 });
    const { paymentRef } = await abandonedRow("pi_odd");
    expect(await providerFor(fake).resolveAbandonedAttempt(paymentRef, NOW, AUDIT)).toEqual({
      outcome: "unknown",
      reason: "ambiguous",
      providerStatus: "requires_source",
    });
    expect(fake.cancelledIntents).toEqual([]);
    expect((await rowFor(paymentRef))?.state).toBe("attempting");
  });

  function resolutionsOf(paymentId: string) {
    return suite.db.execute<Record<string, unknown>>(
      sql`select working_order_id, person_id, outcome, cancelled_at_provider, provider_status,
                 resolved_at
            from payment_resolutions where payment_id = ${paymentId}`,
    );
  }

  it.each([
    {
      name: "a row with no PaymentIntent",
      ref: null,
      intent: undefined,
      state: "failed",
      recorded: { outcome: "failed", cancelled_at_provider: 0, provider_status: null },
    },
    {
      name: "a PaymentIntent Stripe captured",
      ref: "pi_audit_paid",
      intent: { status: "succeeded", amount: 1210, amountReceived: 1210 },
      state: "captured",
      recorded: { outcome: "captured", cancelled_at_provider: 0, provider_status: "succeeded" },
    },
    {
      name: "a PaymentIntent cancelled at Stripe",
      ref: "pi_audit_gone",
      intent: { status: "requires_payment_method", amount: 1210 },
      state: "failed",
      recorded: { outcome: "failed", cancelled_at_provider: 1, provider_status: "canceled" },
    },
  ])(
    "$name: records who resolved it and what Stripe said",
    async ({ ref, intent, state, recorded }) => {
      const fake = new FakeStripe();
      if (ref !== null && intent !== undefined) fake.setIntent(ref, intent);
      const row = await abandonedRow(ref);
      await providerFor(fake).resolveAbandonedAttempt(row.paymentRef, NOW, AUDIT);
      expect((await rowFor(row.paymentRef))?.state).toBe(state);
      expect((await resolutionsOf(row.paymentId)).rows).toEqual([
        {
          working_order_id: row.workingOrderId,
          person_id: MANAGER,
          resolved_at: NOW.toISOString(),
          ...recorded,
        },
      ]);
    },
  );

  it.each([
    { name: "a row with no PaymentIntent", ref: null, intent: undefined },
    {
      name: "a PaymentIntent Stripe captured",
      ref: "pi_probe_paid",
      intent: { status: "succeeded", amount: 1210, amountReceived: 1210 },
    },
    {
      name: "a PaymentIntent cancelled at Stripe",
      ref: "pi_probe_gone",
      intent: { status: "requires_payment_method", amount: 1210 },
    },
  ])(
    "$name: when the resolution cannot be recorded, the row stays attempting",
    async ({ ref, intent }) => {
      const fake = new FakeStripe();
      if (ref !== null && intent !== undefined) fake.setIntent(ref, intent);
      const row = await abandonedRow(ref);
      await suite.db.execute(
        sql`create trigger refuse_resolutions before insert on payment_resolutions
          begin select raise(abort, 'probe: resolution refused'); end`,
      );
      try {
        await expect(
          providerFor(fake).resolveAbandonedAttempt(row.paymentRef, NOW, AUDIT),
        ).rejects.toThrow(/probe: resolution refused/);
      } finally {
        await suite.db.execute(sql`drop trigger refuse_resolutions`);
      }
      const after = await rowFor(row.paymentRef);
      expect(after?.state).toBe("attempting");
      expect(after?.externalRef).toBe(ref);
    },
  );

  it("refuses payment.not_found for a row that is missing or no longer attempting", async () => {
    const fake = new FakeStripe();
    const provider = providerFor(fake);
    const missing = await provider
      .resolveAbandonedAttempt("no-such-ref", NOW, AUDIT)
      .catch((e: unknown) => e);
    expect((missing as AppError).code).toBe("payment.not_found");
    const { paymentRef } = await abandonedRow(null);
    await provider.resolveAbandonedAttempt(paymentRef, NOW, AUDIT);
    const again = await provider
      .resolveAbandonedAttempt(paymentRef, NOW, AUDIT)
      .catch((e: unknown) => e);
    expect(again).toBeInstanceOf(AppError);
    expect((again as AppError).code).toBe("payment.not_found");
  });
});

describe("the Stripe idempotency key after a PaymentIntent was cancelled at Stripe", () => {
  async function resolved(
    row: { paymentId: string; workingOrderId: string },
    cancelledAtProvider: boolean,
  ): Promise<void> {
    await withTransaction(suite.db, (tx) =>
      recordResolution(tx, {
        paymentId: row.paymentId,
        workingOrderId: row.workingOrderId,
        personId: "22222222-2222-4222-8222-222222222222",
        outcome: "failed",
        cancelledAtProvider,
        providerStatus: null,
        resolvedAt: NOW,
      }),
    );
  }

  it("the next collect after a cancel creates a new PaymentIntent under a fresh key", async () => {
    const fake = new FakeStripe();
    const p = await collectParams();
    const provider = providerFor(fake);
    fake.setIntent("pi_first", { status: "requires_payment_method", amount: 1210 });
    const stuck = await abandonedRow("pi_first", p);
    const outcome = await provider.resolveAbandonedAttempt(stuck.paymentRef, NOW, AUDIT);
    expect(outcome).toEqual({ outcome: "failed", cancelledAtProvider: true });

    const next = await provider.collect(p);
    expect(fake.lastCreateIntent?.idempotencyKey).toBe(`wo_${p.workingOrderId}_r1`);
    expect(next.state).toBe("captured");
    expect((await rowFor(next.paymentRef))?.externalRef).not.toBe("pi_first");
  });

  it("each further cancel moves the key on; a resolution with nothing cancelled does not", async () => {
    const fake = new FakeStripe();
    const p = await collectParams();
    const provider = providerFor(fake);
    await resolved(await abandonedRow("pi_a", p), true);
    await resolved(await abandonedRow(null, p), false);
    await provider.collect(p);
    expect(fake.lastCreateIntent?.idempotencyKey).toBe(`wo_${p.workingOrderId}_r1`);
    await resolved(await abandonedRow("pi_b", p), true);
    await provider.collect(p);
    expect(fake.lastCreateIntent?.idempotencyKey).toBe(`wo_${p.workingOrderId}_r2`);
  });

  it("another provider's cancelled payment on the same order leaves the Stripe key alone", async () => {
    const fake = new FakeStripe();
    const p = await collectParams();
    const other = await withTransaction(suite.db, async (tx) => {
      const key = { provider: "sumup", paymentRef: "sumup-ref" };
      await insertAttempting(tx, {
        origin: p.origin,
        ...key,
        workingOrderId: p.workingOrderId,
        amount: decimal("12.10"),
      });
      return (await getPaymentByRef(tx, key))!.id;
    });
    await resolved({ paymentId: other, workingOrderId: p.workingOrderId }, true);
    await providerFor(fake).collect(p);
    expect(fake.lastCreateIntent?.idempotencyKey).toBe(`wo_${p.workingOrderId}`);
  });
});

describe("StripeTerminalProvider.collect for a bill payment", () => {
  it("keys the PaymentIntent on the bill payment and names it on the row", async () => {
    const fake = new FakeStripe();
    const p = await collectParams();
    const billPaymentId = await seedBillPayment(suite.db, p._seeded);

    const result = await providerFor(fake).collect({ ...p, billPaymentId });

    expect(result.state).toBe("captured");
    expect(fake.lastCreateIntent?.idempotencyKey).toBe(`bp_${billPaymentId}`);
    expect(await billPaymentOfRow(suite.db, result.paymentRef)).toBe(billPaymentId);
  });

  it("names the bill payment on a declined row", async () => {
    const fake = new FakeStripe();
    fake.declineNext();
    const p = await collectParams();
    const billPaymentId = await seedBillPayment(suite.db, p._seeded);

    const result = await providerFor(fake).collect({ ...p, billPaymentId });

    expect(result.state).toBe("failed");
    expect(await billPaymentOfRow(suite.db, result.paymentRef)).toBe(billPaymentId);
  });

  it("keeps the bill payment's key when a PaymentIntent of the order was cancelled at Stripe", async () => {
    const fake = new FakeStripe();
    const p = await collectParams();
    const stuck = await abandonedRow("pi_cancelled", p);
    await withTransaction(suite.db, (tx) =>
      recordResolution(tx, {
        paymentId: stuck.paymentId,
        workingOrderId: p.workingOrderId,
        personId: MANAGER,
        outcome: "failed",
        cancelledAtProvider: true,
        providerStatus: null,
        resolvedAt: NOW,
      }),
    );
    const billPaymentId = await seedBillPayment(suite.db, p._seeded);

    await providerFor(fake).collect({ ...p, billPaymentId });

    expect(fake.lastCreateIntent?.idempotencyKey).toBe(`bp_${billPaymentId}`);
  });
});

describe("StripeTerminalProvider.sendRefund and lookupRefund", () => {
  const request = (refundId = randomUUID(), amount = "4.00") => ({
    processorRef: "pi_refunded",
    amount: decimal(amount),
    idempotencyKey: `bpr_${refundId}`,
    refundId,
  });
  const query = (refundId: string) => ({
    processorRef: "pi_refunded",
    refundId,
    amount: decimal("4.00"),
    sentAt: new Date("2026-09-27T10:00:00Z"),
    excludeRefs: [],
  });

  it("asks Stripe for the exact amount under the caller's key, carrying the refund's id, and records nothing", async () => {
    const fake = new FakeStripe();
    const refundId = randomUUID();

    const answer = await providerFor(fake).sendRefund(request(refundId, "7.25"));

    expect(fake.createRefundCalls).toEqual([
      {
        paymentIntentId: "pi_refunded",
        amount: decimal("7.25"),
        idempotencyKey: `bpr_${refundId}`,
        metadata: { bill_payment_refund_id: refundId },
      },
    ]);
    expect(answer).toMatchObject({
      kind: "outcome",
      outcome: "completed",
      providerStatus: "succeeded",
    });
    const refunds = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from payment_refunds`,
    );
    expect(refunds.rows[0]!.n).toBe(0);
  });

  it.each([
    ["succeeded", "completed"],
    ["failed", "failed"],
    ["canceled", "failed"],
    ["pending", "pending"],
    ["requires_action", "pending"],
    ["a status Stripe adds later", "pending"],
  ] as const)("maps a refund Stripe answers %s to %s", async (status, outcome) => {
    const fake = new FakeStripe();
    fake.scriptNextCreateRefund({ status });

    const answer = await providerFor(fake).sendRefund(request());

    expect(answer).toEqual({
      kind: "outcome",
      outcome,
      providerRefundRef: expect.stringMatching(/^re_/) as unknown as string,
      providerStatus: status,
    });
  });

  it.each([400, 401, 404])(
    "answers %i as a refusal Stripe documents as no refund made, once Stripe shows no refund of it",
    async (httpStatus) => {
      const fake = new FakeStripe();
      fake.scriptNextCreateRefund({ httpStatus });
      expect(await providerFor(fake).sendRefund(request())).toEqual({
        kind: "refused",
        httpStatus,
        documented: true,
      });
    },
  );

  it.each([402, 403, 409, 424, 429])(
    "answers %i as a refusal that does not say no refund was made",
    async (httpStatus) => {
      const fake = new FakeStripe();
      fake.scriptNextCreateRefund({ httpStatus });
      expect(await providerFor(fake).sendRefund(request())).toEqual({
        kind: "refused",
        httpStatus,
        documented: false,
      });
    },
  );

  it.each([400, 401, 404, 429])(
    "answers a %i that followed a refund Stripe made with the refund Stripe shows",
    async (httpStatus) => {
      const fake = new FakeStripe();
      const refundId = randomUUID();
      fake.scriptNextCreateRefund({ status: "succeeded", answer: { httpStatus } });

      const answer = await providerFor(fake).sendRefund(request(refundId));

      expect(answer).toEqual({
        kind: "outcome",
        outcome: "completed",
        providerRefundRef: expect.stringMatching(/^re_/) as unknown as string,
        providerStatus: "succeeded",
      });
    },
  );

  it.each([400, 401, 404])(
    "answers a %i as uncertain when the SDK sent the request more than once and Stripe shows no refund yet",
    async (httpStatus) => {
      const fake = new FakeStripe();
      fake.scriptNextCreateRefund({ httpStatus, attempts: 2 });

      expect(await providerFor(fake).sendRefund(request())).toEqual({
        kind: "uncertain",
        reason: "network",
        httpStatus,
      });
    },
  );

  it("answers a refusal it cannot check against Stripe's refunds as uncertain", async () => {
    const fake = new FakeStripe();
    fake.scriptNextCreateRefund({ httpStatus: 400 });
    fake.listRefundsUnreachableNext();

    expect(await providerFor(fake).sendRefund(request())).toEqual({
      kind: "uncertain",
      reason: "network",
      httpStatus: 400,
    });
  });

  it.each([500, 503])("answers %i as uncertain: Stripe's server error", async (httpStatus) => {
    const fake = new FakeStripe();
    fake.scriptNextCreateRefund({ httpStatus });
    expect(await providerFor(fake).sendRefund(request())).toEqual({
      kind: "uncertain",
      reason: "server_error",
      httpStatus,
    });
  });

  it("answers a call with no HTTP answer, or a client that throws, as uncertain", async () => {
    const fake = new FakeStripe();
    fake.scriptNextCreateRefund({ httpStatus: null });
    const thrown: StripeClient = {
      ...fake,
      createPaymentIntent: (p) => fake.createPaymentIntent(p),
      processPaymentIntent: (r, pi) => fake.processPaymentIntent(r, pi),
      readerOutcome: (r) => fake.readerOutcome(r),
      cancelReaderAction: (r) => fake.cancelReaderAction(r),
      refund: (p) => fake.refund(p),
      retrievePaymentIntent: (id) => fake.retrievePaymentIntent(id),
      cancelPaymentIntent: (id) => fake.cancelPaymentIntent(id),
      listRefunds: (pi) => fake.listRefunds(pi),
      createRefund: () => Promise.reject(new Error("credential unreadable")),
    };

    expect(await providerFor(fake).sendRefund(request())).toEqual({
      kind: "uncertain",
      reason: "network",
    });
    expect(await providerFor(thrown).sendRefund(request())).toEqual({
      kind: "uncertain",
      reason: "network",
    });
  });

  it("finds the refund whose metadata carries the refund's id, among the payment intent's others", async () => {
    const fake = new FakeStripe();
    const provider = providerFor(fake);
    const refundId = randomUUID();
    await provider.sendRefund(request());
    fake.scriptNextCreateRefund({ status: "requires_action", answer: { httpStatus: null } });
    await provider.sendRefund(request(refundId));
    await provider.sendRefund(request());

    const found = await provider.lookupRefund(query(refundId));

    expect(found).toEqual({
      kind: "match",
      providerRefundRef: expect.stringMatching(/^re_/) as unknown as string,
      outcome: "pending",
      providerStatus: "requires_action",
    });
  });

  it("finds none for a refund Stripe never made, and answers unreachable when Stripe cannot be read", async () => {
    const fake = new FakeStripe();
    const provider = providerFor(fake);
    await provider.sendRefund(request());

    const none = await provider.lookupRefund(query(randomUUID()));
    fake.listRefundsUnreachableNext();
    const unreachable = await provider.lookupRefund(query(randomUUID()));

    expect(none).toEqual({ kind: "none" });
    expect(unreachable).toEqual({ kind: "unreachable" });
  });

  it("answers ambiguous when two of Stripe's refunds carry the refund's id", async () => {
    const fake = new FakeStripe();
    const provider = providerFor(fake);
    const refundId = randomUUID();
    await provider.sendRefund(request(refundId));
    await provider.sendRefund({ ...request(refundId), idempotencyKey: "another key" });

    expect(await provider.lookupRefund(query(refundId))).toEqual({
      kind: "ambiguous",
      candidates: 2,
    });
  });

  it("keeps a resend with the same key safe for 24 hours, the time Stripe keeps a key", () => {
    expect(providerFor(new FakeStripe()).refundResendWindowMs).toBe(24 * 60 * 60 * 1000);
  });
});

describe("a Stripe refund whose first attempt refunded and whose answer was a refusal", () => {
  it("stays uncertain when the repeat is refused before the first attempt's refund shows, through the installed SDK against a local Stripe", async () => {
    const refundId = randomUUID();
    const refund = {
      id: "re_local_1",
      object: "refund",
      status: "succeeded",
      metadata: { bill_payment_refund_id: refundId },
    };
    const posts: (string | undefined)[] = [];
    let visible = false;
    const server = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        const answer = (status: number, body: unknown) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        };
        if (req.method === "GET") {
          answer(200, { object: "list", data: visible ? [refund] : [], has_more: false });
          return;
        }
        posts.push(req.headers["idempotency-key"] as string | undefined);
        // The first attempt refunds and its connection closes before the answer.
        if (posts.length === 1) req.socket.destroy();
        else answer(400, { error: { type: "invalid_request_error", message: "invalid" } });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const provider = providerFor(
        stripeClient(new Stripe("sk_test_local", { host: "127.0.0.1", port, protocol: "http" })),
      );

      const answer = await provider.sendRefund({
        processorRef: "pi_local",
        amount: decimal("5.00"),
        idempotencyKey: `bpr_${refundId}`,
        refundId,
      });
      visible = true;
      const later = await provider.lookupRefund({
        processorRef: "pi_local",
        refundId,
        amount: decimal("5.00"),
        sentAt: new Date(),
        excludeRefs: [],
      });

      expect(posts).toEqual([`bpr_${refundId}`, `bpr_${refundId}`]);
      expect(answer).toEqual({ kind: "uncertain", reason: "network", httpStatus: 400 });
      expect(later).toMatchObject({ kind: "match", outcome: "completed" });
    } finally {
      server.close();
    }
  });

  it("is answered with the refund Stripe holds, through the installed SDK against a local Stripe", async () => {
    const refundId = randomUUID();
    const refund = {
      id: "re_local_1",
      object: "refund",
      status: "succeeded",
      metadata: { bill_payment_refund_id: refundId },
    };
    const posts: (string | undefined)[] = [];
    const server = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        const answer = (status: number, body: unknown) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        };
        if (req.method === "GET") {
          answer(200, { object: "list", data: [refund], has_more: false });
          return;
        }
        posts.push(req.headers["idempotency-key"] as string | undefined);
        // The first attempt refunds and its connection closes before the answer.
        if (posts.length === 1) req.socket.destroy();
        else answer(429, { error: { type: "invalid_request_error", message: "rate limited" } });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const client = stripeClient(
        new Stripe("sk_test_local", { host: "127.0.0.1", port, protocol: "http" }),
      );

      const answer = await providerFor(client).sendRefund({
        processorRef: "pi_local",
        amount: decimal("5.00"),
        idempotencyKey: `bpr_${refundId}`,
        refundId,
      });

      expect(posts).toEqual([`bpr_${refundId}`, `bpr_${refundId}`]);
      expect(answer).toEqual({
        kind: "outcome",
        outcome: "completed",
        providerRefundRef: "re_local_1",
        providerStatus: "succeeded",
      });
    } finally {
      server.close();
    }
  });
});
