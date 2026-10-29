import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction, workingOrderLines, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, decimalToCents, stringToThousandths, subtractDecimal } from "@waitron/shared";
import { ADJUSTMENTS_MIGRATIONS } from "./migrations.js";
import { policySnapshotOf, type AdjustmentReason } from "./policy.js";
import {
  readBillAdjustments,
  readReasonStanding,
  recordAdjustment,
  type NewAdjustment,
} from "./record.js";
import { adjustmentLines } from "./schema/adjustment-lines.js";
import { adjustments, type AdjustmentSplit } from "./schema/adjustments.js";
import { seedReason, seedWorkingOrder } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, ADJUSTMENTS_MIGRATIONS] });

let db: Database;
beforeAll(() => {
  db = suite.db;
});

const WAITER = "11111111-1111-4111-8111-111111111111";
const MANAGER = "22222222-2222-4222-8222-222222222222";

/** A €12.00 comp of a whole Burger ×1 under `reason`, on `workingOrderId`. */
function comp(
  workingOrderId: string,
  reason: AdjustmentReason,
  overrides: Partial<NewAdjustment> = {},
): NewAdjustment {
  return {
    workingOrderId,
    line: {
      id: randomUUID(),
      name: "Burger",
      quantity: "1",
      listUnitPriceGross: decimal("12.00"),
      creditedTo: WAITER,
      stage: "served",
    },
    quantity: "1",
    reason: { id: reason.id, name: reason.name, policy: policySnapshotOf(reason) },
    action: "comp",
    percentBp: null,
    beforeAmount: decimal("12.00"),
    afterAmount: decimal("0.00"),
    reduction: decimal("12.00"),
    nominalValue: decimal("12.00"),
    requestedBy: WAITER,
    approvedBy: null,
    note: null,
    ...overrides,
  };
}

/** A percentage discount of `percentBp` on line `lineId`, reducing a €10.00 line. */
function percent(
  workingOrderId: string,
  reason: AdjustmentReason,
  lineId: string,
  percentBp: number,
  splits: AdjustmentSplit[] = [],
): NewAdjustment {
  const reduction = decimal(((10 * percentBp) / 10000).toFixed(2));
  const base = comp(workingOrderId, reason);
  return {
    ...base,
    line: { ...base.line!, id: lineId, listUnitPriceGross: decimal("10.00") },
    splits,
    action: "discount_percent",
    percentBp,
    beforeAmount: decimal("10.00"),
    afterAmount: subtractDecimal(decimal("10.00"), reduction),
    reduction,
    nominalValue: decimal("10.00"),
  };
}

async function record(row: NewAdjustment): Promise<string> {
  return withTransaction(db, (tx) => recordAdjustment(tx, row));
}

async function standing(workingOrderId: string, reasonId: string) {
  const rows = await withTransaction(db, (tx) =>
    readReasonStanding(tx, { workingOrderId, reasonId }),
  );
  return rows
    .map((row) => `${row.reduction} off ${row.quantityThen} now ${row.quantityNow}`)
    .sort();
}

let lineCount = 0;

/** A €10.00 line of `quantity` on `workingOrderId`; returns its id. */
async function lineOn(workingOrderId: string, quantity: string): Promise<string> {
  lineCount += 1;
  const [row] = await db
    .insert(workingOrderLines)
    .values({
      workingOrderId,
      lineNo: lineCount,
      name: "Burger",
      descriptions: { es: "Burger" },
      quantity: stringToThousandths(quantity),
      priceQuantity: stringToThousandths("1"),
      unitPriceGross: decimalToCents(decimal("10.00")),
      vatClass: "general",
      lineTotal: 0,
    })
    .returning({ id: workingOrderLines.id });
  return row!.id;
}

/** Records `row` with what it took off each of `taken`'s lines, at that line's quantity then. */
async function recordTaking(
  row: NewAdjustment,
  taken: { lineId: string; reduction: string; quantity: string }[],
): Promise<void> {
  const adjustmentId = await record(row);
  await db.insert(adjustmentLines).values(
    taken.map(({ lineId, reduction, quantity }) => ({
      adjustmentId,
      lineId,
      reduction: decimalToCents(decimal(reduction)),
      quantity: stringToThousandths(quantity),
    })),
  );
}

