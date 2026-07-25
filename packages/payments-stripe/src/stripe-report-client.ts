import type Stripe from "stripe";
import type { StripeReportClient, StripeSessionRef, StripeSettlement } from "./report-client.js";

/** The real `StripeReportClient`, wrapping the balance-transaction and Checkout-session APIs.
 * Coverage-excluded (see vitest.config.ts): a thin call-mapping boundary whose logic is the SDK's,
 * exercised by the nightly sandbox. Both list calls page to exhaustion via `autoPagingEach` — never
 * a single page — so a busy tenant's report is never silently truncated: a truncated ledger would
 * read as missing settlements and manufacture false `unsettled` findings, a money-correctness bug,
 * not merely a slow one. */
export function stripeReportClient(stripe: Stripe): StripeReportClient {
  return {
    async listSettlements(window): Promise<StripeSettlement[]> {
      const out: StripeSettlement[] = [];
      await stripe.balanceTransactions
        .list({
          created: { gte: unix(window.from), lt: unix(window.to) },
          type: "charge",
          expand: ["data.source"],
          limit: 100,
        })
        .autoPagingEach((bt) => {
          const charge = bt.source as Stripe.Charge | null;
          // A `type: "charge"` balance transaction with no expanded charge, or a charge Stripe
          // returned with no id (both allowed by the SDK's types, neither expected in practice), has
          // nothing this seam can key a reference on. Pushing a record anyway with `chargeId: ""`
          // would flow an empty-string reference into the audit's `references` array — where it
          // could match nothing (silently discarding a real settlement) or, on a second such record,
          // collide with an unrelated one. Dropping the record is the honest choice: a settlement
          // this unresolvable is not one the audit can meaningfully attribute either way.
          if (charge === null || !charge.id) return;
          out.push({
            paymentIntentId: refId(charge.payment_intent),
            chargeId: charge.id,
            // GROSS, never `bt.net`: net is after Stripe's fee, and our stored amount is what the
            // customer paid, so reconciling against net would flag every payment as drift.
            amountMinor: bt.amount,
            settledAt: new Date(bt.created * 1000),
          });
        });
      return out;
    },

    async listCheckoutSessions(window): Promise<StripeSessionRef[]> {
      const out: StripeSessionRef[] = [];
      await stripe.checkout.sessions
        .list({ created: { gte: unix(window.from), lt: unix(window.to) }, limit: 100 })
        .autoPagingEach((session) => {
          const workingOrderId = session.metadata?.working_order_id;
          const paymentRef = session.metadata?.payment_ref;
          out.push({
            sessionId: session.id,
            paymentIntentId: refId(session.payment_intent),
            ...(workingOrderId !== undefined && paymentRef !== undefined
              ? { hint: { workingOrderId, paymentRef } }
              : {}),
          });
        });
      return out;
    },

    async paymentIntentForSession(sessionId): Promise<string | null> {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      return refId(session.payment_intent);
    },
  };
}

/** Stripe's list filters (`created.gte`/`created.lt`) take UNIX SECONDS, not milliseconds and not
 * an ISO string — passing a millisecond epoch straight through would silently widen every window by
 * a factor of ~1000 and return effectively unfiltered results. */
function unix(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

/** Stripe returns a reference as a bare id string, or as the expanded object when the caller asked
 * for it. Both must yield the id: treating an expanded object as absent would silently null the
 * PaymentIntent the moment anyone adds an `expand` for it, and an unmatchable settlement reads as
 * `missingLocal` while its real local row reads as `unsettled`. */
function refId(value: string | { id: string } | null | undefined): string | null {
  if (typeof value === "string") return value;
  if (value !== null && value !== undefined) return value.id;
  return null;
}
