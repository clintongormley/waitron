import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  captureError,
  checkFailed,
  CORE_MIGRATIONS,
  engineErrorMessage,
  isRefusal,
  triggerRaised,
  UNIQUE_VIOLATION,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal } from "@waitron/shared";
import { seedVenue, type SeededVenue } from "@waitron/reporting/test/fixtures.js";
import {
  seedRefundableSale,
  seedTenderRefund,
} from "@waitron/reporting/test/tender-refund-fixtures.js";
import { ADJUSTMENTS_MIGRATIONS } from "./migrations.js";
import { policySnapshotOf, type AdjustmentReason } from "./policy.js";
import { recordAdjustment } from "./record.js";
import { linkRefundToCancels, readCancelsForRefund } from "./refund-links.js";
import { seedVoidReason, seedWorkingOrder } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, ADJUSTMENTS_MIGRATIONS] });

let db: Database;
beforeAll(() => {
  db = suite.db;
});
beforeEach(() => {
  venue = undefined;
});

const WAITER = "11111111-1111-4111-8111-111111111111";
const AT = "2026-10-22T12:00:00.000Z";

/** A cancel of `quantity` of a €10.00 dish, handed to a refund worth `refundValue`. */
function cancel(
  workingOrderId: string,
  reason: AdjustmentReason,
  refundValue: string | null,
  quantity = "1",
  chargeKept = true,
) {
  return withTransaction(db, (tx) =>
    recordAdjustment(tx, {
      workingOrderId,
      line: {
        id: randomUUID(),
        name: "Paella",
        quantity: "3",
        listUnitPriceGross: decimal("10.00"),
        creditedTo: WAITER,
        stage: "fired",
      },
      quantity,
      reason: { id: reason.id, name: reason.name, policy: policySnapshotOf(reason) },
      action: "cancel",
      percentBp: null,
      beforeAmount: decimal("10.00"),
      afterAmount: decimal("10.00"),
      reduction: decimal("0.00"),
      nominalValue: decimal("10.00"),
      requestedBy: WAITER,
      approvedBy: null,
      note: null,
      chargeKept,
      preparationStarted: false,
      refundHandoff: refundValue !== null,
      refundValue: refundValue === null ? null : decimal(refundValue),
    }),
  );
}

let venue: SeededVenue | undefined;

/** A €5.50 cash refund in `state` of a sale numbered `invoiceNumber`, at one venue per test. */
async function refund(state: "pending" | "completed" | "failed", invoiceNumber: number) {
  venue ??= await seedVenue(db);
  const sale = await seedRefundableSale(db, venue, {
    method: "cash",
    applied: "20.00",
    tip: "0.00",
    at: AT,
    invoiceNumber,
  });
  return seedTenderRefund(db, sale, {
    applied: "5.50",
    tip: "0.00",
    state,
    createdAt: AT,
    at: state === "pending" ? null : AT,
  });
}

function read(ids: readonly string[]) {
  return withTransaction(db, (tx) => readCancelsForRefund(tx, ids));
}

function link(tenderRefundId: string, links: { adjustmentId: string; amount: string }[]) {
  return withTransaction(db, (tx) =>
    linkRefundToCancels(tx, {
      tenderRefundId,
      links: links.map((l) => ({ adjustmentId: l.adjustmentId, amount: decimal(l.amount) })),
    }),
  );
}

function linkedOf(rows: { id: string; linked: string }[]) {
  return Object.fromEntries(rows.map((r) => [r.id, r.linked]));
}

