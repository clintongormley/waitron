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
    /** Our own identifiers, stamped onto the PaymentIntent the device creates — the SAME keys, in the
     * same Stripe-side snake_case, that the hosted create stamps onto its Checkout Session, so one
     * read path in the reconciliation audit can eventually serve both.
     *
     * It exists for the same reason it does there: this provider collects on the reader FIRST and
     * writes its `payments` row afterwards, so a crash in between leaves a captured charge with no
     * local row at all — reconcile's `missingLocal`, the class the audit exists to catch. Without
     * these identifiers such a settlement can be reported but never attributed to a till, so nobody
     * is told about it.
     *
     * The stamp is done NOW even though the audit cannot read it back yet: PaymentIntent metadata does
     * not propagate to the charge, so the settlement report would need an
     * `expand: ["data.source.payment_intent"]` level on its main list call. Doing the write half here
     * leaves that expand as the ONLY remaining piece, rather than requiring a second change to this
     * money-moving seam later. See `hosted-client.ts`'s `metadata` doc for the full picture. */
    metadata: { working_order_id: string; payment_ref: string };
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
