import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  adjustmentLines,
  adjustments,
  computeAdjustmentReport,
  workOutBillDiscounts,
  type WorkedBill,
} from "@waitron/adjustments";
import {
  activityLog,
  billDiscounts,
  menus,
  sales,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError, decimalToCents, stringToCents } from "@waitron/shared";
import {
  crystalliseBillDiscounts,
  refuseDiscountsNotHolding,
} from "./bill-discounts-crystallise.js";
import { gatherBillDiscountInputs, readBillDiscounts } from "./bill-discounts-read.js";
import { currentBusinessDay, resolveVenueClock } from "@waitron/reporting";
import { receiptLines } from "./receipt-adjustments.js";
import { priceStoredOrder, readStoredOrder, storedOrderTotal } from "./stored-order-lines.js";
import { holdDiscount } from "./testing/bill-discounts.js";
import { observedPaymentBody } from "./testing/bill-payment-fixture.js";
import { send } from "./testing/bill-venue.js";
import {
  billWith,
  inTx,
  lineIdOf,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
  type RoundLine,
} from "./testing/adjustment-venue.js";
import { splitLinesWithinOrder } from "./working-order-transfer.js";

let venue: AdjustmentVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
  },
});

const tenPercent = { action: "discount_percent", percentBp: 1000, amount: null } as const;
const amountOf = (amount: number) =>
  ({ action: "discount_amount", percentBp: null, amount }) as const;

interface LineState {
  lineNo: number;
  quantity: number;
  unit: number;
  total: number;
}

async function linesOf(tx: Transaction, billId: string): Promise<LineState[]> {
  return tx
    .select({
      lineNo: workingOrderLines.lineNo,
      quantity: workingOrderLines.quantity,
      unit: workingOrderLines.unitPriceGross,
      total: workingOrderLines.lineTotal,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(asc(workingOrderLines.lineNo));
}

/** Every line's rows once all of `worked`'s discounts are written, as PR 1 simulates them. */
function simulated(before: readonly (LineState & { id: string })[], worked: WorkedBill) {
  const rowsOf = new Map<string, LineState[]>(before.map(({ id, ...line }) => [id, [{ ...line }]]));
  for (const discount of worked.discounts) {
    for (const { lineId, rows } of discount.lines) {
      rowsOf.set(
        lineId,
        rows.map(({ lineNo, quantity, unit, total }) => ({ lineNo, quantity, unit, total })),
      );
    }
  }
  return [...rowsOf.values()].flat().sort((a, b) => a.lineNo - b.lineNo);
}

async function withIds(tx: Transaction, billId: string) {
  return tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      quantity: workingOrderLines.quantity,
      unit: workingOrderLines.unitPriceGross,
      total: workingOrderLines.lineTotal,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(asc(workingOrderLines.lineNo));
}

async function workedNow(tx: Transaction, billId: string): Promise<WorkedBill> {
  const input = (await gatherBillDiscountInputs(tx, [billId])).get(billId)!;
  return workOutBillDiscounts(input.lines, input.discounts);
}

/** What the bill's adjustment records took off, summed once from the records and once from their
 * adjustment lines. A later split copies a line's adjustment lines to its part, each copy keeping
 * the quantity it was taken over, so each line counts the share its quantity now holds. */
async function recordedTakes(
  tx: Transaction,
  billId: string,
): Promise<{ records: number; lines: number }> {
  const [row] = await tx
    .select({ taken: sql<number>`coalesce(sum(${adjustments.reduction}), 0)` })
    .from(adjustments)
    .where(eq(adjustments.workingOrderId, billId));
  const lines = await tx
    .select({
      reduction: adjustmentLines.reduction,
      then: adjustmentLines.quantity,
      now: workingOrderLines.quantity,
    })
    .from(adjustmentLines)
    .innerJoin(adjustments, eq(adjustments.id, adjustmentLines.adjustmentId))
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, adjustmentLines.lineId))
    .where(eq(adjustments.workingOrderId, billId));
  const shares = lines.reduce((sum, { reduction, then, now }) => sum + (reduction * now) / then, 0);
  expect(Math.abs(shares - Math.round(shares))).toBeLessThan(1e-6);
  return { records: row!.taken, lines: Math.round(shares) };
}

/** What the bill's receipt prints as taken off, under its lines and on the whole bill. */
async function receiptTakes(tx: Transaction, billId: string): Promise<number> {
  const stored = await readStoredOrder(tx, billId);
  const receipt = await receiptLines(tx, billId, stored.gross, stored.identities);
  return [
    ...receipt.lines.flatMap((line) => line.adjustments ?? []),
    ...(receipt.billAdjustments ?? []),
  ].reduce((sum, { amount }) => sum + stringToCents(amount), 0);
}

async function adjustmentsOn(tx: Transaction, billId: string) {
  return tx
    .select({
      id: adjustments.id,
      lineId: adjustments.lineId,
      action: adjustments.action,
      reduction: adjustments.reduction,
      reasonId: adjustments.reasonId,
      requestedBy: adjustments.requestedBy,
      note: adjustments.note,
    })
    .from(adjustments)
    .where(eq(adjustments.workingOrderId, billId))
    .orderBy(asc(adjustments.createdAt), asc(adjustments.id));
}

