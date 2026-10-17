import { describe, expect, it } from "vitest";
import Stripe from "stripe";
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
