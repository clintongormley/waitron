import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import { randomUUID } from "node:crypto";
import { PAYMENTS_MIGRATIONS, getPaymentByRef } from "@waitron/payments";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { stripeHostedClient } from "./stripe-hosted-client.js";
import { StripeHostedProvider } from "./hosted-provider.js";

// Nightly-only (.github/workflows/stripe-sandbox.yml): a real Stripe test-mode Checkout Session.
const KEY = process.env.STRIPE_SECRET_KEY;
const d = KEY ? describe : describe.skip;

d("Stripe test-mode sandbox: hosted Checkout Session", () => {
  const pg = useVenueDb({
    migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS],
    timeoutMs: 120_000,
  });

  it("creates a real test-mode Checkout Session and writes an initiated row", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
    const provider = new StripeHostedProvider({
      client: stripeHostedClient(new Stripe(KEY!), {
        successUrl: "https://example.test/ok",
        cancelUrl: "https://example.test/cancel",
        webhookSecret: "whsec_unused_here",
      }),
      db: pg.db,
    });
    const paymentRef = randomUUID();

    const res = await provider.initiate({
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
      paymentRef,
    });

    expect(res.externalRef).toMatch(/^cs_/);
    expect(res.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    const row = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, { provider: "stripe", paymentRef }),
    );
    expect(row?.state).toBe("initiated");
    expect(row?.externalRef).toBe(res.externalRef);
  });
});
