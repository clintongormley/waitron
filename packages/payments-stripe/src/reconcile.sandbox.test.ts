import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { stripeReportClient } from "./stripe-report-client.js";

// Nightly-only (.github/workflows/stripe-sandbox.yml). Not covered here: that a genuinely SETTLED
// charge maps to the right amounts and references, which needs a completed card payment a headless
// test cannot drive. Only report-source.test.ts covers that, against FakeStripeReport.
const KEY = process.env.STRIPE_SECRET_KEY;
const d = KEY ? describe : describe.skip;

d("Stripe test-mode sandbox: reconcile report client", () => {
  it("reads back a real Checkout Session created with metadata, surfacing it as the hint", async () => {
    const stripe = new Stripe(KEY!);
    const workingOrderId = randomUUID();
    const paymentRef = randomUUID();

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: "https://example.test/ok",
      cancel_url: "https://example.test/cancel",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: 1210,
            product_data: { name: "Order" },
          },
        },
      ],
      // The keys `stripe-report-client.ts` reads back to build the `hint`.
      metadata: { working_order_id: workingOrderId, payment_ref: paymentRef },
    });

    // Tolerates clock skew between this process and Stripe; not a real reconcile window.
    const now = Date.now();
    const window = { from: new Date(now - 5 * 60_000), to: new Date(now + 5 * 60_000) };

    const sessions = await stripeReportClient(stripe).listCheckoutSessions(window);
    const found = sessions.find((s) => s.sessionId === session.id);

    expect(found).toBeDefined();
    expect(found?.hint).toEqual({ workingOrderId, paymentRef });
  });

  it("returns null for a session nobody paid — an abandoned checkout, not an error", async () => {
    const stripe = new Stripe(KEY!);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: "https://example.test/ok",
      cancel_url: "https://example.test/cancel",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: 1210,
            product_data: { name: "Order" },
          },
        },
      ],
    });

    const paymentIntentId = await stripeReportClient(stripe).paymentIntentForSession(session.id);

    expect(paymentIntentId).toBeNull();
  });

  it("issues a well-formed balance-transaction query — the only proof the expand/filter shape is right", async () => {
    // Asserts only that Stripe accepts the request; an account with no settled charges is valid.
    // Weaker than it looks: a DROPPED `expand` is still an accepted request, and the mapping then
    // drops every record and returns `[]`, which this cannot tell from a quiet day.
    const now = Date.now();
    const window = { from: new Date(now - 30 * 24 * 60 * 60_000), to: new Date(now + 5 * 60_000) };

    const settlements = await stripeReportClient(new Stripe(KEY!)).listSettlements(window);

    expect(Array.isArray(settlements)).toBe(true);
  });
});
