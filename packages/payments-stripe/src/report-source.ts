import type { ReconcilePeriod, SettlementRecord, SettlementReportSource } from "@waitron/payments";
import type { TenantId } from "@waitron/shared";
import { fromMinorUnits } from "./client.js";
import type { StripeReportClient } from "./report-client.js";

/**
 * The floor on how far BACK the Checkout-session pass reaches, independent of `settlementLagMs`.
 *
 * The two quantities measure different things and only look alike because one option happened to be
 * in scope. `settlementLagMs` is how long the PROCESSOR may take to report a settlement — a tolerance
 * the operator is meant to be able to tune down when their account settles quickly. The session
 * lookback is how long before its charge a SESSION may have been CREATED, and that is not tunable by
 * anyone: it is bounded by Stripe's own Checkout expiry, 24 hours, after which a session can no longer
 * be paid at all.
 *
 * Conflating them is a silent money bug in the tightening direction. A caller lowering the settlement
 * tolerance to an hour would also narrow this lookback to an hour, and every hosted payment whose
 * session was created earlier than that would drop out of the bridge map: its settlement carries no
 * `cs_` reference, so the local row matches nothing and reads as `unsettled` FOREVER while the real
 * settlement reads as `missingLocal`. Both are money-class findings, manufactured by a knob that has
 * nothing to do with either. Flooring at the expiry means the pass always covers every session that
 * could still have produced a charge in this window.
 */
const SESSION_LOOKBACK_FLOOR_MS = 24 * 60 * 60 * 1000;

/**
 * The Stripe half of the reconciliation audit: turn one tenant's Stripe account into the neutral
 * `SettlementRecord[]` the sweep classifies against.
 *
 * Two paged passes per sweep, never one per record — the settlement ledger, and the Checkout
 * Sessions that bridge it to our hosted rows. Both are whole-window calls, so cost is flat in the
 * number of settlements. Fetching per-record would be an N+1 against Stripe; the neutral layer was
 * twice corrected for exactly that shape and this adapter must not reintroduce it.
 *
 * Tenant scoping is structural rather than a filter: `client` is resolved per tenant by the caller
 * and a standalone Stripe account holds exactly one tenant's money, which is how this implementation
 * honours `SettlementReportSource`'s contract that a source return only `tenantId`'s settlements.
 */
export function stripeSettlementReport(
  client: StripeReportClient,
  settlementLagMs: number,
): SettlementReportSource {
  return {
    async fetch(_tenantId: TenantId, window: ReconcilePeriod): Promise<SettlementRecord[]> {
      // The ledger pass takes the sweep's window as given — the sweep has already widened it
      // forwards by the lag, because a payment captured at the end of a period settles after it.
      const settlements = await client.listSettlements(window);

      // The session pass reaches further BACK instead: a session created before the period can have
      // its charge settle inside it, and an unmapped hosted payment has no matchable reference at
      // all — it would read as `unsettled` for ever, and its settlement as `missingLocal`.
      //
      // `settlementLagMs` is a convenient LOWER bound for that reach, not the quantity it actually
      // needs — see `SESSION_LOOKBACK_FLOOR_MS`. Taking the max keeps the tunable knob free to move
      // in the loosening direction without letting it silently shrink a window that Stripe's own
      // 24-hour Checkout expiry, not our tolerance, is what really bounds.
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
          // Every id that could be a local `external_ref`: the PaymentIntent (terminal/on-device
          // rows), the charge, and the Checkout Session (hosted rows) when one maps.
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
