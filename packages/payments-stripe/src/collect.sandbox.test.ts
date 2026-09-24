import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  decimal,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { PAYMENTS_MIGRATIONS, getPaymentByRef } from "@waitron/payments";
import { stripeClient } from "./stripe-client.js";
import { StripeTerminalProvider } from "./provider.js";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";

// Nightly-only (.github/workflows/stripe-sandbox.yml): a real Stripe test-mode PaymentIntent
// through a simulated Terminal reader.
const KEY = process.env.STRIPE_SECRET_KEY;
const d = KEY ? describe : describe.skip;

d("Stripe test-mode sandbox: collect against a simulated reader", () => {
  const pg = useVenueDb({
    migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS],
    timeoutMs: 120_000,
  });

  let stripe: Stripe;
  let readerId: string;
  let locationId: string;

  beforeAll(async () => {
    stripe = new Stripe(KEY!);
    const location = await stripe.terminal.locations.create({
      display_name: "Waitron CI",
      // Stripe requires `state` for an ES Location ("Missing required address field for a Location
      // in ES: address[state]"). It is the province, so for a Madrid address it repeats the city.
      address: {
        line1: "1 Test St",
        city: "Madrid",
        state: "Madrid",
        country: "ES",
        postal_code: "28001",
      },
    });
    locationId = location.id;
    // A Stripe-hosted simulated reader: no physical hardware.
    const reader = await stripe.terminal.readers.create({
      registration_code: "simulated-wpe",
      location: location.id,
    });
    readerId = reader.id;
  }, 120_000);

  afterAll(async () => {
    // The reader goes first: Stripe won't delete a location that still has readers registered to it.
    if (readerId) {
      await stripe.terminal.readers.del(readerId).catch(() => {});
    }
    if (locationId) {
      await stripe.terminal.locations.del(locationId).catch(() => {});
    }
  });

  it("drives a real test-mode PaymentIntent to captured", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
    const provider = new StripeTerminalProvider({
      client: stripeClient(stripe),
      db: pg.db,
      nodeId: "11111111-1111-4111-8111-111111111111",
      poll: { maxAttempts: 40, intervalMs: 500 },
    });
    // The reader needs the PaymentIntent handed to `processPaymentIntent` before
    // `presentPaymentMethod` has anything to resolve, hence the delay before presenting.
    const collecting = provider.collect({
      tillId: brandTillId(s.tillId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
      readerRef: readerId,
    });
    await new Promise((r) => setTimeout(r, 1500));
    await stripe.testHelpers.terminal.readers.presentPaymentMethod(readerId);
    const result = await collecting;
    expect(result.state).toBe("captured");
    expect(result.settledAt).not.toBeNull();
  });

  it("re-creating the PaymentIntent for the same working order reuses ONE PaymentIntent (real Stripe idempotency → charged once)", async () => {
    // `FakeStripe` mints a fresh `pi_` per call, so only real Stripe can show the key replays the
    // SAME PaymentIntent. The replay is a raw `createPaymentIntent`, not a second collect, because
    // after the first capture the PaymentIntent has already succeeded.
    const s = await seedWorkingOrder(pg.db, freshNif());
    const client = stripeClient(stripe);
    const provider = new StripeTerminalProvider({
      client,
      db: pg.db,
      nodeId: "11111111-1111-4111-8111-111111111111",
      poll: { maxAttempts: 40, intervalMs: 500 },
    });
    const collecting = provider.collect({
      tillId: brandTillId(s.tillId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
      readerRef: readerId,
    });
    await new Promise((r) => setTimeout(r, 1500));
    await stripe.testHelpers.terminal.readers.presentPaymentMethod(readerId);
    const first = await collecting;
    expect(first.state).toBe("captured");
    const row = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, {
        provider: "stripe",
        paymentRef: first.paymentRef,
      }),
    );
    expect(row?.externalRef).toMatch(/^pi_/);

    const replay = await client.createPaymentIntent({
      amount: decimal("12.10"),
      currency: "eur",
      idempotencyKey: `wo_${s.workingOrderId}`,
    });
    expect(replay.id).toBe(row?.externalRef);
  });
});
