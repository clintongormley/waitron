import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  decimal,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { stripeClient } from "./stripe-client.js";
import { StripeTerminalProvider } from "./provider.js";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";

// Nightly-only suite (.github/workflows/stripe-sandbox.yml) that drives a REAL Stripe test-mode
// PaymentIntent through a REAL (simulated) Terminal reader — the one place this package's coverage
// touches the actual `stripe` SDK boundary rather than `FakeStripe`. `stripe-client.ts` is coverage-
// excluded from the hermetic run precisely because this suite is its only exerciser (see
// vitest.config.ts). It self-skips with no `STRIPE_SECRET_KEY`, which is deliberate here — not the
// RLS suites' "never skip" rule, since the hermetic suite already proves collect's logic; this suite
// adds real-API fidelity on a cadence, not correctness the PR gate depends on.
const KEY = process.env.STRIPE_SECRET_KEY;
const d = KEY ? describe : describe.skip; // nightly only — deliberate skip when unconfigured

d("Stripe test-mode sandbox: collect against a simulated reader", () => {
  let db: Database;
  let stripe: Stripe;
  let readerId: string;
  let locationId: string;

  beforeAll(async () => {
    db = await createPgliteDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, PAYMENTS_MIGRATIONS);
    stripe = new Stripe(KEY!);
    const location = await stripe.terminal.locations.create({
      display_name: "Waitron CI",
      // `state` is REQUIRED for an ES Location — Stripe began rejecting the address without it
      // ("Missing required address field for a Location in ES: address[state]") between the
      // 2026-07-24 and 2026-07-25 nightlies, with no change on our side. It is the province, so
      // for a Madrid address it repeats the city. Do not drop it as redundant.
      address: {
        line1: "1 Test St",
        city: "Madrid",
        state: "Madrid",
        country: "ES",
        postal_code: "28001",
      },
    });
    locationId = location.id;
    // `registration_code: "simulated-wpe"` registers a Stripe-hosted SIMULATED reader (the WisePOS E
    // simulator) — no physical hardware involved, safe to run unattended on a nightly cron.
    const reader = await stripe.terminal.readers.create({
      registration_code: "simulated-wpe",
      location: location.id,
    });
    readerId = reader.id;
  }, 120_000);

  afterAll(async () => {
    // Best-effort sandbox cleanup — this suite runs nightly and would otherwise accumulate a
    // simulated reader + location in the Stripe test-mode account on every run. Each delete is
    // wrapped so a cleanup failure (e.g. Stripe API hiccup) never fails the suite itself; the
    // reader is deleted before the location since Stripe won't delete a location that still has
    // readers registered to it.
    if (readerId) {
      await stripe.terminal.readers.del(readerId).catch(() => {});
    }
    if (locationId) {
      await stripe.terminal.locations.del(locationId).catch(() => {});
    }
    await db.close();
  });

  it("drives a real test-mode PaymentIntent to captured", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    const provider = new StripeTerminalProvider({
      client: stripeClient(stripe),
      db,
      tenantId: brandTenantId(s.tenantId),
      resolveReader: () => Promise.resolve(readerId),
      poll: { maxAttempts: 40, intervalMs: 500 },
    });
    // Kick collect, then present a test card on the simulated reader so the action resolves — a
    // real reader needs the PaymentIntent to exist and be handed to `processPaymentIntent` before
    // `presentPaymentMethod` has anything to resolve, hence the short delay before presenting.
    const collecting = provider.collect({
      tenantId: brandTenantId(s.tenantId),
      tillId: brandTillId(s.tillId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
    });
    await new Promise((r) => setTimeout(r, 1500));
    await stripe.testHelpers.terminal.readers.presentPaymentMethod(readerId);
    const result = await collecting;
    expect(result.state).toBe("captured");
    expect(result.settledAt).not.toBeNull();
  });
});
