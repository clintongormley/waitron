import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { stripeDeviceClient } from "./stripe-device-client.js";

// Nightly-only server-side sandbox for the on-device adapter (.github/workflows/stripe-sandbox.yml).
// The device-side collect / offline queue have no headless analogue (they run in the device SDK) and
// are proven by FakeStripeDevice, so this suite exercises only the server-side call the device fetches:
// connection-token creation. Self-skips without STRIPE_SECRET_KEY, like collect.sandbox.test.ts.
const KEY = process.env.STRIPE_SECRET_KEY;
const d = KEY ? describe : describe.skip;

d("Stripe test-mode sandbox: on-device server-side calls", () => {
  it("creates a connection token", async () => {
    const client = stripeDeviceClient(new Stripe(KEY!));
    const token = await client.createConnectionToken();
    expect(typeof token.secret).toBe("string");
    expect(token.secret.length).toBeGreaterThan(0);
  });
});