describe("recordAdjustment", () => {
  it("stores the line's snapshot, the reason as it was, and the amounts in cents", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const id = await record(
      comp(order, reason, {
        approvedBy: MANAGER,
        note: "Cold",
        quantity: "1",
        line: {
          id: "33333333-3333-4333-8333-333333333333",
          name: "Steak",
          quantity: "2",
          listUnitPriceGross: decimal("25.00"),
          creditedTo: null,
          stage: "fired",
        },
        splits: [
          {
            from: "33333333-3333-4333-8333-333333333333",
            to: "44444444-4444-4444-8444-444444444444",
          },
        ],
        beforeAmount: decimal("50.00"),
        afterAmount: decimal("25.00"),
        reduction: decimal("25.00"),
        nominalValue: decimal("25.00"),
      }),
    );
    const [row] = await db.select().from(adjustments).where(eq(adjustments.id, id));
    expect(row).toEqual({
      id,
      workingOrderId: order,
      lineId: "33333333-3333-4333-8333-333333333333",
      splits: [
        {
          from: "33333333-3333-4333-8333-333333333333",
          to: "44444444-4444-4444-8444-444444444444",
        },
      ],
      compedExtras: [],
      lineName: "Steak",
      lineQuantity: 2000,
      lineListUnitPrice: 2500,
      creditedTo: null,
      reasonId: reason.id,
      reasonName: reason.name,
      policySnapshot: {
        kind: "comp",
        actions: ["comp", "discount_percent", "discount_amount"],
        maxPercentBp: null,
        maxAmount: "30.00",
        applyRoles: ["supervisor", "manager", "admin"],
        approverRoles: ["manager", "admin"],
        noteRequired: false,
      },
      action: "comp",
      quantity: 1000,
      percentBp: null,
      beforeAmount: 5000,
      afterAmount: 2500,
      reduction: 2500,
      nominalValue: 2500,
      requestedBy: WAITER,
      approvedBy: MANAGER,
      note: "Cold",
      stage: "fired",
      byGuest: false,
      chargeKept: false,
      preparationStarted: null,
      refundHandoff: false,
      refundValue: null,
      createdAt: row!.createdAt,
    });
    expect(Number.isNaN(Date.parse(row!.createdAt))).toBe(false);
  });

  it("records a charge-kept cancel with whether preparation had started and whether it was handed to a refund", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const id = await record(
      comp(order, reason, {
        action: "cancel",
        chargeKept: true,
        preparationStarted: false,
        refundHandoff: true,
        refundValue: decimal("1.67"),
      }),
    );
    const [row] = await db.select().from(adjustments).where(eq(adjustments.id, id));
    expect(row).toMatchObject({
      action: "cancel",
      chargeKept: true,
      preparationStarted: false,
      refundHandoff: true,
      refundValue: 167,
    });
  });

  it("defaults the flags for a comp", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const id = await record(comp(order, reason));
    const [row] = await db.select().from(adjustments).where(eq(adjustments.id, id));
    expect(row).toMatchObject({
      chargeKept: false,
      preparationStarted: null,
      refundHandoff: false,
      refundValue: null,
    });
  });

  it("stores a bill-level discount with no line, no stage and no quantity", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const id = await record(
      comp(order, reason, {
        line: null,
        quantity: null,
        action: "discount_amount",
        beforeAmount: decimal("42.48"),
        afterAmount: decimal("37.48"),
        reduction: decimal("5.00"),
        nominalValue: decimal("5.00"),
        byGuest: false,
      }),
    );
    const [row] = await db.select().from(adjustments).where(eq(adjustments.id, id));
    expect(row).toMatchObject({
      lineId: null,
      splits: [],
      lineName: null,
      lineQuantity: null,
      lineListUnitPrice: null,
      creditedTo: null,
      quantity: null,
      stage: null,
      reduction: 500,
    });
  });
});

describe("readReasonStanding: what a reason took off each line now on the bill (plan D37)", () => {
  it("answers nothing when the reason took nothing off a line on the bill", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    await lineOn(order, "1");
    expect(await standing(order, reason.id)).toEqual([]);
  });

  it("answers each line's reduction with its quantity then and now, wherever the record was made", async () => {
    const order = await seedWorkingOrder(db);
    const other = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const another = await seedReason(db);
    const kept = await lineOn(order, "2");
    const movedHere = await lineOn(order, "1");
    const movedAway = await lineOn(other, "1");
    await recordTaking(comp(order, reason), [
      { lineId: kept, reduction: "12.00", quantity: "3" },
      { lineId: movedAway, reduction: "4.00", quantity: "1" },
    ]);
    await recordTaking(comp(other, reason), [
      { lineId: movedHere, reduction: "25.00", quantity: "1" },
    ]);
    await recordTaking(comp(order, another), [{ lineId: kept, reduction: "1.00", quantity: "2" }]);
    await recordTaking(comp(order, reason), [
      { lineId: randomUUID(), reduction: "9.00", quantity: "1" },
    ]);

    expect(await standing(order, reason.id)).toEqual([
      "12.00 off 3.000 now 2.000",
      "25.00 off 1.000 now 1.000",
    ]);
  });

  it("leaves out rows of the reason's cancels, which no cancel writes today", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const line = await lineOn(order, "1");
    await recordTaking(comp(order, reason, { action: "cancel" }), [
      { lineId: line, reduction: "12.00", quantity: "1" },
    ]);
    await recordTaking(
      comp(order, reason, { reduction: decimal("1.00"), afterAmount: decimal("11.00") }),
      [{ lineId: line, reduction: "1.00", quantity: "1" }],
    );
    expect(await standing(order, reason.id)).toEqual(["1.00 off 1.000 now 1.000"]);
  });
});