describe("the link from a refund to its cancels", () => {
  it("links a refund to two cancels and reads what each holds", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedVoidReason(db);
    const first = await cancel(order, reason, "3.00");
    const second = await cancel(order, reason, "2.50");
    const refundId = await refund("pending", 1);
    expect(linkedOf(await read([first, second]))).toEqual({ [first]: "0.00", [second]: "0.00" });
    await link(refundId, [
      { adjustmentId: first, amount: "3.00" },
      { adjustmentId: second, amount: "2.50" },
    ]);
    expect(linkedOf(await read([first, second]))).toEqual({ [first]: "3.00", [second]: "2.50" });

    await db.execute(
      sql`update tender_refunds set state = 'failed', failed_at = ${AT} where id = ${refundId}`,
    );
    expect(linkedOf(await read([first, second]))).toEqual({ [first]: "0.00", [second]: "0.00" });

    const completed = await refund("completed", 2);
    await link(completed, [{ adjustmentId: first, amount: "1.00" }]);
    expect(linkedOf(await read([first, second]))).toEqual({ [first]: "1.00", [second]: "0.00" });

    const another = await refund("pending", 3);
    await link(another, [{ adjustmentId: first, amount: "0.50" }]);
    expect(linkedOf(await read([first, second]))).toEqual({ [first]: "1.50", [second]: "0.00" });
  });

  it("linking no cancels writes nothing", async () => {
    const refundId = await refund("completed", 1);
    await link(refundId, []);
    const rows = await db.execute<{ n: number }>(sql`select count(*) as n from adjustment_refunds`);
    expect(rows.rows).toEqual([{ n: 0 }]);
  });

  it("refuses a link of nothing", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedVoidReason(db);
    const cancelId = await cancel(order, reason, "3.00");
    const refundId = await refund("completed", 1);
    const zero = await captureError(() =>
      link(refundId, [{ adjustmentId: cancelId, amount: "0.00" }]),
    );
    expect(checkFailed(zero, "adjustment_refunds_amount_ck")).toBe(true);
  });

  it("reads each cancel's stored refund value", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedVoidReason(db);
    const handed = await cancel(order, reason, "3.33", "1");
    const kept = await cancel(order, reason, null, "2", false);
    const rows = await read([handed, kept]);
    expect(rows.find((r) => r.id === handed)).toMatchObject({
      workingOrderId: order,
      quantity: "1.000",
      action: "cancel",
      chargeKept: true,
      refundHandoff: true,
      refundValue: "3.33",
    });
    expect(rows.find((r) => r.id === kept)).toMatchObject({
      workingOrderId: order,
      quantity: "2.000",
      chargeKept: false,
      refundHandoff: false,
      refundValue: null,
    });
    expect(rows.map((r) => typeof r.lineId)).toEqual(["string", "string"]);

    const billDiscount = await withTransaction(db, (tx) =>
      recordAdjustment(tx, {
        workingOrderId: order,
        line: null,
        quantity: null,
        reason: { id: reason.id, name: reason.name, policy: policySnapshotOf(reason) },
        action: "discount_amount",
        percentBp: null,
        beforeAmount: decimal("20.00"),
        afterAmount: decimal("15.00"),
        reduction: decimal("5.00"),
        nominalValue: decimal("5.00"),
        requestedBy: WAITER,
        approvedBy: null,
        note: null,
      }),
    );
    expect(await read([billDiscount])).toMatchObject([{ lineId: null, quantity: null }]);
    expect(await read([randomUUID()])).toEqual([]);
  });

  it("refuses an update and a delete of a link", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedVoidReason(db);
    const cancelId = await cancel(order, reason, "3.00");
    const refundId = await refund("completed", 1);
    await link(refundId, [{ adjustmentId: cancelId, amount: "3.00" }]);
    const update = await captureError(() =>
      db.execute(sql`update adjustment_refunds set amount = 1 where adjustment_id = ${cancelId}`),
    );
    expect(triggerRaised(update, "adjustment_refunds is append-only")).toBe(true);
    const remove = await captureError(() =>
      db.execute(sql`delete from adjustment_refunds where adjustment_id = ${cancelId}`),
    );
    expect(triggerRaised(remove, "adjustment_refunds is append-only")).toBe(true);
  });

  it("refuses the same cancel linked twice to one refund", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedVoidReason(db);
    const cancelId = await cancel(order, reason, "3.00");
    const refundId = await refund("completed", 1);
    await link(refundId, [{ adjustmentId: cancelId, amount: "1.00" }]);
    const twice = await captureError(() =>
      link(refundId, [{ adjustmentId: cancelId, amount: "2.00" }]),
    );
    expect(isRefusal(twice, UNIQUE_VIOLATION)).toBe(true);
    expect(engineErrorMessage(twice)).toContain(
      "adjustment_refunds.adjustment_id, adjustment_refunds.tender_refund_id",
    );
  });
});