/** Each adjustment record's before and after amounts and what it took off, in cents. */
async function recordAmounts(tx: Transaction, billId: string) {
  return tx
    .select({
      before: adjustments.beforeAmount,
      after: adjustments.afterAmount,
      reduction: adjustments.reduction,
    })
    .from(adjustments)
    .where(eq(adjustments.workingOrderId, billId))
    .orderBy(asc(adjustments.createdAt), asc(adjustments.id));
}

async function pendingOn(tx: Transaction, billId: string) {
  const lines = tx
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId));
  return tx
    .select({ id: billDiscounts.id, lineId: billDiscounts.lineId, amount: billDiscounts.amount })
    .from(billDiscounts)
    .where(sql`${billDiscounts.workingOrderId} = ${billId} or ${billDiscounts.lineId} in ${lines}`);
}

/** A bill of one stored line per entry, line 1's price set to `unit` cents when given. */
async function groupedBill(lines: RoundLine[], unit?: number): Promise<string> {
  const { billId } = await billWith(venue, lines, { shape: "grouped" });
  if (unit !== undefined) {
    const id = await lineIdOf(venue, billId, 1);
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({
          unitPriceGross: unit,
          lineTotal: sql`${unit} * ${workingOrderLines.quantity} / 1000`,
        })
        .where(eq(workingOrderLines.id, id)),
    );
  }
  return billId;
}

/** What the bill's receipt prints its lines at, together. */
async function receiptCharges(tx: Transaction, billId: string): Promise<number> {
  const stored = await readStoredOrder(tx, billId);
  const receipt = await receiptLines(tx, billId, stored.gross, stored.identities);
  return receipt.lines.reduce((sum, { gross }) => sum + stringToCents(gross), 0);
}

/**
 * Crystallises the bill's discounts and checks the three figures agree: what the shown total takes
 * off, what the stored total fell by, and what the written adjustment lines took; and that the
 * lines are left as PR 1 simulated them, split rows' numbers included. The receipt prints the same
 * off, or `receipt` where the rows it lists add up only to that.
 */
async function crystallisesAsShown(
  billId: string,
  asked = true,
  receipt?: number,
): Promise<number> {
  return inTx(venue, async (tx) => {
    const shown = (await readBillDiscounts(tx, [billId])).get(billId)!.takes;
    const expected = simulated(await withIds(tx, billId), await workedNow(tx, billId));
    const before = decimalToCents((await priceStoredOrder(tx, billId)).total);
    const owedBefore = decimalToCents(await storedOrderTotal(tx, billId));
    await crystalliseBillDiscounts(tx, venue.cfg, billId, { asked });
    const after = decimalToCents((await priceStoredOrder(tx, billId)).total);
    expect(shown).toBeGreaterThan(0);
    expect(before - after).toBe(shown);
    expect(owedBefore).toBe(before - shown);
    expect(decimalToCents(await storedOrderTotal(tx, billId))).toBe(owedBefore);
    expect(await recordedTakes(tx, billId)).toEqual({ records: shown, lines: shown });
    expect(await receiptTakes(tx, billId)).toBe(receipt ?? shown);
    expect(await receiptCharges(tx, billId)).toBe(after);
    expect(await linesOf(tx, billId)).toEqual(expected);
    return shown;
  });
}

/** Two bound pizzas at 0.00, each with 0.125 of olives at `olives` cents a kilo, which the invoice
 * files as one row of 0.250. */
async function measuredExtras(olives: number): Promise<string> {
  const { billId } = await billWith(venue, [{ name: "Pizza", quantity: "2", olives: 1 }]);
  await inTx(venue, async (tx) => {
    const onBill = eq(workingOrderLines.workingOrderId, billId);
    await tx
      .update(workingOrderLines)
      .set({ unitPriceGross: 0, lineTotal: 0 })
      .where(and(onBill, sql`${workingOrderLines.parentLineId} is null`));
    await tx
      .update(workingOrderLines)
      .set({
        unitPriceGross: olives,
        quantity: 125,
        unitPrecision: 3,
        lineTotal: Math.round((olives * 125) / 1000),
      })
      .where(and(onBill, sql`${workingOrderLines.parentLineId} is not null`));
  });
  return billId;
}

/** The first extra on `billId`. */
async function firstExtraOf(billId: string): Promise<string> {
  const [extra] = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(
        and(
          eq(workingOrderLines.workingOrderId, billId),
          sql`${workingOrderLines.parentLineId} is not null`,
        ),
      )
      .orderBy(asc(workingOrderLines.lineNo)),
  );
  return extra!.id;
}

const allOff = { action: "discount_percent", percentBp: 10000, amount: null } as const;

