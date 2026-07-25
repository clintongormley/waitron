import type Stripe from "stripe";
import type { Decimal } from "@waitron/shared";
import { toMinorUnits } from "./client.js";
import type { DeviceCollectOutcome, StripeDeviceClient } from "./device-client.js";

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
    // The parameter is named and typed even though this stub only throws: an implementation that
    // elided it would still satisfy the interface structurally, which is precisely how the device
    // bridge could come to miss the `metadata` forwarding below. Spelling the shape out here keeps
    // the obligation visible at the site someone will actually replace.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see comment above
    collectOnDevice(_params: {
      amount: Decimal;
      currency: string;
      idempotencyKey: string;
      offlineAllowed: boolean;
      metadata: { working_order_id: string; payment_ref: string };
    }): Promise<{ outcome: DeviceCollectOutcome; externalRef?: string }> {
      // When the device app's bridge implements this against the on-device SDK it MUST forward the
      // caller's `metadata` onto the PaymentIntent it creates. That stamp is the only way reconcile
      // can ever attribute a settlement whose local row was never written — this provider collects
      // before it writes. See `device-client.ts`'s `collectOnDevice` doc.
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
