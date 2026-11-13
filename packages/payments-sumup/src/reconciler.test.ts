import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, deviceOrigin } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS, insertCapturedPayment, insertFailedPayment } from "@waitron/payments";
import { seedWorkingOrder, freshNif } from "@waitron/payments/test/seed.js";
import { captureAlerts, heldAlerts } from "@waitron/payments/test/capture-alerts.js";
import * as sumup from "./index.js";
import { FakeSumUp } from "./testing/fake-sumup.js";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });
const period = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };
const now = new Date("2026-07-25T00:00:00Z");

async function failedPayment(paymentRef: string) {
  const seeded = await seedWorkingOrder(suite.db, freshNif());
  await withTransaction(suite.db, (tx) =>
    insertFailedPayment(tx, {
      provider: "sumup",
      paymentRef,
      amount: decimal("10.00"),
      origin: deviceOrigin(seeded.deviceId),
      nodeId: seeded.nodeId,
      workingOrderId: seeded.workingOrderId,
    }),
  );
  await suite.db.execute(sql`update payments set created_at = '2026-07-01T12:00:00.000Z'`);
  return seeded;
}

describe("SumUp audit", () => {
  it("persists the failed-payment hint without changing the payment and resolves credentials anew each sweep", async () => {
    expect(sumup.SumUpReconciler).toBeTypeOf("function");
    const seeded = await failedPayment("lost");
    const client = new FakeSumUp();
    vi.spyOn(client, "findTransaction").mockResolvedValue({
      id: "charge",
      status: "SUCCESSFUL",
      amount: decimal("10.00"),
      currency: "EUR",
      timestamp: "2026-07-01T12:00:00Z",
      foreignTransactionId: "lost",
    });
    const resolveClient = vi
      .fn()
      .mockResolvedValueOnce(client)
      .mockResolvedValueOnce(new FakeSumUp());
    const reconciler = new sumup.SumUpReconciler({
      db: suite.db,
      resolveClient,
      incidents: captureAlerts.raise,
      heldAlerts,
    });
    const before = await suite.db.execute(sql`select * from payments`);
    const result = await reconciler.reconcile(period, now);
    expect(result.missingLocal).toEqual([
      {
        paymentRef: null,
        references: ["charge"],
        localState: null,
        localAmount: null,
        settledAmount: "10.00",
        workingOrderId: seeded.workingOrderId,
      },
    ]);
    expect(result.incidentsRaised).toBe(1);
    expect(result.unlinkedCharges).toBe(0);
    expect(result.remediated).toBe(0);
    expect(await suite.db.execute(sql`select * from payments`)).toEqual(before);
    expect(
      (await suite.db.execute<{ code: string }>(sql`select code from incidents`)).rows,
    ).toEqual([{ code: "payment.reconcile_missing_local" }]);
    expect((await reconciler.reconcile(period, now)).missingLocal).toEqual([]);
    expect(resolveClient).toHaveBeenCalledTimes(2);
  });

  it.each([
    { status: null, timestamp: "2026-07-01T12:00:00Z", unsettled: ["capture"] },
    { status: "CANCELLED", timestamp: "2026-07-01T12:00:00Z", unsettled: ["capture"] },
    { status: "SUCCESSFUL", timestamp: "2026-06-30T12:00:00Z", unsettled: [] },
  ])(
    "audits $status capture on the normal next-day run, including cross-day recovery",
    async ({ status, timestamp, unsettled }) => {
      const seeded = await seedWorkingOrder(suite.db, freshNif());
      await withTransaction(suite.db, (tx) =>
        insertCapturedPayment(tx, {
          provider: "sumup",
          paymentRef: "capture",
          externalRef: "charge",
          amount: decimal("10.00"),
          origin: deviceOrigin(seeded.deviceId),
          nodeId: seeded.nodeId,
          workingOrderId: seeded.workingOrderId,
          settledAt: new Date("2026-07-01T12:00:00Z"),
        }),
      );
      const client = new FakeSumUp();
      const lookup = vi.spyOn(client, "findTransaction").mockResolvedValue(
        status === null
          ? null
          : {
              id: "charge",
              amount: decimal("10.00"),
              status,
              currency: "EUR",
              timestamp,
            },
      );
      const result = await new sumup.SumUpReconciler({
        db: suite.db,
        resolveClient: async () => client,
        incidents: captureAlerts.raise,
        heldAlerts,
      }).reconcile(period, new Date("2026-07-02T00:05:00Z"));
      expect(result.unsettled.map((row) => row.paymentRef)).toEqual(unsettled);
      expect(result.missingLocal).toEqual([]);
      expect(lookup.mock.calls).toEqual([[{ id: "charge" }]]);
    },
  );

  it("counts an outside charge only in its own day", async () => {
    const client = new FakeSumUp();
    vi.spyOn(client, "historyPage").mockResolvedValue({
      items: [
        {
          transaction_id: "app",
          type: "PAYMENT",
          status: "SUCCESSFUL",
          amount: 10,
          currency: "EUR",
          timestamp: "2026-07-02T12:00:00Z",
        },
      ],
      links: [],
    });
    const audit = new sumup.SumUpReconciler({
      db: suite.db,
      resolveClient: async () => client,
      incidents: captureAlerts.raise,
      heldAlerts,
    });
    expect((await audit.reconcile(period, now)).unlinkedCharges).toBe(0);
    expect(
      (await audit.reconcile({ from: period.to, to: new Date("2026-07-03T00:00:00Z") }, now))
        .unlinkedCharges,
    ).toBe(1);
  });

  it("asks for a resweep while recovery owns a pending candidate", async () => {
    expect(sumup.SumUpReconciler).toBeTypeOf("function");
    await failedPayment("pending");
    await suite.db.execute(sql`update payments set state = 'attempting'`);
    const client = new FakeSumUp();
    const lookup = vi.spyOn(client, "findTransaction");
    const result = await new sumup.SumUpReconciler({
      db: suite.db,
      resolveClient: async () => client,
      incidents: captureAlerts.raise,
      heldAlerts,
    }).reconcile(period, now);
    expect(result.resweepAfter).toEqual(new Date("2026-07-26T00:00:00Z"));
    expect(result.incidentsRaised).toBe(0);
    expect(lookup).not.toHaveBeenCalled();
  });
});
