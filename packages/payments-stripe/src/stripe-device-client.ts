import type Stripe from "stripe";
import type { Decimal } from "@waitron/shared";
import { toMinorUnits } from "./client.js";
import type { DeviceCollectOutcome, StripeDeviceClient } from "./device-client.js";

/** The device-side calls run inside the device SDK on the handheld, so here they throw. */
export function stripeDeviceClient(stripe: Stripe): StripeDeviceClient {
  return {
    async createConnectionToken() {
      const token = await stripe.terminal.connectionTokens.create();
      return { secret: token.secret };
    },
    // Typed in full so whoever replaces this stub sees the `metadata` it must forward.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see comment above
    collectOnDevice(_params: {
      amount: Decimal;
      currency: string;
      idempotencyKey: string;
      offlineAllowed: boolean;
      metadata: { working_order_id: string; payment_ref: string };
    }): Promise<{ outcome: DeviceCollectOutcome; externalRef?: string }> {
      // A real implementation MUST forward `metadata` onto the PaymentIntent it creates.
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
