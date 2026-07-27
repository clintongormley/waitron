import { describe, expect, it } from "vitest";
import type { PaymentReconcileResult, PaymentReconciler } from "@waitron/payments";
import { tenantId as brandTenantId } from "@waitron/shared";
import type { RunPeriod } from "@waitron/scheduler";
import { reconcilerAsDuty } from "./reconcile-duty.js";

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
