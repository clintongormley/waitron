import type Stripe from "stripe";
import { toMinorUnits } from "./client.js";
import type { StripeDeviceClient } from "./device-client.js";

/** The real `StripeDeviceClient`, wrapping the `stripe` SDK's on-device / Tap-to-Pay Terminal API.
 * Coverage-excluded (see vitest.config.ts): a thin call-mapping boundary. Only its SERVER-side calls
 * (`createConnectionToken`, `refund`) have a headless analogue and are exercised by the nightly
 * sandbox; the device-side `collectOnDevice`/`syncOfflineQueue` run inside the device SDK on the
 * handheld (bridged in by the device app — SP7/SP9 deployment work), so here they throw. The hermetic
 * suite proves the provider's own logic through `FakeStripeDevice`, never this file. */
export function stripeDeviceClient(stripe: Stripe): StripeDeviceClient {
  return {
    async createConnectionToken() {
      const token = await stripe.terminal.connectionTokens.create();
      return { secret: token.secret };
    },
    collectOnDevice() {
      throw new Error("on-device collect runs in the device SDK, not the server wrapper (SP7/SP9)");
    },
    syncOfflineQueue() {
      throw new Error(
        "offline-queue sync runs in the device SDK, not the server wrapper (SP7/SP9)",
      );
    },
    async refund({ paymentIntentId, amount, idempotencyKey }) {
      const refund = await stripe.refunds.create(
        { payment_intent: paymentIntentId, ...(amount ? { amount: toMinorUnits(amount) } : {}) },
        { idempotencyKey },
      );
      const status =
        refund.status === "succeeded" || refund.status === "pending" ? refund.status : "failed";
      return { id: refund.id, status };
    },
  };
}
