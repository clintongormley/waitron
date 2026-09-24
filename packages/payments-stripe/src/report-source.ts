import type { ReconcilePeriod, SettlementRecord, SettlementReportSource } from "@waitron/payments";
import { fromMinorUnits } from "./client.js";
import type { StripeReportClient } from "./report-client.js";

/** Stripe's Checkout expiry (24 hours): a session can be paid up to this long after it was created.
 * The session lookback never drops below it, however low `settlementLagMs` is set — a narrower one
 * would drop a hosted payment out of the bridge map, where it reads as `unsettled` forever and its
 * settlement as `missingLocal`. */
const SESSION_LOOKBACK_FLOOR_MS = 24 * 60 * 60 * 1000;

/** Two whole-window passes per sweep, never one call per record. Only this taxpayer's settlements are
 * returned because `client` is built from this taxpayer's own Stripe account. */
export function stripeSettlementReport(
  client: StripeReportClient,
  settlementLagMs: number,
): SettlementReportSource {
  return {
    async fetch(window: ReconcilePeriod): Promise<SettlementRecord[]> {
      // The sweep has already widened this window forwards by the lag.
      const settlements = await client.listSettlements(window);

      // Reaches BACK: a session created before the period can have its charge settle inside it.
      const sessionLookbackMs = Math.max(settlementLagMs, SESSION_LOOKBACK_FLOOR_MS);
      const sessions = await client.listCheckoutSessions({
        from: new Date(window.from.getTime() - sessionLookbackMs),
        to: window.to,
      });
      const byPaymentIntent = new Map(
        sessions
          .filter((s) => s.paymentIntentId !== null)
          .map((s) => [s.paymentIntentId as string, s]),
      );

      return settlements.map((settlement) => {
        const session =
          settlement.paymentIntentId === null
            ? undefined
            : byPaymentIntent.get(settlement.paymentIntentId);
        return {
          // Every id that could be a local `external_ref`.
          references: [
            ...(settlement.paymentIntentId === null ? [] : [settlement.paymentIntentId]),
            settlement.chargeId,
            ...(session === undefined ? [] : [session.sessionId]),
          ],
          amount: fromMinorUnits(settlement.amountMinor),
          settledAt: settlement.settledAt,
          ...(session?.hint === undefined ? {} : { hint: session.hint }),
        };
      });
    },
  };
}
