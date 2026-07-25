import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { stripeReportClient } from "./stripe-report-client.js";

// Nightly-only suite (.github/workflows/stripe-sandbox.yml) for the reconcile sweep's REAL Stripe
// binding — the one place this package's coverage touches the actual balance-transaction /
// Checkout-session SDK boundary rather than FakeStripeReport. `stripe-report-client.ts` is
// coverage-excluded (see vitest.config.ts) precisely because this suite is its only exerciser.
// Self-skips with no STRIPE_SECRET_KEY, like its three siblings (checkout/collect/connection-token
// .sandbox.test.ts) — real-API fidelity on a cadence, not correctness the PR gate depends on; the
// hermetic run (report-source.test.ts against FakeStripeReport) already proves the mapping logic.
//
// What this suite can prove headlessly, against a real test-mode account:
//   1. `listCheckoutSessions` reads back a session created with metadata and surfaces those
//      identifiers as the `hint` — the attribution bridge the sweep needs: without it, a
//      settlement with no local row can only ever be *reported*, never raised as an incident
//      against a till.
//   2. `paymentIntentForSession` returns `null` for a session nobody paid. That is not a corner
//      case we're inventing — Stripe does not create a PaymentIntent for a `mode: "payment"`
//      Checkout Session until the customer completes it, so "abandoned checkout" is a real,
//      reachable state, and it's the exact input the sweep's orphan remediation must handle
//      without crashing.
//   3. `listSettlements` issues a WELL-FORMED request against the real API. It is the only new
//      money-READING call this slice added, and its failure mode is silent: if the
//      `expand: ["data.source"]` were ever wrong or dropped, `bt.source` would come back as a bare
//      string id, `charge.id` would be `undefined`, and the mapping's guard would drop every single
//      record — `listSettlements` returns `[]`, the sweep reports every local payment as `unsettled`
//      past tolerance and every real settlement as invisible, indistinguishable from a quiet day.
//      Stripe rejects a malformed `expand`/`type`/`created` shape with a `StripeInvalidRequestError`,
//      so simply resolving to an array proves the one thing this binding can get wrong that nothing
//      else in the repo would catch before production.
//
// What this suite deliberately does NOT prove: `listSettlements` end-to-end, i.e. that a genuinely
// SETTLED charge maps to the right amounts and references. That needs a completed card payment —
// something a headless test cannot drive. Faking one (a mocked charge) or forcing one (a Stripe
// test-clock) would either defeat the point of a *real*-account suite or reach past what this task
// was scoped to do. That half of the mapping stays proven only by report-source.test.ts against
// FakeStripeReport; this is an honest, documented gap, not a skipped assertion dressed up as one.
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
      // snake_case: these are the exact keys `stripe-report-client.ts` reads back off
      // `session.metadata` to build the `hint`.
      metadata: { working_order_id: workingOrderId, payment_ref: paymentRef },
    });

    // A few minutes either side of "now" — tolerant of clock skew between this process and
    // Stripe, not a real reconcile window.
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
    // A WIDE window (30 days back), because this asserts the REQUEST is accepted, not that any
    // particular charge is in it: a test-mode account with no settled charges is a perfectly valid
    // state here and must not fail the suite.
    //
    // The assertion looks weak and is not. `listSettlements` cannot fail loudly on its own: every
    // malformed-response path in the mapping DROPS the record, so a broken `expand: ["data.source"]`
    // — the one thing this thin binding actually gets wrong — yields `[]`, which reads exactly like a
    // quiet day and stays invisible until production reconciles real money. What Stripe DOES reject
    // loudly is a malformed request: a bad `expand` path, an unknown `type`, or a `created` filter
    // given milliseconds instead of seconds all raise `StripeInvalidRequestError` out of the paging
    // call. Resolving to an array is therefore the exact, and only, headless proof available that
    // this call is addressed correctly at the real API.
    const now = Date.now();
    const window = { from: new Date(now - 30 * 24 * 60 * 60_000), to: new Date(now + 5 * 60_000) };

    const settlements = await stripeReportClient(new Stripe(KEY!)).listSettlements(window);

    expect(Array.isArray(settlements)).toBe(true);
  });
});
