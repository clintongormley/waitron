/** `amountMinor` is the GROSS charge, not `net`: `net` is after Stripe's fee, and reconciling
 * against it would report every payment as drift.
 *
 * `settledAt` is the balance transaction's `created`, deliberately NOT `available_on` or
 * `arrival_date`, which come days later: a mismatch should surface as soon as Stripe knows of the
 * charge. */
export interface StripeSettlement {
  paymentIntentId: string | null;
  chargeId: string;
  amountMinor: number;
  settledAt: Date;
}

export interface StripeSessionRef {
  sessionId: string;
  paymentIntentId: string | null;
  hint?: { workingOrderId: string; paymentRef: string };
}

/** Amounts cross as Stripe's integer minor units, not `Decimal`; `report-source.ts` converts. */
export interface StripeReportClient {
  /** Paged to exhaustion: a truncated ledger would read as missing settlements. */
  listSettlements(window: { from: Date; to: Date }): Promise<StripeSettlement[]>;
  /** Bridges the ledger's PaymentIntent to the SESSION id a hosted row stores, and carries back the
   * metadata that attributes a settlement with no local row to a till. */
  listCheckoutSessions(window: { from: Date; to: Date }): Promise<StripeSessionRef[]>;
  /** Null when the session has no PaymentIntent (never paid). */
  paymentIntentForSession(sessionId: string): Promise<string | null>;
}
