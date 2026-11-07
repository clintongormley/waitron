import type {
  DutyOutcome,
  PaymentReconcileResult,
  PaymentReconciler,
  PeriodDuty,
  RunPeriod,
  TickResult,
} from "@waitron/payments";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Adapts a `PaymentReconciler` into a scheduler `PeriodDuty`. It lives in the host because payments'
 * reconciliation schedule may not import the rest of payments, and the reconciler does not own
 * cadence.
 */
export function reconcilerAsDuty(reconciler: PaymentReconciler): PeriodDuty {
  return {
    name: `payments.reconcile.${reconciler.provider}`,
    cadence: "daily",
    retryParkedAfterMs: DAY_MS,
    longestResweepMs: DAY_MS,
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

/** What a pass reports when it runs no reconciliation: the shape `runDue` returns for a tick with no
 * work, so `runPass` and `health.ts` need no special case. */
export const NOTHING_TO_RECONCILE: TickResult = {
  ran: [],
  deferred: 0,
  beyondHorizon: 0,
  skipped: [],
  nextDueAt: null,
};

export interface ReconcilePassDeps {
  /** With payments switched off its tables, `scheduled_runs` among them, are not migrated. */
  paymentsEnabled: boolean;
  /** Asked per pass, so a credential provisioned while the host runs is served on the next pass. */
  credentialProvisioned: () => Promise<boolean>;
  runDue: (now: Date) => Promise<TickResult>;
}

/** A pass's reconcile step: runs the duty only while payments is on and its credential is there. */
export function reconcilePassFor(deps: ReconcilePassDeps): (now: Date) => Promise<TickResult> {
  return async (now) => {
    if (!deps.paymentsEnabled) return NOTHING_TO_RECONCILE;
    return (await deps.credentialProvisioned()) ? deps.runDue(now) : NOTHING_TO_RECONCILE;
  };
}
