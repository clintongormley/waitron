// Two refunds of one payment, started together: the venue file's write queue is what keeps them
// from both reading the same running total.
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
 * What this case USED to observe, and what it observes now.
 *
 * On PostgreSQL it took two connections, had the first hold `recordRefund`'s `FOR UPDATE` lock on
 * the payment row, and asserted that the second `recordRefund` was still unsettled after a 200ms
 * pause and that it took at least 150ms to finish. Neither half survives the engine change:
 * `recordRefund` (`store.ts`) takes no row lock now — read it, there is no `for update` in it —
 * and SQLite opens one connection per file, so there is no second backend to block.
 *
 * **The product claim underneath it does survive, and it is the one worth keeping.**
 * `recordRefund` is a read-modify-write over a running total: it sums the payment's succeeded
 * `payment_refunds` rows, refuses the write if this refund would take the total past the capture,
 * and only then inserts. Two of those overlapping would each read `alreadyRefunded = 0` and each
 * decide it was a PARTIAL refund, leaving a fully-refunded payment reading `partially_refunded`
 * with 20.00 returned against a 20.00 capture and neither write knowing about the other. What
 * stops that now is the write queue — `withTransaction` (`packages/db/src/tenancy.ts`) runs its
 * body inside `db.withWriteLock`, and `packages/store/src/write-queue.ts` issues `begin
 * immediate`, awaits the body and `commit`s, so the second `begin` does not run until the first
 * `commit` has returned.
 *
 * LOSS, stated rather than left to be noticed: this no longer proves anything about WAITING. The
 * PostgreSQL version could tell "blocked on a lock" from "ran to completion first"; this one
 * cannot, and would pass just as well against an engine that ran the two bodies one after the
 * other for any other reason. What it still discriminates is the outcome — see the control below.
 *
 * Control, 2026-09-22, run on this file: with the two `recordRefund` calls started on the same
 * handle but WITHOUT `withTransaction` around them (`suite.db` passed straight in, which
 * type-checks because `Database` is assignable to `Transaction`), both read `alreadyRefunded = 0`
 * and both return `partially_refunded` — the case fails on the two-states assertion below,
 * `expected [ 'partially_refunded', 'partially_refunded' ] to deeply equal
 * [ 'partially_refunded', 'refunded' ]`. Restoring `withTransaction` passes. Both readings came
 * from `pnpm --filter @waitron/payments exec vitest run src/reversal.concurrency.test.ts`, back to
 * back.
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

    // Started together, not awaited in turn: nothing but the write queue keeps the second body out
    // of the first one's transaction. Which of the two runs first is not asserted — 12 then 8 and
    // 8 then 12 both end at the capture, and the invariant is the total, not the order.
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