describe("crystalliseBillDiscounts", () => {
  it("writes into a bill with a weighed line what its shown total takes off", async () => {
    const billId = await groupedBill([
      { name: "Ham", quantity: "0.512" },
      { name: "Fish", quantity: "0.333" },
      { name: "Bread" },
    ]);
    await inTx(venue, (tx) => holdDiscount(tx, venue, { workingOrderId: billId, ...tenPercent }));
    await crystallisesAsShown(billId);
  });

  it("writes a discount that leaves a row of several units at two prices", async () => {
    const billId = await groupedBill([{ name: "Croquettes", quantity: "3" }, { name: "Bread" }]);
    const croquettes = await lineIdOf(venue, billId, 1);
    await inTx(venue, (tx) => holdDiscount(tx, venue, { lineId: croquettes, ...tenPercent }));
    await crystallisesAsShown(billId);
    const lines = await inTx(venue, (tx) => linesOf(tx, billId));
    // The croquettes' line was split in two prices, the lower one numbered after the bread.
    expect(lines.map(({ lineNo }) => lineNo)).toEqual([1, 2, 3]);
    expect(new Set(lines.filter(({ lineNo }) => lineNo !== 2).map(({ unit }) => unit)).size).toBe(
      2,
    );
  });

  it("writes a whole-bill discount over portions the invoice files as one row", async () => {
    const { billId } = await billWith(venue, [
      { name: "Croquettes", quantity: "3" },
      { name: "Tortilla", quantity: "2" },
    ]);
    await inTx(venue, (tx) => holdDiscount(tx, venue, { workingOrderId: billId, ...tenPercent }));
    await crystallisesAsShown(billId);
  });

  it.each([
    // Each extra's own total stays 1.25, but the filed row falls from 2.51 to 2.50.
    [
      1003,
      "records the cent a filed row of two measured extras loses, though neither extra's own total does",
    ],
    // Each extra's own total falls from 1.26 to 1.25, but the filed row only from 2.51 to 2.50.
    [
      1004,
      "records only the cent a filed row of two measured extras loses, though each extra's own total loses one",
    ],
  ])("at %i, %s", async (olives) => {
    // 0.01 off the bill leaves the olives at 10.01.
    const billId = await measuredExtras(olives);
    await inTx(venue, (tx) => holdDiscount(tx, venue, { workingOrderId: billId, ...amountOf(1) }));
    expect(await crystallisesAsShown(billId)).toBe(1);
    const written = await inTx(venue, (tx) => adjustmentsOn(tx, billId));
    expect(written.map(({ reduction }) => reduction)).toEqual([1]);
  });

  // Each extra stores 1.25, but their filed row is 2.51: all off one extra takes 1.26 off the
  // invoice, more than that extra's own 1.25. Filed apart, the two list at 2.50 together, so the
  // receipt prints the 1.25 that adds up against them.
  it("writes all off one of two measured extras filed as one row, which takes more than the extra's own total", async () => {
    const billId = await measuredExtras(1003);
    const extra = await firstExtraOf(billId);
    await inTx(venue, (tx) => holdDiscount(tx, venue, { lineId: extra, ...allOff }));
    await inTx(venue, async (tx) => {
      expect(decimalToCents(await storedOrderTotal(tx, billId))).toBe(125);
      await refuseDiscountsNotHolding(tx, billId);
    });
    expect(await crystallisesAsShown(billId, true, 125)).toBe(126);
    expect(await inTx(venue, (tx) => recordAmounts(tx, billId))).toEqual([
      { before: 126, after: 0, reduction: 126 },
    ]);
  });

  it("writes all off a bill of two measured extras filed as one row, taking the filed row's 2.51", async () => {
    const billId = await measuredExtras(1003);
    await inTx(venue, (tx) => holdDiscount(tx, venue, { workingOrderId: billId, ...allOff }));
    expect(await crystallisesAsShown(billId)).toBe(251);
    expect(await inTx(venue, (tx) => recordAmounts(tx, billId))).toEqual([
      { before: 251, after: 0, reduction: 251 },
    ]);
  });

  it("takes cash for what is left after all off one of two measured extras, filing and recording 1.26 off", async () => {
    const billId = await measuredExtras(1003);
    const extra = await firstExtraOf(billId);
    await inTx(venue, (tx) => holdDiscount(tx, venue, { lineId: extra, ...allOff }));
    const path = `/api/working-orders/${billId}/payments`;
    const body = await observedPaymentBody(venue.db, path, {
      kind: "contribution",
      method: "cash",
      amount: "1.25",
      tendered: "1.25",
      applied: "1.25",
      tip: "0.00",
      submissionId: randomUUID(),
    });
    const paid = await send(venue.app, venue.cookie.manager, "POST", path, body);
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    await inTx(venue, async (tx) => {
      const filed = await tx
        .select({ total: sales.total })
        .from(sales)
        .where(eq(sales.workingOrderId, billId));
      expect(filed).toEqual([{ total: 125 }]);
      expect(await receiptTakes(tx, billId)).toBe(125);
      expect(await receiptCharges(tx, billId)).toBe(125);
      expect(await recordedTakes(tx, billId)).toEqual({ records: 126, lines: 126 });
      expect(await recordAmounts(tx, billId)).toEqual([{ before: 126, after: 0, reduction: 126 }]);
    });
  });

  it("writes 10% then 1.00 off one line of three beers as PR 1 works them out, line by line", async () => {
    const billId = await groupedBill([{ name: "Draught beer", quantity: "3" }], 335);
    const beers = await lineIdOf(venue, billId, 1);
    await inTx(venue, async (tx) => {
      await holdDiscount(tx, venue, { lineId: beers, ...tenPercent, position: 1 });
      await holdDiscount(tx, venue, { lineId: beers, ...amountOf(100), position: 2 });
    });
    const worked = await inTx(venue, (tx) => workedNow(tx, billId));
    // The 10% leaves the beers at two prices, so the 1.00 is worked out on both parts.
    expect(worked.discounts[0]!.lines[0]!.rows).toHaveLength(2);
    const shown = await crystallisesAsShown(billId);
    expect(shown).toBe(worked.takes);
  });

  it("writes 15.73 then 1.02 off five beers at 3.35 as shown, refusing nothing and noting nothing", async () => {
    const billId = await groupedBill([{ name: "Draught beer", quantity: "5" }], 335);
    const beers = await lineIdOf(venue, billId, 1);
    await inTx(venue, async (tx) => {
      await holdDiscount(tx, venue, { lineId: beers, ...amountOf(1573), position: 1 });
      await holdDiscount(tx, venue, { lineId: beers, ...amountOf(102), position: 2 });
    });
    const worked = await inTx(venue, (tx) => workedNow(tx, billId));
    expect(worked.discounts.map(({ holds }) => holds)).toEqual(["yes", "yes"]);
    // The beers' whole 16.75: no beer is left at 0.01.
    expect(await crystallisesAsShown(billId)).toBe(1675);
    const totals = (await inTx(venue, (tx) => linesOf(tx, billId))).map(({ total }) => total);
    expect(totals).toEqual(totals.map(() => 0));
    const entries = await inTx(venue, (tx) =>
      tx.select().from(activityLog).where(eq(activityLog.subjectId, billId)),
    );
    expect(entries).toEqual([]);
  });

  it.each([
    [1572, 103],
    [1568, 107],
    [1567, 108],
    [1573, 103],
    [1573, 107],
    [1573, 108],
  ])("writes %i then %i off five beers at 3.35 as shown", async (first, second) => {
    const billId = await groupedBill([{ name: "Draught beer", quantity: "5" }], 335);
    const beers = await lineIdOf(venue, billId, 1);
    await inTx(venue, async (tx) => {
      await holdDiscount(tx, venue, { lineId: beers, ...amountOf(first), position: 1 });
      await holdDiscount(tx, venue, { lineId: beers, ...amountOf(second), position: 2 });
    });
    const worked = await inTx(venue, (tx) => workedNow(tx, billId));
    const holding = worked.discounts.every(({ holds }) => holds === "yes");
    expect(await crystallisesAsShown(billId, holding)).toBe(worked.takes);
  });

  it("records one discount once, though an earlier one split its line", async () => {
    const billId = await groupedBill([{ name: "Draught beer", quantity: "3" }], 335);
    const beers = await lineIdOf(venue, billId, 1);
    await inTx(venue, async (tx) => {
      await holdDiscount(tx, venue, { lineId: beers, ...tenPercent, position: 1 });
      await holdDiscount(tx, venue, { lineId: beers, ...amountOf(100), position: 2 });
    });
    const report = () =>
      inTx(venue, async (tx) => {
        const clock = await resolveVenueClock(tx, venue.cfg.nodeId);
        const day = currentBusinessDay(clock);
        return (
          await computeAdjustmentReport(tx, { ...clock, fromBusinessDay: day, toBusinessDay: day })
        ).overall.count;
      });
    const counted = await report();
    await crystallisesAsShown(billId);
    const written = await inTx(venue, (tx) => adjustmentsOn(tx, billId));
    // Records written in one millisecond share a time, so their order is not compared.
    expect(written.map(({ action, reduction }) => ({ action, reduction }))).toEqual(
      expect.arrayContaining([
        { action: "discount_percent", reduction: 101 },
        { action: "discount_amount", reduction: 100 },
      ]),
    );
    expect(written).toHaveLength(2);
    expect(written.map(({ lineId }) => lineId)).toEqual([beers, beers]);
    expect((await report()) - counted).toBe(2);
  });

  it("leaves no pending row and writes nothing more when called again", async () => {
    const billId = await groupedBill([{ name: "Croquettes", quantity: "3" }, { name: "Bread" }]);
    const croquettes = await lineIdOf(venue, billId, 1);
    await inTx(venue, async (tx) => {
      await holdDiscount(tx, venue, { lineId: croquettes, ...tenPercent, position: 1 });
      await holdDiscount(tx, venue, { lineId: croquettes, ...amountOf(50), position: 2 });
      await holdDiscount(tx, venue, { workingOrderId: billId, ...amountOf(100), position: 3 });
    });
    await crystallisesAsShown(billId);
    const first = await inTx(venue, async (tx) => ({
      pending: await pendingOn(tx, billId),
      written: await adjustmentsOn(tx, billId),
      lines: await linesOf(tx, billId),
    }));
    expect(first.pending).toEqual([]);
    expect(first.written.length).toBeGreaterThanOrEqual(3);
    await inTx(venue, (tx) => crystalliseBillDiscounts(tx, venue.cfg, billId, { asked: true }));
    const second = await inTx(venue, async (tx) => ({
      written: await adjustmentsOn(tx, billId),
      lines: await linesOf(tx, billId),
    }));
    expect(second.written).toEqual(first.written);
    expect(second.lines).toEqual(first.lines);
  });

  it.each([
    ["0.01% off a beer at 3.35", 335, 1],
    ["10% off a line costing one cent", 1, 1000],
  ])(
    "records %s, which takes nothing, once, with nothing off and no price moved",
    async (_, unit, percentBp) => {
      const billId = await groupedBill([{ name: "Draught beer" }], unit);
      const beer = await lineIdOf(venue, billId, 1);
      await inTx(venue, (tx) =>
        holdDiscount(tx, venue, { lineId: beer, action: "discount_percent", percentBp }),
      );
      const before = await inTx(venue, (tx) => linesOf(tx, billId));
      expect((await inTx(venue, (tx) => workedNow(tx, billId))).discounts).toMatchObject([
        { holds: "yes", takes: 0 },
      ]);
      await inTx(venue, (tx) => crystalliseBillDiscounts(tx, venue.cfg, billId, { asked: true }));
      const after = await inTx(venue, async (tx) => ({
        pending: await pendingOn(tx, billId),
        written: await adjustmentsOn(tx, billId),
        lines: await linesOf(tx, billId),
        taken: await recordedTakes(tx, billId),
      }));
      expect(after.pending).toEqual([]);
      expect(after.written).toMatchObject([
        { lineId: beer, action: "discount_percent", reduction: 0 },
      ]);
      expect(after.taken).toEqual({ records: 0, lines: 0 });
      expect(after.lines).toEqual(before);
    },
  );

  it("records each discount under the pending row's reason, people and note", async () => {
    const billId = await groupedBill([{ name: "Bread" }]);
    const bread = await lineIdOf(venue, billId, 1);
    await inTx(venue, (tx) =>
      holdDiscount(tx, venue, {
        lineId: bread,
        ...amountOf(50),
        reasonId: venue.reasonId.complaint,
        requestedBy: venue.supervisorId,
        approvedBy: venue.managerId,
        note: "Cold",
      }),
    );
    await inTx(venue, (tx) => crystalliseBillDiscounts(tx, venue.cfg, billId, { asked: true }));
    const [row] = await inTx(venue, (tx) =>
      tx.select().from(adjustments).where(eq(adjustments.workingOrderId, billId)),
    );
    expect(row).toMatchObject({
      lineId: bread,
      action: "discount_amount",
      reduction: 50,
      reasonId: venue.reasonId.complaint,
      requestedBy: venue.supervisorId,
      approvedBy: venue.managerId,
      note: "Cold",
    });
  });
});

