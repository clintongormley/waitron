import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  PAYMENTS_MIGRATIONS,
  insertCapturedPayment,
  listOpenHolds,
  recordHoldOutcome,
} from "@waitron/payments";
import type { PaymentReconcileResult, PaymentReconciler } from "@waitron/payments";
import { FakeReconciler } from "@waitron/payments/src/testing/fake-reconciler.js";
import { FakeSettlementReport } from "@waitron/payments/src/testing/fake-settlement-report.js";
import { seedWorkingOrder } from "@waitron/payments/test/seed.js";
import type { RunPeriod } from "@waitron/scheduler";
import { decimal, deviceOrigin } from "@waitron/shared";
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

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

function reconcilerReturning(result: PaymentReconcileResult): PaymentReconciler {
  return { provider: "stripe", reconcile: () => Promise.resolve(result) };
}

describe("a PaymentReconciler adapts to a PeriodDuty", () => {
  it("names the duty per settlement identity and carries the whole result", async () => {
    const duty = reconcilerAsDuty(reconcilerReturning(emptyResult(PERIOD)));
    expect(duty.name).toBe("payments.reconcile.stripe");

    const outcome = await duty.run(PERIOD, NOW);
    expect(outcome.summary.checked).toBe(0);
    expect(outcome.resweepAfter).toBeUndefined();
  });

  it("asks for a parked day to be tried again one day later", () => {
    const duty = reconcilerAsDuty(reconcilerReturning(emptyResult(PERIOD)));
    expect(duty.retryParkedAfterMs).toBe(24 * 60 * 60 * 1000);
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

    const outcome = await duty.run(PERIOD, NOW);
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
    const outcome = await duty.run(PERIOD, NOW);
    expect(outcome.resweepAfter).toBeUndefined();
  });

  it("persists remediationFailures, which the sweep cannot record itself", async () => {
    const result = {
      ...emptyResult(PERIOD),
      remediationFailures: [{ paymentRef: "pi_3", reason: "payment.refund_exceeds_capture" }],
    };
    const duty = reconcilerAsDuty(reconcilerReturning(result));
    const outcome = await duty.run(PERIOD, NOW);
    expect(outcome.summary.remediationFailures).toEqual([
      { paymentRef: "pi_3", reason: "payment.refund_exceeds_capture" },
    ]);
  });

  it("asks for no re-check once every held payment of the day has an outcome", async () => {
    const seeded = await seedWorkingOrder(suite.db, "B88888888");
    await withTransaction(suite.db, (tx) =>
      insertCapturedPayment(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "held-1",
        externalRef: "ext-held-1",
        amount: decimal("10.00"),
        settledAt: new Date("2026-07-24T12:00:00Z"),
      }),
    );
    await suite.db
      .update(workingOrders)
      .set({ status: "abandoned" })
      .where(eq(workingOrders.id, seeded.workingOrderId));
    const report = new FakeSettlementReport([
      {
        references: ["ext-held-1"],
        amount: decimal("12.50"),
        settledAt: new Date("2026-07-24T12:00:00Z"),
      },
    ]);
    const duty = reconcilerAsDuty(new FakeReconciler(suite.db, report));

    const held = await duty.run(PERIOD, NOW);
    expect(held.resweepAfter).toEqual(new Date("2026-07-26T04:00:00Z"));

    const [hold] = await withTransaction(suite.db, (tx) => listOpenHolds(tx));
    await withTransaction(suite.db, (tx) =>
      recordHoldOutcome(tx, {
        holdId: hold!.holdId,
        outcome: "refunded_at_provider",
        note: null,
        personId: "22222222-2222-4222-8222-222222222222",
        at: NOW,
      }),
    );

    const later = new Date("2026-07-26T04:00:00Z");
    const resolved = await duty.run(PERIOD, later);
    expect(resolved.resweepAfter).toBeUndefined();
  });

  it("asks for no re-check when the outcome is recorded while the report is being fetched", async () => {
    const seeded = await seedWorkingOrder(suite.db, "B89898989");
    await withTransaction(suite.db, (tx) =>
      insertCapturedPayment(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "held-2",
        externalRef: "ext-held-2",
        amount: decimal("10.00"),
        settledAt: new Date("2026-07-24T12:00:00Z"),
      }),
    );
    await suite.db
      .update(workingOrders)
      .set({ status: "abandoned" })
      .where(eq(workingOrders.id, seeded.workingOrderId));
    const drifted = [
      {
        references: ["ext-held-2"],
        amount: decimal("12.50"),
        settledAt: new Date("2026-07-24T12:00:00Z"),
      },
    ];
    await reconcilerAsDuty(new FakeReconciler(suite.db, new FakeSettlementReport(drifted))).run(
      PERIOD,
      NOW,
    );
    const [hold] = await withTransaction(suite.db, (tx) => listOpenHolds(tx));

    const racing = {
      async fetch() {
        await withTransaction(suite.db, (tx) =>
          recordHoldOutcome(tx, {
            holdId: hold!.holdId,
            outcome: "kept",
            note: null,
            personId: "22222222-2222-4222-8222-222222222222",
            at: NOW,
          }),
        );
        return drifted;
      },
    };
    const outcome = await reconcilerAsDuty(new FakeReconciler(suite.db, racing)).run(
      PERIOD,
      new Date("2026-07-26T04:00:00Z"),
    );
    expect(outcome.resweepAfter).toBeUndefined();
  });
});
