import type { Decimal } from "@waitron/shared";

export type DeviceCollectOutcome = "captured" | "declined" | "network_unavailable";

export interface StripeDeviceClient {
  createConnectionToken(): Promise<{ secret: string }>;
  /** `externalRef` is the PaymentIntent id on `captured`. */
  collectOnDevice(params: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
    /** Must be stamped onto the PaymentIntent: it is the only way reconcile can attribute a
     * settlement whose local row was never written. See `StripeOnDeviceProvider`. */
    metadata: { working_order_id: string; payment_ref: string };
  }): Promise<{ outcome: DeviceCollectOutcome; externalRef?: string }>;
  refund(params: {
    paymentIntentId: string;
    amount?: Decimal;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "succeeded" | "pending" | "failed" }>;
}
