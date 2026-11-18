import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { decimal } from "@waitron/shared";
import { stripeHostedClient } from "./stripe-hosted-client.js";

const secret = "whsec_local";
const payload = JSON.stringify({
  id: "evt_checkout",
  object: "event",
  type: "checkout.session.completed",
  created: 1792180800,
  data: { object: { id: "cs_paid", object: "checkout.session", amount_total: 1210 } },
});
const sdk = new Stripe("sk_test_local");
const client = stripeHostedClient(sdk, {
  successUrl: "https://example.test/success",
  cancelUrl: "https://example.test/cancel",
  webhookSecret: secret,
});

describe("hosted Stripe webhooks through the installed SDK", () => {
  it("maps a freshly signed event without changing the amount or event time", () => {
    const header = sdk.webhooks.generateTestHeaderString({ payload, secret });
    expect(client.constructWebhookEvent(payload, header)).toEqual({
      type: "checkout.session.completed",
      sessionId: "cs_paid",
      amountTotalMinor: 1210,
      createdAt: new Date("2026-10-16T20:00:00Z"),
    });
  });

  it("refuses an old signature even when it was signed with the correct secret", () => {
    const header = sdk.webhooks.generateTestHeaderString({
      payload,
      secret,
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    });
    expect(() => client.constructWebhookEvent(payload, header)).toThrow(
      Stripe.errors.StripeSignatureVerificationError,
    );
  });

  it("refuses a freshly signed payload changed after signing", () => {
    const header = sdk.webhooks.generateTestHeaderString({ payload, secret });
    expect(() => client.constructWebhookEvent(payload.replace("1210", "9999"), header)).toThrow(
      Stripe.errors.StripeSignatureVerificationError,
    );
  });
});

describe("hosted Stripe checkout sessions", () => {
  function sessionsStripe(calls: unknown[], url: string | null): Stripe {
    return {
      checkout: {
        sessions: {
          create: (...args: unknown[]) => {
            calls.push(args);
            return Promise.resolve({ id: "cs_new", url });
          },
        },
      },
    } as unknown as Stripe;
  }
  const metadata = { working_order_id: "wo_1", payment_ref: "ref_1" };
  const params = { amount: decimal("12.10"), currency: "eur", idempotencyKey: "k_cs", metadata };
  const config = {
    successUrl: "https://s.test",
    cancelUrl: "https://c.test",
    webhookSecret: secret,
  };

  it("stamps the metadata on the session and its payment, and sends the amount in minor units", async () => {
    const calls: unknown[] = [];
    const hosted = stripeHostedClient(sessionsStripe(calls, "https://pay.test/cs_new"), config);

    expect(await hosted.createCheckoutSession(params)).toEqual({
      id: "cs_new",
      url: "https://pay.test/cs_new",
    });
    expect(calls).toEqual([
      [
        {
          mode: "payment",
          metadata,
          payment_intent_data: { metadata },
          success_url: "https://s.test",
          cancel_url: "https://c.test",
          line_items: [
            {
              quantity: 1,
              price_data: { currency: "eur", unit_amount: 1210, product_data: { name: "Order" } },
            },
          ],
        },
        { idempotencyKey: "k_cs" },
      ],
    ]);
  });

  it("refuses a session Stripe answers without a payment page", async () => {
    const hosted = stripeHostedClient(sessionsStripe([], null), config);
    await expect(hosted.createCheckoutSession(params)).rejects.toThrow(
      "stripe: checkout session has no url",
    );
  });
});