describe("readBillAdjustments", () => {
  /** Record `row` as if written at `at`, which is its `created_at`. */
  async function recordAt(at: string, row: NewAdjustment): Promise<void> {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(at));
    try {
      await record(row);
    } finally {
      vi.useRealTimers();
    }
  }

  it("answers nothing on a bill nobody adjusted", async () => {
    const order = await seedWorkingOrder(db);
    expect(await withTransaction(db, (tx) => readBillAdjustments(tx, order))).toEqual([]);
  });

  it("reads this bill's comps and discounts oldest first, and not its cancellations", async () => {
    const order = await seedWorkingOrder(db);
    const other = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const part = { from: randomUUID(), to: randomUUID() };
    const whole = randomUUID();
    const percentLine = randomUUID();
    await recordAt(
      "2026-09-30T12:00:03.000Z",
      comp(order, reason, {
        line: null,
        quantity: null,
        action: "discount_amount",
        beforeAmount: decimal("20.00"),
        afterAmount: decimal("15.00"),
        reduction: decimal("5.00"),
        nominalValue: decimal("5.00"),
      }),
    );
    await recordAt(
      "2026-09-30T12:00:01.000Z",
      comp(order, reason, {
        line: { ...comp(order, reason).line!, id: part.from, quantity: "3" },
        quantity: "1",
        splits: [part],
      }),
    );
    await recordAt("2026-09-30T12:00:02.000Z", percent(order, reason, percentLine, 2500));
    await recordAt(
      "2026-09-30T12:00:00.000Z",
      comp(order, reason, { line: { ...comp(order, reason).line!, id: whole } }),
    );
    await recordAt("2026-09-30T12:00:04.000Z", comp(order, reason, { action: "cancel" }));
    await recordAt("2026-09-30T12:00:05.000Z", comp(other, reason));

    expect(await withTransaction(db, (tx) => readBillAdjustments(tx, order))).toEqual([
      {
        lineId: whole,
        splits: [],
        partOfLine: false,
        action: "comp",
        percentBp: null,
        reduction: "12.00",
        full: true,
      },
      {
        lineId: part.from,
        splits: [part],
        partOfLine: true,
        action: "comp",
        percentBp: null,
        reduction: "12.00",
        full: true,
      },
      {
        lineId: percentLine,
        splits: [],
        partOfLine: false,
        action: "discount_percent",
        percentBp: 2500,
        reduction: "2.50",
        full: false,
      },
      {
        lineId: null,
        splits: [],
        partOfLine: false,
        action: "discount_amount",
        percentBp: 2500,
        reduction: "5.00",
        full: false,
      },
    ]);
  });

  it("gives an amount that left part of its subject the percentage it took of the price before it", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const amount = (seconds: number, beforeAmount: string, reduction: string) =>
      recordAt(
        `2026-09-30T12:00:0${seconds}.000Z`,
        comp(order, reason, {
          action: "discount_amount",
          beforeAmount: decimal(beforeAmount),
          afterAmount: subtractDecimal(decimal(beforeAmount), decimal(reduction)),
          reduction: decimal(reduction),
        }),
      );
    await amount(0, "9.99", "1.00");
    await amount(1, "8.00", "0.01");
    await amount(2, "8.00", "0.03");
    await amount(3, "3000.00", "0.01");
    await amount(4, "3000.00", "2999.99");

    const read = await withTransaction(db, (tx) => readBillAdjustments(tx, order));
    // 10.01001…%, 0.125% and 0.375% round half up to a basis point; the last two would round to
    // 0% and 100%, which neither is.
    expect(read.map((row) => row.percentBp)).toEqual([1001, 13, 38, 1, 9999]);
  });

  it("marks a Free comp and an amount that left its subject at zero as full", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const amount = (beforeAmount: string, nominalValue: string, afterAmount = "0.00") =>
      comp(order, reason, {
        action: "discount_amount",
        beforeAmount: decimal(beforeAmount),
        afterAmount: decimal(afterAmount),
        reduction: subtractDecimal(decimal(beforeAmount), decimal(afterAmount)),
        nominalValue: decimal(nominalValue),
      });
    await recordAt("2026-09-30T12:00:00.000Z", comp(order, reason));
    await recordAt("2026-09-30T12:00:01.000Z", amount("12.00", "12.00"));
    await recordAt("2026-09-30T12:00:02.000Z", amount("6.00", "12.00"));
    await recordAt("2026-09-30T12:00:03.000Z", {
      ...amount("20.00", "20.00"),
      line: null,
      quantity: null,
    });
    await recordAt("2026-09-30T12:00:04.000Z", amount("12.00", "12.00", "3.00"));

    const read = await withTransaction(db, (tx) => readBillAdjustments(tx, order));
    expect(read.map((row) => row.full)).toEqual([true, true, true, true, false]);
  });

  it("reads the bill's adjustments through the index that leads with the working order", async () => {
    const plan = await db.execute<{ detail: string }>(
      sql`explain query plan select * from adjustments
        where working_order_id = ${randomUUID()} and action <> 'cancel' order by created_at, id`,
    );
    expect(plan.rows.map((row) => row.detail).join("\n")).toContain(
      "USING INDEX adjustments_order_reason_idx (working_order_id=?)",
    );
  });
});