/** A bill holding a set-menu discount whose set menu is gone, 50.00 off its 2.50 bread, and 10%
 * off its burger, which holds. */
async function notHolding() {
  const billId = await groupedBill([{ name: "Bread" }, { name: "Burger" }]);
  const bread = await lineIdOf(venue, billId, 1);
  const burger = await lineIdOf(venue, billId, 2);
  const [daily] = await inTx(venue, (tx) =>
    tx.insert(menus).values({ name: "Daily" }).returning({ id: menus.id }),
  );
  const held = await inTx(venue, async (tx) => ({
    setMenu: await holdDiscount(tx, venue, {
      workingOrderId: billId,
      setMenuId: daily!.id,
      setMenuName: "Daily",
      position: 1,
    }),
    bread: await holdDiscount(tx, venue, { lineId: bread, ...amountOf(5000), position: 2 }),
    burger: await holdDiscount(tx, venue, { lineId: burger, ...tenPercent, position: 3 }),
  }));
  return { billId, held };
}

function refusalFor(held: { setMenu: string; bread: string }) {
  return {
    code: "adjustment.no_longer_applies",
    params: {
      workingOrderId: expect.any(String) as string,
      discounts: expect.arrayContaining([
        {
          discountId: held.setMenu,
          why: "set_menu_gone",
          on: { kind: "set_menu", targetName: "Daily" },
          action: "discount_percent",
          percentBp: 1000,
          amount: null,
        },
        {
          discountId: held.bread,
          why: "cut_down",
          on: { kind: "dish", targetName: "Bread" },
          action: "discount_amount",
          percentBp: null,
          amount: "50.00",
        },
      ]) as unknown,
    },
  };
}

