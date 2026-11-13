import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, deviceOrigin } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS, insertFailedPayment } from "@waitron/payments";
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
