/** One settled charge as the audit reads it.
 *
 * `paymentIntentId` is null when the underlying charge has no PaymentIntent behind it — a real,
 * if rare, shape (a charge created outside the PaymentIntents flow) rather than a mapping failure.
 * `stripe-report-client.ts` drops any record whose CHARGE itself is unresolvable, so by the time a
 * `StripeSettlement` reaches here `chargeId` is always present; it is the one reference guaranteed
 * to survive into `SettlementRecord.references` even on a settlement with no PaymentIntent.
 *
 * `amountMinor` is the GROSS charge in minor units — deliberately not `net`: `net` is after
 * Stripe's fee, and our `payments.amount` is what the customer paid, so reconciling against `net`
 * would classify every single payment as a drift by the fee.
 *
 * `settledAt` is the balance transaction's `created` timestamp — the moment Stripe recorded the
 * charge, available within minutes of capture — and deliberately NOT `available_on` (when the
 * funds join the available balance, days later) or `arrival_date` (the payout date, later still).
 * Reconcile needs to know a charge cleared as soon as Stripe itself knows it, so a `lostSettlement`
 * or `missingLocal` surfaces in minutes; keying off either later timestamp would silently reintroduce
 * the multi-day payout delay this seam exists to avoid (see the design doc's §3 fee/timing note). A
 * future implementer for a different processor needs to pick the equivalent of `created`, not
 * whichever timestamp looks most like "settled" on the vendor's own dashboard. */
export interface StripeSettlement {
  paymentIntentId: string | null;
  chargeId: string;
  amountMinor: number;
  settledAt: Date;
}

/** One Checkout Session, reduced to what the audit needs: the id a hosted `payments` row stores in
 * `external_ref`, the PaymentIntent the settlement ledger keys by, and the identifiers we stamped
 * into the session's metadata at creation. */
export interface StripeSessionRef {
  sessionId: string;
  paymentIntentId: string | null;
  hint?: { workingOrderId: string; paymentRef: string };
}

/** The narrow Stripe surface the reconcile adapter depends on — the three calls it makes, not the
 * SDK. The real impl (`./stripe-report-client.ts`) wraps the balance-transaction, Checkout-session
 * and session-retrieve APIs and is coverage-excluded; `FakeStripeReport` (`./testing/`) models it
 * deterministically. Separate from `StripeClient`/`StripeDeviceClient`/`StripeHostedClient`: each
 * seam names only the calls its own consumer uses. Amounts cross as Stripe's own integer minor
 * units, not `Decimal` — unlike the other three seams — because this side is read-only reporting,
 * never a value fed back into a create call; conversion to the neutral `Decimal` the audit compares
 * against is the report source's job (`report-source.ts`'s `fromMinorUnits`), not this seam's. */
export interface StripeReportClient {
  /** Settled charges in the window — the settlement ledger the audit compares our books against.
   * Paged to exhaustion by the implementation, so the caller sees one flat list. */
  listSettlements(window: { from: Date; to: Date }): Promise<StripeSettlement[]>;
  /** Checkout Sessions created in the window. Two jobs: bridging PaymentIntent → Session id (a hosted
   * payment stores the SESSION id, while the settlement ledger only ever knows the PaymentIntent), and
   * carrying back the metadata that lets a settlement with no local row be attributed to a till. */
  listCheckoutSessions(window: { from: Date; to: Date }): Promise<StripeSessionRef[]>;
  /** The PaymentIntent behind one Checkout Session, or null when it has none (never paid). The
   * reversal path's resolver: a hosted payment stores a session id, and the refund API needs the
   * PaymentIntent. */
  paymentIntentForSession(sessionId: string): Promise<string | null>;
}