describe("discounts that no longer hold", () => {
  it("refuses, when asked, before anything is written", async () => {
    const { billId, held } = await notHolding();
    const seen = await inTx(venue, async (tx) => {
      const lines = await linesOf(tx, billId);
      const error = await crystalliseBillDiscounts(tx, venue.cfg, billId, { asked: true }).then(
        () => null,
        (refused: unknown) => refused,
      );
      return {
        error,
        lines,
        after: await linesOf(tx, billId),
        written: await adjustmentsOn(tx, billId),
        pending: await pendingOn(tx, billId),
      };
    });
    expect(seen.error).toBeInstanceOf(AppError);
    expect(seen.error).toMatchObject(refusalFor(held));
    expect((seen.error as AppError<"adjustment.no_longer_applies">).params.discounts).toHaveLength(
      2,
    );
    expect(seen.written).toEqual([]);
    expect(seen.pending).toHaveLength(3);
    expect(seen.after).toEqual(seen.lines);
  });

  it("writes each as it stood when not asked, with one activity entry each", async () => {
    const { billId, held } = await notHolding();
    await inTx(venue, (tx) => crystalliseBillDiscounts(tx, venue.cfg, billId, { asked: false }));
    const seen = await inTx(venue, async (tx) => ({
      lines: await linesOf(tx, billId),
      written: await adjustmentsOn(tx, billId),
      pending: await pendingOn(tx, billId),
      entries: await tx
        .select({ data: activityLog.data, personId: activityLog.personId })
        .from(activityLog)
        .where(
          and(
            eq(activityLog.kind, "discount.written_as_it_stood"),
            eq(activityLog.subjectId, billId),
          ),
        ),
    }));
    expect(seen.pending).toEqual([]);
    // The bread taken to nothing, the burger at 10% off; the set menu's took nothing.
    expect(seen.lines.map(({ total }) => total)).toEqual([0, 1080]);
    expect(seen.written.map(({ reduction }) => reduction).sort((a, b) => a - b)).toEqual([
      120, 250,
    ]);
    expect(seen.entries).toHaveLength(2);
    const given = {
      reasonId: venue.reasonId.complaint,
      reasonName: "Guest complaint",
      requestedBy: venue.staffId,
      approvedBy: null,
    };
    expect(seen.entries).toEqual(
      expect.arrayContaining([
        {
          personId: venue.staffId,
          data: {
            discountId: held.setMenu,
            why: "set_menu_gone",
            takes: "0.00",
            on: { kind: "set_menu", targetName: "Daily" },
            action: "discount_percent",
            percentBp: 1000,
            amount: null,
            ...given,
          },
        },
        {
          personId: venue.staffId,
          data: {
            discountId: held.bread,
            why: "cut_down",
            takes: "2.50",
            on: { kind: "dish", targetName: "Bread" },
            action: "discount_amount",
            percentBp: null,
            amount: "50.00",
            ...given,
          },
        },
      ]),
    );
  });
});

