import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTaxpayer } from "@waitron/db/testing/seed.js";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { createStripeCardProvider } from "./card-provider.js";

// Nightly-only (.github/workflows/stripe-sandbox.yml): real test-mode Stripe answering reader ids
// this key's account does not hold.
const KEY = process.env.STRIPE_SECRET_KEY;
const d = KEY ? describe : describe.skip;

const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const ALPHANUMERIC = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const unheldId = `tmr_${Array.from(randomBytes(24), (b) => ALPHANUMERIC[b % ALPHANUMERIC.length]).join("")}`;

d("Stripe test-mode sandbox: adding a reader by an id this account does not hold", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 120_000 });

  // The answers test-mode Stripe gave on 2026-11-22 (GitHub run 45001837367).
  it.each([
    ["a well-formed id this account does not hold", unheldId, 404, "resource_missing"],
    ["an id without the tmr_ prefix", "not-a-reader", 400, undefined],
    ["the empty string", "", 404, undefined],
  ])("refuses %s as reader.reference_unknown", async (_label, reference, statusCode, code) => {
    const stripeError = await new Stripe(KEY!).terminal.readers
      .retrieve(reference)
      .catch((e: unknown) => e);
    expect(stripeError).toBeInstanceOf(Stripe.errors.StripeInvalidRequestError);
    expect(stripeError).toMatchObject({ statusCode, code });

    await seedTaxpayer(suite.db);
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, ring, {
        personId: null,
        purpose: "payments.stripe",
        value: {
          secretKey: KEY!,
          webhookSecret: "whsec_unused_here",
          successUrl: "https://example.test/ok",
          cancelUrl: "https://example.test/no",
        },
      }),
    );
    const seat = createStripeCardProvider();

    await expect(
      seat.readers.add({ db: suite.db, ring }, { name: "Counter", reference }),
    ).rejects.toMatchObject({
      code: "reader.reference_unknown",
      params: { providerId: "stripe", field: "reference" },
    });
  });
});
