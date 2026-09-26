import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { stripeClient } from "./stripe-client.js";

/** Only the two PaymentIntent calls the abandoned-attempt resolver makes. */
function fakeStripe(calls: string[]): Stripe {
  return {
    paymentIntents: {
      retrieve: (id: string) => {
        calls.push(`retrieve ${id}`);
        return Promise.resolve({
          id,
          status: "succeeded",
          amount: 1210,
          amount_received: 1000,
          currency: "eur",
        });
      },
      cancel: (id: string) => {
        calls.push(`cancel ${id}`);
        return Promise.resolve({ id, status: "canceled" });
      },
    },
  } as unknown as Stripe;
}

describe("stripeClient's PaymentIntent binding", () => {
  it("retrievePaymentIntent maps Stripe's amount_received to amountReceived, in minor units", async () => {
    const calls: string[] = [];
    const client = stripeClient(fakeStripe(calls));
    expect(await client.retrievePaymentIntent("pi_1")).toEqual({
      id: "pi_1",
      status: "succeeded",
      amount: 1210,
      amountReceived: 1000,
    });
    expect(calls).toEqual(["retrieve pi_1"]);
  });

  it("cancelPaymentIntent cancels through the SDK and reports the resulting status", async () => {
    const calls: string[] = [];
    const client = stripeClient(fakeStripe(calls));
    expect(await client.cancelPaymentIntent("pi_2")).toEqual({ status: "canceled" });
    expect(calls).toEqual(["cancel pi_2"]);
  });
});
