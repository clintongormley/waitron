import type { PaymentReconcileResult, PaymentReconciler } from "@waitron/payments";
import type { TenantId } from "@waitron/shared";
import type { DutyOutcome, PeriodDuty, RunPeriod } from "@waitron/scheduler";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The adapter that converts a `PaymentReconciler` into a `PeriodDuty` for the recurring scheduler.
 * This is the only place it can live: `packages/scheduler` must not import `@waitron/payments`
 * from any non-test file (eslint restricted-paths), and `packages/payments` must not own cadence
 * (per §7 of the spec) — so the host, which owns both payments and scheduling, implements the
 * adapter here. The import of `PaymentReconciler` and `PeriodDuty` together on the runtime path
 * is the compile-time proof that the seam fits (replacing the proof-file that existed before the
 * host did).
 */
export function reconcilerAsDuty(reconciler: PaymentReconciler): PeriodDuty {
  return {
    name: `payments.reconcile.${reconciler.provider}`,
    cadence: "daily",
    async run(tenantId: TenantId, period: RunPeriod, now: Date): Promise<DutyOutcome> {
      const result = await reconciler.reconcile(tenantId, period, now);
      return {
        summary: summaryOf(result),
        // A paymentRef in BOTH lists is an orphan whose amount also drifted. This is a SUPERSET of
        // the strictly-gated set — the gates are ordered, so a drifting orphan on a non-abandoned
        // working order reports `workingOrderNotAbandoned` yet still appears in both — and that is
        // deliberate: `remediation` never reaches the result (only the incident's params), so
        // exactness would mean widening a money-path package for one extra harmless re-sweep.
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
