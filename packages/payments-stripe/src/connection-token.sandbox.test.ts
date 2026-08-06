import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { stripeDeviceClient } from "./stripe-device-client.js";

// Nightly-only server-side sandbox for the on-device adapter (.github/workflows/stripe-sandbox.yml).
// The device-side collect / offline queue have no headless analogue (they run in the device SDK) and
// are proven by FakeStripeDevice, so this suite exercises only the server-side call the device fetches:
// connection-token creation. Self-skips without STRIPE_SECRET_KEY, like collect.sandbox.test.ts.
//
// NOTE (§4 capture idempotency): the on-device provider now derives its PaymentIntent-creation
// idempotency key from the working order too (device-provider.ts), but there is deliberately NO
// real-API test of it here — `collectOnDevice` runs INSIDE the device SDK and has no headless
// server-side analogue to drive, so the key-honouring cannot be exercised against Stripe test mode
// the way the server-driven reader's is (collect.sandbox.test.ts). That derivation is proven
// hermetically by FakeStripeDevice's recorder (device-provider.test.ts). The 2a reader is the only
// mode whose PaymentIntent create is a plain server-side call, hence the only mode with a real-API
// idempotency test.
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
