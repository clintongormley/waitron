import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { stripeDeviceClient } from "./stripe-device-client.js";

// Nightly-only (.github/workflows/stripe-sandbox.yml). The on-device collect runs inside the device
// SDK and has no headless analogue, so only connection-token creation is exercised here — which
// leaves the device's idempotency key with no real-API test (device-provider.test.ts covers its
// derivation against FakeStripeDevice).
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
