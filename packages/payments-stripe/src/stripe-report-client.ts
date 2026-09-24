import type Stripe from "stripe";
import type { StripeReportClient, StripeSessionRef, StripeSettlement } from "./report-client.js";

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
          // Nothing to key a reference on; an empty-string `chargeId` could collide with another.
          if (charge === null || !charge.id) return;
          out.push({
            paymentIntentId: refId(charge.payment_intent),
            chargeId: charge.id,
            // GROSS, never `bt.net` — see `StripeSettlement`.
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

/** Stripe's `created` filters take UNIX SECONDS. */
function unix(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

/** A reference arrives as a bare id, or as the object when expanded; both must yield the id. */
function refId(value: string | { id: string } | null | undefined): string | null {
  if (typeof value === "string") return value;
  if (value !== null && value !== undefined) return value.id;
  return null;
}
