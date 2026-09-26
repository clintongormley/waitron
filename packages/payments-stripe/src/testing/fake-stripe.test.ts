import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { FakeStripe } from "./fake-stripe.js";

describe("FakeStripe", () => {
  it("createPaymentIntent mints a pi_ id; a captured reader outcome succeeds", async () => {
    const fake = new FakeStripe();
    const pi = await fake.createPaymentIntent({
      amount: decimal("12.10"),
      currency: "eur",
      idempotencyKey: "k1",
    });
    expect(pi.id).toMatch(/^pi_/);
    await fake.processPaymentIntent("reader_1", pi.id);
    expect(await fake.readerOutcome("reader_1")).toEqual({ status: "succeeded" });
  });

  it("declineNext makes the reader outcome fail", async () => {
    const fake = new FakeStripe();
    fake.declineNext();
    const pi = await fake.createPaymentIntent({
      amount: decimal("1.00"),
      currency: "eur",
      idempotencyKey: "k2",
    });
    await fake.processPaymentIntent("reader_1", pi.id);
    expect((await fake.readerOutcome("reader_1")).status).toBe("failed");
  });

  it("stallNext keeps the outcome in_progress until cancelled", async () => {
    const fake = new FakeStripe();
    fake.stallNext();
    const pi = await fake.createPaymentIntent({
      amount: decimal("1.00"),
      currency: "eur",
      idempotencyKey: "k3",
    });
    await fake.processPaymentIntent("reader_1", pi.id);
    expect((await fake.readerOutcome("reader_1")).status).toBe("in_progress");
    await fake.cancelReaderAction("reader_1");
    expect((await fake.readerOutcome("reader_1")).status).toBe("failed");
  });

  it("refund echoes a succeeded refund by default; refundFailsNext makes it fail", async () => {
    const fake = new FakeStripe();
    const ok = await fake.refund({ paymentIntentId: "pi_x", idempotencyKey: "r1" });
    expect(ok.status).toBe("succeeded");
    fake.refundFailsNext();
    const bad = await fake.refund({ paymentIntentId: "pi_x", idempotencyKey: "r2" });
    expect(bad.status).toBe("failed");
  });

  it("records the last createPaymentIntent params, and nothing before the first call", async () => {
    const fake = new FakeStripe();
    expect(fake.lastCreateIntent).toBeUndefined();
    await fake.createPaymentIntent({
      amount: decimal("12.10"),
      currency: "eur",
      idempotencyKey: "wo_a",
    });
    await fake.createPaymentIntent({
      amount: decimal("3.50"),
      currency: "eur",
      idempotencyKey: "wo_b",
    });
    expect(fake.lastCreateIntent).toEqual({
      amount: decimal("3.50"),
      currency: "eur",
      idempotencyKey: "wo_b",
    });
  });

  it("records the last refund's params, and nothing before the first refund", async () => {
    const fake = new FakeStripe();
    expect(fake.lastRefund).toBeUndefined();
    await fake.refund({ paymentIntentId: "pi_first", idempotencyKey: "r1" });
    await fake.refund({
      paymentIntentId: "pi_second",
      amount: decimal("5.00"),
      idempotencyKey: "r2",
    });
    expect(fake.lastRefund).toEqual({
      paymentIntentId: "pi_second",
      amount: decimal("5.00"),
      idempotencyKey: "r2",
    });
  });

  it("retrievePaymentIntent reports a created intent awaiting a card, in minor units", async () => {
    const fake = new FakeStripe();
    const pi = await fake.createPaymentIntent({
      amount: decimal("12.10"),
      currency: "eur",
      idempotencyKey: "k4",
    });
    expect(await fake.retrievePaymentIntent(pi.id)).toEqual({
      id: pi.id,
      status: "requires_payment_method",
      amount: 1210,
      amountReceived: 0,
    });
  });

  it("a processed intent reads succeeded with the amount received, a declined one still awaits a card", async () => {
    const fake = new FakeStripe();
    const paid = await fake.createPaymentIntent({
      amount: decimal("3.00"),
      currency: "eur",
      idempotencyKey: "k5",
    });
    await fake.processPaymentIntent("reader_1", paid.id);
    expect(await fake.retrievePaymentIntent(paid.id)).toMatchObject({
      status: "succeeded",
      amountReceived: 300,
    });
    fake.declineNext();
    const declined = await fake.createPaymentIntent({
      amount: decimal("3.00"),
      currency: "eur",
      idempotencyKey: "k6",
    });
    await fake.processPaymentIntent("reader_1", declined.id);
    expect(await fake.retrievePaymentIntent(declined.id)).toMatchObject({
      status: "requires_payment_method",
      amountReceived: 0,
    });
  });

  it("retrievePaymentIntent rejects an unknown id, and unreachableNext rejects the next call only", async () => {
    const fake = new FakeStripe();
    await expect(fake.retrievePaymentIntent("pi_missing")).rejects.toThrow(/No such/);
    fake.setIntent("pi_known", { status: "processing", amount: 500 });
    fake.unreachableNext();
    await expect(fake.retrievePaymentIntent("pi_known")).rejects.toThrow(/unreachable/);
    expect((await fake.retrievePaymentIntent("pi_known")).status).toBe("processing");
  });

  it("setIntent scripts an intent's status and amount received", async () => {
    const fake = new FakeStripe();
    fake.setIntent("pi_s", { status: "succeeded", amount: 1210, amountReceived: 1000 });
    expect(await fake.retrievePaymentIntent("pi_s")).toEqual({
      id: "pi_s",
      status: "succeeded",
      amount: 1210,
      amountReceived: 1000,
    });
  });

  it("cancelPaymentIntent cancels a cancellable intent and records it", async () => {
    const fake = new FakeStripe();
    fake.setIntent("pi_c", { status: "requires_capture", amount: 100 });
    expect(await fake.cancelPaymentIntent("pi_c")).toEqual({ status: "canceled" });
    expect((await fake.retrievePaymentIntent("pi_c")).status).toBe("canceled");
    expect(fake.cancelledIntents).toEqual(["pi_c"]);
  });

  it("cancelPaymentIntent refuses a succeeded, a canceled and an unknown intent", async () => {
    const fake = new FakeStripe();
    fake.setIntent("pi_done", { status: "succeeded", amount: 100, amountReceived: 100 });
    fake.setIntent("pi_gone", { status: "canceled", amount: 100 });
    await expect(fake.cancelPaymentIntent("pi_done")).rejects.toThrow(/status of succeeded/);
    await expect(fake.cancelPaymentIntent("pi_gone")).rejects.toThrow(/status of canceled/);
    await expect(fake.cancelPaymentIntent("pi_missing")).rejects.toThrow(/No such/);
    expect(fake.cancelledIntents).toEqual([]);
  });

  it("cancelRacesNext: the next cancel is refused because the card was charged first", async () => {
    const fake = new FakeStripe();
    fake.setIntent("pi_r", { status: "requires_payment_method", amount: 700 });
    fake.cancelRacesNext();
    await expect(fake.cancelPaymentIntent("pi_r")).rejects.toThrow(/status of succeeded/);
    expect(await fake.retrievePaymentIntent("pi_r")).toMatchObject({
      status: "succeeded",
      amountReceived: 700,
    });
  });
});
