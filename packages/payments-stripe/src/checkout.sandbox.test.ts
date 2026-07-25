import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  decimal,
  tenantId as brandTenantId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { randomUUID } from "node:crypto";
import { PAYMENTS_MIGRATIONS, getPaymentByRef } from "@waitron/payments";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { stripeHostedClient } from "./stripe-hosted-client.js";
import { StripeHostedProvider } from "./hosted-provider.js";

// Nightly-only suite (.github/workflows/stripe-sandbox.yml). Creates a REAL Stripe test-mode Checkout
// Session — the one place this package's coverage touches the actual Checkout SDK boundary rather than
// FakeStripeHosted. `stripe-hosted-client.ts` is coverage-excluded precisely because this suite is its
// only exerciser. Self-skips with no STRIPE_SECRET_KEY (deliberate — real-API fidelity on a cadence,
// not correctness the PR gate depends on; the hermetic run already proves the provider's logic).
const KEY = process.env.STRIPE_SECRET_KEY;
const d = KEY ? describe : describe.skip;

d("Stripe test-mode sandbox: hosted Checkout Session", () => {
  let db: Database;

  beforeAll(async () => {
    db = await createPgliteDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, PAYMENTS_MIGRATIONS);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("creates a real test-mode Checkout Session and writes an initiated row", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    const provider = new StripeHostedProvider({
      client: stripeHostedClient(new Stripe(KEY!), {
        successUrl: "https://example.test/ok",
        cancelUrl: "https://example.test/cancel",
        webhookSecret: "whsec_unused_here",
      }),
      db,
    });
    const paymentRef = randomUUID();

    const res = await provider.initiate({
      tenantId: brandTenantId(s.tenantId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
      paymentRef,
    });

    expect(res.externalRef).toMatch(/^cs_/);
    expect(res.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    const row = await db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "stripe", paymentRef }),
    );
    expect(row?.state).toBe("initiated");
    expect(row?.externalRef).toBe(res.externalRef);
  });
});
