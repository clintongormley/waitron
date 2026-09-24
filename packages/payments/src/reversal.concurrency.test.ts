import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { getPaymentByRef, insertCapturedPayment, recordRefund } from "./store.js";
import { paymentRefunds } from "./schema/payment-refunds.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const SETTLED = new Date("2026-07-23T10:00:00Z");

/**
 * `recordRefund` reads the running total and then writes. Two started together must not both read
 * the same total: `withTransaction` runs each body under the venue file's write lock, so the second
 * reads after the first commits. Weaker than its name: it asserts the outcome and cannot observe one
 * refund waiting on the other.
 */
describe("concurrent reversals of one payment", () => {
  it("two refunds started together sum against one running total: 12 + 8 on a 20.00 capture ends refunded", async () => {
    const seeded = await seedWorkingOrder(suite.db, freshNif());
    const key = { provider: "fake", paymentRef: "c1" };
    await withTransaction(suite.db, (tx) =>
      insertCapturedPayment(tx, {
        ...key,
        workingOrderId: seeded.workingOrderId,
        amount: decimal("20.00"),
        settledAt: SETTLED,
      }),
    );

    // Started together, not awaited in turn. Which runs first is not asserted: either order ends
    // at the capture.
    const [first, second] = await Promise.all([
      withTransaction(suite.db, (tx) => recordRefund(tx, { ...key, amount: decimal("12.00") })),
      withTransaction(suite.db, (tx) => recordRefund(tx, { ...key, amount: decimal("8.00") })),
    ]);

    // The loser of the order sees the winner's row in its sum and knows it is closing the balance.
    expect([first.state, second.state].sort()).toEqual(["partially_refunded", "refunded"]);

    const row = await withTransaction(suite.db, (tx) => getPaymentByRef(tx, key));
    expect(row?.state).toBe("refunded"); // 12 + 8 = 20 = the capture

    const refunds = await suite.db
      .select({ amount: paymentRefunds.amount, state: paymentRefunds.state })
      .from(paymentRefunds)
      .where(eq(paymentRefunds.paymentRef, "c1"));
    // Both refunds were written, and both succeeded — neither was lost and neither was refused.
    expect(refunds.map((r) => r.amount).sort((a, b) => a - b)).toEqual([800, 1200]);
    expect(refunds.map((r) => r.state)).toEqual(["succeeded", "succeeded"]);
  });
});
