import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { FakeStripeDevice } from "./fake-stripe-device.js";

const params = () => ({
  amount: decimal("10.00"),
  currency: "eur",
  idempotencyKey: "k1",
  metadata: { working_order_id: "wo-1", payment_ref: "k1" },
});

describe("FakeStripeDevice", () => {
  it("defaults to the online scenario → captured with a pi_ externalRef, recording the params", async () => {
    const f = new FakeStripeDevice();
    const r = await f.collectOnDevice(params());
    expect(r.outcome).toBe("captured");
    expect(r.externalRef).toMatch(/^pi_/);
    // `lastCollect` is what lets a provider test assert the PaymentIntent metadata stamp.
    expect(f.lastCollect?.metadata).toEqual({ working_order_id: "wo-1", payment_ref: "k1" });
  });

  it("offline scenario yields network_unavailable", async () => {
    const f = new FakeStripeDevice();
    f.nextCollect("offline");
    const refused = await f.collectOnDevice(params());
    expect(refused.outcome).toBe("network_unavailable");
    expect(refused.externalRef).toBeUndefined();
  });

  it("declined scenario yields declined; scenario resets to online after one use", async () => {
    const f = new FakeStripeDevice();
    f.nextCollect("declined");
    expect((await f.collectOnDevice(params())).outcome).toBe("declined");
    expect((await f.collectOnDevice(params())).outcome).toBe("captured");
  });

  it("refundFailsNext fails one refund then succeeds", async () => {
    const f = new FakeStripeDevice();
    f.refundFailsNext();
    expect((await f.refund({ paymentIntentId: "pi_1", idempotencyKey: "r1" })).status).toBe(
      "failed",
    );
    expect((await f.refund({ paymentIntentId: "pi_1", idempotencyKey: "r2" })).status).toBe(
      "succeeded",
    );
  });

  it("createConnectionToken returns a secret", async () => {
    expect((await new FakeStripeDevice().createConnectionToken()).secret).toMatch(/^pst_/);
  });
});
