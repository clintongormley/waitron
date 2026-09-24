import type { Decimal } from "@waitron/shared";

/** `accepted_offline` is possible only when `offlineAllowed`; `network_unavailable` means offline
 * while offline was NOT allowed, so nothing was stored. */
export type DeviceCollectOutcome =
  "captured" | "accepted_offline" | "declined" | "network_unavailable";

export interface StripeDeviceClient {
  createConnectionToken(): Promise<{ secret: string }>;
  /** `externalRef` is the PaymentIntent id on `captured`/`accepted_offline`. */
  collectOnDevice(params: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
    offlineAllowed: boolean;
    /** Must be stamped onto the PaymentIntent: it is the only way reconcile can attribute a
     * settlement whose local row was never written. See `StripeOnDeviceProvider`. */
    metadata: { working_order_id: string; payment_ref: string };
  }): Promise<{ outcome: DeviceCollectOutcome; externalRef?: string }>;
  /** Refs still pending on the device appear in neither list. */
  syncOfflineQueue(refs: string[]): Promise<{ settled: string[]; declined: string[] }>;
  refund(params: {
    paymentIntentId: string;
    amount?: Decimal;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "succeeded" | "pending" | "failed" }>;
}