describe("refuseDiscountsNotHolding", () => {
  it("refuses the same discounts and writes nothing", async () => {
    const { billId, held } = await notHolding();
    await expect(inTx(venue, (tx) => refuseDiscountsNotHolding(tx, billId))).rejects.toMatchObject(
      refusalFor(held),
    );
  });

  it("names an extra and the whole bill a discount was given on", async () => {
    const billId = await groupedBill([{ name: "Pizza", olives: 1 }]);
    const olives = await lineIdOf(venue, billId, 2);
    const held = await inTx(venue, async (tx) => ({
      olives: await holdDiscount(tx, venue, { lineId: olives, ...amountOf(1000), position: 1 }),
      bill: await holdDiscount(tx, venue, {
        workingOrderId: billId,
        ...amountOf(100_000),
        position: 2,
      }),
    }));
    await expect(inTx(venue, (tx) => refuseDiscountsNotHolding(tx, billId))).rejects.toMatchObject({
      code: "adjustment.no_longer_applies",
      params: {
        workingOrderId: billId,
        discounts: [
          expect.objectContaining({
            discountId: held.olives,
            on: { kind: "extra", targetName: "Olives" },
          }) as unknown,
          expect.objectContaining({
            discountId: held.bill,
            on: { kind: "bill", targetName: null },
          }) as unknown,
        ],
      },
    });
  });

  it("passes a bill whose discounts hold, and one holding none", async () => {
    const billId = await groupedBill([{ name: "Bread" }]);
    const bare = await groupedBill([{ name: "Bread" }]);
    await inTx(venue, (tx) => holdDiscount(tx, venue, { workingOrderId: billId, ...tenPercent }));
    await inTx(venue, async (tx) => {
      await refuseDiscountsNotHolding(tx, billId);
      await refuseDiscountsNotHolding(tx, bare);
    });
    expect(await inTx(venue, (tx) => pendingOn(tx, billId))).toHaveLength(1);
  });
});

