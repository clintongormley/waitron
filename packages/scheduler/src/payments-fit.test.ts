import { describe, expect, it } from "vitest";
import type { PaymentReconcileResult, PaymentReconciler } from "@waitron/payments";
import { tenantId as brandTenantId } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import type { DutyOutcome, PeriodDuty, RunPeriod } from "./duty.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The adapter the `apps/*` host will own, written here to PROVE the seam fits rather than assert
 * it — the same reason payments types its `IncidentSink` structurally and notes that
 * `recordIncidentOnce` is assignable to it verbatim.
 *
 * `@waitron/payments` is a DEV dependency, and this file names it for TYPES only. It is not the
 * only file that names it — `run.test.ts` imports the package for its side effect, to reach the
 * `AppError` code augmentation — but both are test files, so nothing on the runtime path depends
 * on it. That is a lint rule, not a convention: eslint.config.js's fourth
 * `import-x/no-restricted-paths` zone forbids `packages/payments` (and the fiscal packages) from
 * every non-test file under `packages/scheduler/src`.
 */
function reconcilerAsDuty(reconciler: PaymentReconciler): PeriodDuty {
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

function emptyResult(period: RunPeriod): PaymentReconcileResult {
  return {
    period,
    checked: 0,
    unsettled: [],
    lostSettlement: [],
    orphan: [],
    missingLocal: [],
    drift: [],
    incidentsRaised: 0,
    remediated: 0,
    remediationFailures: [],
  };
}

const PERIOD: RunPeriod = {
  from: new Date("2026-07-24T00:00:00Z"),
  to: new Date("2026-07-25T00:00:00Z"),
};
const NOW = new Date("2026-07-25T04:00:00Z");
// Branded, never a bare `as TenantId`: the brand is what stops a raw string reaching a
// tenant-scoped call site, and casting past it in a test teaches the wrong pattern.
const TENANT = brandTenantId("11111111-1111-1111-1111-111111111111");

function reconcilerReturning(result: PaymentReconcileResult): PaymentReconciler {
  return { provider: "stripe", reconcile: () => Promise.resolve(result) };
}

describe("a PaymentReconciler adapts to a PeriodDuty", () => {
  it("names the duty per settlement identity and carries the whole result", async () => {
    const duty = reconcilerAsDuty(reconcilerReturning(emptyResult(PERIOD)));
    expect(duty.name).toBe("payments.reconcile.stripe");

    const outcome = await duty.run(TENANT, PERIOD, NOW);
    expect(outcome.summary.checked).toBe(0);
    expect(outcome.resweepAfter).toBeUndefined();
  });

  it("asks for a re-sweep when an orphan's amount also drifted", async () => {
    const mismatch = {
      paymentRef: "pi_1",
      references: ["pi_1"],
      localState: "captured" as const,
      localAmount: "10.00",
      settledAmount: "9.50",
      workingOrderId: "wo_1",
    };
    const result = { ...emptyResult(PERIOD), orphan: [mismatch], drift: [mismatch] };
    const duty = reconcilerAsDuty(reconcilerReturning(result));

    const outcome = await duty.run(TENANT, PERIOD, NOW);
    expect(outcome.resweepAfter).toEqual(new Date("2026-07-26T04:00:00Z"));
  });

  it("does not ask for a re-sweep for an orphan with no drift", async () => {
    const orphan = {
      paymentRef: "pi_2",
      references: ["pi_2"],
      localState: "captured" as const,
      localAmount: "10.00",
      settledAmount: "10.00",
      workingOrderId: "wo_2",
    };
    const duty = reconcilerAsDuty(
      reconcilerReturning({ ...emptyResult(PERIOD), orphan: [orphan] }),
    );
    const outcome = await duty.run(TENANT, PERIOD, NOW);
    expect(outcome.resweepAfter).toBeUndefined();
  });

  it("persists remediationFailures, which the sweep cannot record itself", async () => {
    const result = {
      ...emptyResult(PERIOD),
      remediationFailures: [{ paymentRef: "pi_3", reason: "payment.refund_exceeds_capture" }],
    };
    const duty = reconcilerAsDuty(reconcilerReturning(result));
    const outcome = await duty.run(TENANT, PERIOD, NOW);
    expect(outcome.summary.remediationFailures).toEqual([
      { paymentRef: "pi_3", reason: "payment.refund_exceeds_capture" },
    ]);
  });
});
