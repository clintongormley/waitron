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
});
