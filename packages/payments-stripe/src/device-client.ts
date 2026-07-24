import type { Decimal } from "@waitron/shared";

/** Outcome of a device-side collect. `captured` = online single-message capture; `accepted_offline`
 * = the device stored-and-forwarded it while offline (only possible when `offlineAllowed`); `declined`
 * = the card was refused; `network_unavailable` = offline while offline was NOT allowed, so nothing was
 * stored. */
export type DeviceCollectOutcome =
  "captured" | "accepted_offline" | "declined" | "network_unavailable";

/** The narrow on-device Stripe surface `StripeOnDeviceProvider` depends on — the device SDK operations
 * it needs, not the SDK. The real impl (`./stripe-device-client.ts`) wraps the on-device / Tap-to-Pay
 * bindings and is coverage-excluded; `FakeStripeDevice` (`./testing/`) models it deterministically.
 * Amounts cross as exact `Decimal`. Separate from `StripeClient` (the server-driven 2a seam): each
 * provider names only the calls it uses. */
export interface StripeDeviceClient {
  /** Mint a connection token the on-device SDK needs to initialise (`stripe.terminal.connectionTokens
   * .create`). A server-side call — the one device-init operation with a headless analogue, so the one
   * thing the nightly sandbox exercises. */
  createConnectionToken(): Promise<{ secret: string }>;
  /** Collect on the built-in reader. `offlineAllowed` (computed by the neutral gate) configures the
   * device's offline behaviour: only when true may the SDK store-and-forward. Returns the resolved
   * outcome; `externalRef` is the PaymentIntent id on `captured`/`accepted_offline`. */
  collectOnDevice(params: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
    offlineAllowed: boolean;
  }): Promise<{ outcome: DeviceCollectOutcome; externalRef?: string }>;
  /** Reconcile our pending offline refs against the device-local offline queue: which the device has
   * now forwarded to the network (`settled`) vs. had refused (`declined`). Refs still pending on the
   * device appear in neither list. */
  syncOfflineQueue(refs: string[]): Promise<{ settled: string[]; declined: string[] }>;
  /** Reverse a captured payment (void = full refund with no amount; refund/partialRefund with amount)
   * — a server-side `stripe.refunds.create`, same shape as the 2a `StripeClient.refund`. */
  refund(params: {
    paymentIntentId: string;
    amount?: Decimal;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "succeeded" | "pending" | "failed" }>;
}
