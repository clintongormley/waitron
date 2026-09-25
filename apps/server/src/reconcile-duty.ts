import type { PaymentReconcileResult, PaymentReconciler } from "@waitron/payments";
import type { DutyOutcome, PeriodDuty, RunPeriod } from "@waitron/scheduler";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Adapts a `PaymentReconciler` into a scheduler `PeriodDuty`. It lives in the host because
 * `packages/scheduler` may not import `@waitron/payments` and `packages/payments` does not own cadence.
 */
export function reconcilerAsDuty(reconciler: PaymentReconciler): PeriodDuty {
  return {
    name: `payments.reconcile.${reconciler.provider}`,
    cadence: "daily",
    async run(period: RunPeriod, now: Date): Promise<DutyOutcome> {
      const result = await reconciler.reconcile(period, now);
      return {
        summary: summaryOf(result),
        // A paymentRef in BOTH lists is an orphan whose amount also drifted. Deliberately a SUPERSET of
        // the strictly-gated set: exactness would mean widening a money-path package for one extra
        // harmless re-sweep.
        ...(gatedDriftOrphan(result) ? { resweepAfter: new Date(now.getTime() + DAY_MS) } : {}),
      };
    },
  };
}

function gatedDriftOrphan(result: PaymentReconcileResult): boolean {
  const drifted = new Set(result.drift.map((m) => m.paymentRef));
  return result.orphan.some((m) => drifted.has(m.paymentRef));
}

/** Explicit, JSON-safe, and complete: `remediationFailures` is the finding the sweep cannot
 * otherwise persist, and `packages/payments` names the scheduler as its owner. */
function summaryOf(result: PaymentReconcileResult): Record<string, unknown> {
  return {
    period: { from: result.period.from.toISOString(), to: result.period.to.toISOString() },
    checked: result.checked,
    unsettled: result.unsettled,
    lostSettlement: result.lostSettlement,
    orphan: result.orphan,
    missingLocal: result.missingLocal,
    drift: result.drift,
    incidentsRaised: result.incidentsRaised,
    remediated: result.remediated,
    remediationFailures: result.remediationFailures,
  };
}