describe("a split line's pending discounts", () => {
  it("are asked about when a weighed line's parts together take less of an amount than was given", async () => {
    // 4 kg at 1.00 with 0.04 off takes 0.04 at 0.99; split into 2.5 and 1.5 kg, the shares 0.03
    // and 0.01 can only take 0.02 and 0.01 at whole-cent prices.
    const billId = await groupedBill([{ name: "Fish", quantity: "4" }], 100);
    const fish = await lineIdOf(venue, billId, 1);
    const id = await inTx(venue, (tx) => holdDiscount(tx, venue, { lineId: fish, ...amountOf(4) }));
    expect((await inTx(venue, (tx) => workedNow(tx, billId))).takes).toBe(4);
    await inTx(venue, (tx) => refuseDiscountsNotHolding(tx, billId));
    await inTx(venue, (tx) =>
      splitLinesWithinOrder(tx, venue.cfg, billId, [{ lineNo: 1, quantity: "1.5" }]),
    );
    const shares = await inTx(venue, (tx) => pendingOn(tx, billId));
    expect(shares.map(({ amount }) => amount).sort()).toEqual([1, 3]);
    expect((await inTx(venue, (tx) => workedNow(tx, billId))).takes).toBe(3);
    await expect(inTx(venue, (tx) => refuseDiscountsNotHolding(tx, billId))).rejects.toMatchObject({
      code: "adjustment.no_longer_applies",
      params: {
        workingOrderId: billId,
        discounts: expect.arrayContaining(
          shares.map(({ id: discountId }) =>
            expect.objectContaining({ discountId, why: "cut_down" }),
          ),
        ) as unknown,
      },
    });
    expect(shares.map(({ id: discountId }) => discountId)).toContain(id);
    await expect(
      inTx(venue, (tx) => crystalliseBillDiscounts(tx, venue.cfg, billId, { asked: true })),
    ).rejects.toMatchObject({ code: "adjustment.no_longer_applies" });
    expect(await inTx(venue, (tx) => pendingOn(tx, billId))).toHaveLength(2);
  });

  it("are asked about when a split leaves the whole of an amount on a weighed part that cannot take it", async () => {
    // 1.5 kg at 1.02 with 0.01 off shows 1.52. Split 0.2 kg off, the cent stays on the 1.3 kg,
    // which whole-cent prices cannot take one cent off, and the 0.2 kg holds no share.
    const billId = await groupedBill([{ name: "Fish", quantity: "1.5" }], 102);
    const fish = await lineIdOf(venue, billId, 1);
    const id = await inTx(venue, (tx) => holdDiscount(tx, venue, { lineId: fish, ...amountOf(1) }));
    await inTx(venue, async (tx) => {
      expect(decimalToCents(await storedOrderTotal(tx, billId))).toBe(152);
      await refuseDiscountsNotHolding(tx, billId);
      await splitLinesWithinOrder(tx, venue.cfg, billId, [{ lineNo: 1, quantity: "0.2" }]);
    });
    await inTx(venue, async (tx) => {
      expect(await pendingOn(tx, billId)).toEqual([{ id, lineId: fish, amount: 1 }]);
      expect((await readBillDiscounts(tx, [billId])).get(billId)).toEqual({
        discounts: [expect.objectContaining({ id, holds: "cut_down", takes: 0 })],
        takes: 0,
      });
    });
    await expect(inTx(venue, (tx) => refuseDiscountsNotHolding(tx, billId))).rejects.toMatchObject({
      code: "adjustment.no_longer_applies",
      params: {
        workingOrderId: billId,
        discounts: [
          {
            discountId: id,
            why: "cut_down",
            on: { kind: "dish", targetName: "Fish" },
            action: "discount_amount",
            percentBp: null,
            amount: "0.01",
          },
        ],
      },
    });
  });

  it("pass when a split leaves the whole of an amount on a part that still takes it", async () => {
    // 0.01 off two beers at 3.35: split one off, the cent stays on the first, which takes it.
    const billId = await groupedBill([{ name: "Draught beer", quantity: "2" }], 335);
    const beers = await lineIdOf(venue, billId, 1);
    const id = await inTx(venue, (tx) =>
      holdDiscount(tx, venue, { lineId: beers, ...amountOf(1) }),
    );
    await inTx(venue, (tx) =>
      splitLinesWithinOrder(tx, venue.cfg, billId, [{ lineNo: 1, quantity: "1" }]),
    );
    await inTx(venue, async (tx) => {
      expect(await pendingOn(tx, billId)).toEqual([{ id, lineId: beers, amount: 1 }]);
      expect((await readBillDiscounts(tx, [billId])).get(billId)!.discounts).toMatchObject([
        { id, holds: "yes", takes: 1 },
      ]);
      await refuseDiscountsNotHolding(tx, billId);
    });
    expect(await crystallisesAsShown(billId)).toBe(1);
  });

  it("are read as not holding by the shown total's read, which Pay refuses, its total unchanged", async () => {
    const billId = await groupedBill([{ name: "Fish", quantity: "4" }], 100);
    const fish = await lineIdOf(venue, billId, 1);
    await inTx(venue, (tx) => holdDiscount(tx, venue, { lineId: fish, ...amountOf(4) }));
    await inTx(venue, (tx) =>
      splitLinesWithinOrder(tx, venue.cfg, billId, [{ lineNo: 1, quantity: "1.5" }]),
    );
    const shown = await inTx(venue, async (tx) =>
      (await readBillDiscounts(tx, [billId])).get(billId)!,
    );
    expect(shown.discounts.map(({ holds }) => holds)).toEqual(["cut_down", "cut_down"]);
    expect(shown.takes).toBe(3);
    await expect(inTx(venue, (tx) => refuseDiscountsNotHolding(tx, billId))).rejects.toMatchObject({
      code: "adjustment.no_longer_applies",
    });
  });

  it("are written as one discount, counted once, with what it takes off each line", async () => {
    const billId = await groupedBill([{ name: "Draught beer", quantity: "3" }], 335);
    const beers = await lineIdOf(venue, billId, 1);
    await inTx(venue, (tx) => holdDiscount(tx, venue, { lineId: beers, ...amountOf(99) }));
    const part = (
      await inTx(venue, (tx) =>
        splitLinesWithinOrder(tx, venue.cfg, billId, [{ lineNo: 1, quantity: "1" }]),
      )
    ).get(beers)!.id;
    expect(await inTx(venue, (tx) => pendingOn(tx, billId))).toHaveLength(2);
    const report = () =>
      inTx(venue, async (tx) => {
        const clock = await resolveVenueClock(tx, venue.cfg.nodeId);
        const day = currentBusinessDay(clock);
        return (
          await computeAdjustmentReport(tx, { ...clock, fromBusinessDay: day, toBusinessDay: day })
        ).overall.count;
      });
    const counted = await report();
    expect(await crystallisesAsShown(billId)).toBe(99);
    const written = await inTx(venue, (tx) => adjustmentsOn(tx, billId));
    expect(written).toMatchObject([{ lineId: beers, action: "discount_amount", reduction: 99 }]);
    const taken = await inTx(venue, (tx) =>
      tx
        .select({ lineId: adjustmentLines.lineId, reduction: adjustmentLines.reduction })
        .from(adjustmentLines)
        .where(eq(adjustmentLines.adjustmentId, written[0]!.id)),
    );
    expect(new Map(taken.map(({ lineId, reduction }) => [lineId, reduction]))).toEqual(
      new Map([
        [beers, 66],
        [part, 33],
      ]),
    );
    expect((await report()) - counted).toBe(1);
  });

  it("are copied to the new part, an amount shared by quantity, the cent on the earlier part", async () => {
    const billId = await groupedBill([{ name: "Draught beer", quantity: "3" }], 335);
    const beers = await lineIdOf(venue, billId, 1);
    await inTx(venue, async (tx) => {
      await holdDiscount(tx, venue, { lineId: beers, ...tenPercent, position: 1 });
      await holdDiscount(tx, venue, { lineId: beers, ...amountOf(100), position: 2 });
    });
    const before = await inTx(venue, (tx) => workedNow(tx, billId));
    const split = await inTx(venue, (tx) =>
      splitLinesWithinOrder(tx, venue.cfg, billId, [{ lineNo: 1, quantity: "1" }]),
    );
    const part = split.get(beers)!.id;
    const held = await inTx(venue, (tx) =>
      tx
        .select({
          lineId: billDiscounts.lineId,
          action: billDiscounts.action,
          percentBp: billDiscounts.percentBp,
          amount: billDiscounts.amount,
          position: billDiscounts.position,
        })
        .from(billDiscounts)
        .where(sql`${billDiscounts.lineId} in (${beers}, ${part})`)
        .orderBy(asc(billDiscounts.position), asc(billDiscounts.amount)),
    );
    // Line 1 keeps two beers and the cent left over: 0.67; the new part, one beer, 0.33.
    expect(held).toEqual([
      { lineId: beers, action: "discount_percent", percentBp: 1000, amount: null, position: 1 },
      { lineId: part, action: "discount_percent", percentBp: 1000, amount: null, position: 1 },
      { lineId: part, action: "discount_amount", percentBp: null, amount: 33, position: 2 },
      { lineId: beers, action: "discount_amount", percentBp: null, amount: 67, position: 2 },
    ]);
    const after = await inTx(venue, (tx) => workedNow(tx, billId));
    expect(after.takes).toBe(before.takes);
  });

  it.each([
    [1573, 102],
    [1572, 103],
    [1568, 107],
    [1567, 108],
  ])(
    "keep what %i then %i off five beers at 3.35 take, and both still hold, when one beer is split off",
    async (first, second) => {
      const billId = await groupedBill([{ name: "Draught beer", quantity: "5" }], 335);
      const beers = await lineIdOf(venue, billId, 1);
      await inTx(venue, async (tx) => {
        await holdDiscount(tx, venue, { lineId: beers, ...amountOf(first), position: 1 });
        await holdDiscount(tx, venue, { lineId: beers, ...amountOf(second), position: 2 });
      });
      const before = await inTx(venue, (tx) => workedNow(tx, billId));
      await inTx(venue, (tx) =>
        splitLinesWithinOrder(tx, venue.cfg, billId, [{ lineNo: 1, quantity: "1" }]),
      );
      const after = await inTx(venue, (tx) => workedNow(tx, billId));
      expect(before.discounts.map(({ holds }) => holds)).toEqual(["yes", "yes"]);
      expect(after.discounts.map(({ holds }) => holds)).toEqual(after.discounts.map(() => "yes"));
      expect(after.takes).toBe(before.takes);
    },
  );

  it("keep an amount cut down before one beer is split off cut down after it, taking as much", async () => {
    const billId = await groupedBill([{ name: "Draught beer", quantity: "5" }], 335);
    const beers = await lineIdOf(venue, billId, 1);
    await inTx(venue, async (tx) => {
      await holdDiscount(tx, venue, { lineId: beers, ...amountOf(1573), position: 1 });
      await holdDiscount(tx, venue, { lineId: beers, ...amountOf(108), position: 2 });
    });
    const before = await inTx(venue, (tx) => workedNow(tx, billId));
    await inTx(venue, (tx) =>
      splitLinesWithinOrder(tx, venue.cfg, billId, [{ lineNo: 1, quantity: "1" }]),
    );
    const after = await inTx(venue, (tx) => workedNow(tx, billId));
    expect(before.discounts.map(({ holds }) => holds)).toEqual(["yes", "cut_down"]);
    expect(after.discounts.map(({ holds }) => holds)).toContain("cut_down");
    expect(after.takes).toBe(before.takes);
    const amounts = await inTx(venue, (tx) =>
      tx
        .select({ amount: billDiscounts.amount })
        .from(billDiscounts)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, billDiscounts.lineId))
        .where(and(eq(billDiscounts.position, 2), eq(workingOrderLines.workingOrderId, billId))),
    );
    expect(amounts.reduce((sum, { amount }) => sum + amount!, 0)).toBe(108);
  });
});
