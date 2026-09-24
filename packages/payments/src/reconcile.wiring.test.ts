import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  decimal,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { openIncidents } from "@waitron/core";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { FakePaymentProvider } from "./testing/fake-provider.js";
import { FakeReconciler } from "./testing/fake-reconciler.js";
import { FakeSettlementReport } from "./testing/fake-settlement-report.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

const pg = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

beforeEach(async () => {
  // Child before parent: deleting `payments` while a `payment_refunds` row still points at it is
  // refused with `FOREIGN KEY constraint failed`.
  await pg.db.execute(sql`delete from incidents`);
  await pg.db.execute(sql`delete from payment_refunds`);
  await pg.db.execute(sql`delete from payments`);
});

/** Money moved, the sale never happened, and the sweep reversed it and raised an open incident. */
describe("the orphan backstop, end to end", () => {
  it("collects, loses the sale, and lets the sweep reverse it and record an open incident", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    const provider = new FakePaymentProvider(pg.db);

    // 1. Real capture through the provider — the money moves.
    const captured = await provider.collect({
      tillId: brandTillId(seeded.tillId),
      workingOrderId: brandWorkingOrderId(seeded.workingOrderId),
      amount: decimal("12.50"),
    });
    expect(captured.state).toBe("captured");

    // 2. recordSale never happens; the customer leaves and the order is abandoned.
    await pg.db.execute(sql`
      update working_orders set status = 'abandoned' where id = ${seeded.workingOrderId}`);

    // 3. `FakePaymentProvider` sets no `external_ref`, so no settlement could match this row; the
    //    capture is inside the settlement lag, so it is not also `unsettled`.
    const now = new Date();
    const report = new FakeSettlementReport([]);
    const reconciler = new FakeReconciler(pg.db, report);
    const period = { from: new Date(now.getTime() - 3_600_000), to: new Date(now.getTime() + 1) };

    const result = await reconciler.reconcile(period, now);

    // 4. The audit found it, reversed it, and said so.
    expect(result.orphan).toHaveLength(1);
    expect(result.orphan[0].paymentRef).toBe(captured.paymentRef);
    expect(result.remediated).toBe(1);
    expect(reconciler.reversed).toEqual([captured.paymentRef]);

    // 5. And the till sees exactly one incident, through the UI's own query.
    const incidents = await pg.db.transaction((tx) =>
      openIncidents(tx, brandTillId(seeded.tillId)),
    );
    expect(incidents.map((i) => i.code)).toEqual(["payment.reconcile_orphan"]);
    expect(incidents[0].params.count).toBe(1);
  });
});
