import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { decimal } from "@waitron/shared";
import { stripeDeviceClient } from "./stripe-device-client.js";

/** Only the Terminal connection-token and refund calls the device wrapper makes. */
function fakeStripe(
  calls: { params: unknown; options: unknown }[],
  refundStatus: string | null = "succeeded",
): Stripe {
  return {
    terminal: {
      connectionTokens: { create: () => Promise.resolve({ secret: "pst_test_secret" }) },
    },
    refunds: {
      create: (params: unknown, options: unknown) => {
        calls.push({ params, options });
        return Promise.resolve({ id: "re_1", status: refundStatus });
      },
    },
  } as unknown as Stripe;
}

describe("stripeDeviceClient", () => {
  it("createConnectionToken answers the token's secret", async () => {
    expect(await stripeDeviceClient(fakeStripe([])).createConnectionToken()).toEqual({
      secret: "pst_test_secret",
    });
  });

  it("collectOnDevice refuses: collection runs in the device SDK", async () => {
    await expect(
      Promise.resolve().then(() =>
        stripeDeviceClient(fakeStripe([])).collectOnDevice({
          amount: decimal("10.00"),
          currency: "eur",
          idempotencyKey: "idem-collect",
          metadata: { working_order_id: "wo_1", payment_ref: "ref_1" },
        }),
      ),
    ).rejects.toThrow("on-device collect runs in the device SDK");
  });

  it("refund sends the payment intent, the amount in cents and the idempotency key", async () => {
    const calls: { params: unknown; options: unknown }[] = [];
    const result = await stripeDeviceClient(fakeStripe(calls)).refund({
      paymentIntentId: "pi_1",
      amount: decimal("12.34"),
      idempotencyKey: "idem-refund",
    });
    expect(result).toEqual({ id: "re_1", status: "succeeded" });
    expect(calls).toEqual([
      {
        params: { payment_intent: "pi_1", amount: 1234 },
        options: { idempotencyKey: "idem-refund" },
      },
    ]);
  });

  it("refund without an amount leaves Stripe to refund the whole payment", async () => {
    const calls: { params: unknown; options: unknown }[] = [];
    await stripeDeviceClient(fakeStripe(calls)).refund({
      paymentIntentId: "pi_2",
      idempotencyKey: "idem-full",
    });
    expect(calls).toStrictEqual([
      { params: { payment_intent: "pi_2" }, options: { idempotencyKey: "idem-full" } },
    ]);
  });

  it.each([
    ["succeeded", "succeeded"],
    ["pending", "pending"],
    ["requires_action", "failed"],
    ["canceled", "failed"],
    ["failed", "failed"],
    [null, "failed"],
  ])("refund reports Stripe's %s as %s", async (stripeStatus, expected) => {
    const result = await stripeDeviceClient(fakeStripe([], stripeStatus)).refund({
      paymentIntentId: "pi_3",
      idempotencyKey: "idem-status",
    });
    expect(result.status).toBe(expected);
  });
});
