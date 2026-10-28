import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, subtractDecimal } from "@waitron/shared";
import { ADJUSTMENTS_MIGRATIONS } from "./migrations.js";
import { policySnapshotOf, type AdjustmentReason } from "./policy.js";
import {
  readBillAdjustments,
  readReasonTotals,
  recordAdjustment,
  type NewAdjustment,
} from "./record.js";
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

async function totals(workingOrderId: string, reasonId: string) {
  return withTransaction(db, (tx) => readReasonTotals(tx, { workingOrderId, reasonId }));
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

describe("readReasonTotals", () => {
  it("answers nothing taken when the reason has not touched the bill", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    expect(await totals(order, reason.id)).toEqual({ priorReductionOnBill: "0.00" });
  });

  it("sums this reason's reductions on this bill, bill-level discounts included", async () => {
    const order = await seedWorkingOrder(db);
    const other = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const another = await seedReason(db);
    await record(comp(order, reason));
    await record(comp(order, reason));
    await record(
      comp(order, reason, {
        line: null,
        quantity: null,
        action: "discount_amount",
        beforeAmount: decimal("20.00"),
        afterAmount: decimal("15.01"),
        reduction: decimal("4.99"),
        nominalValue: decimal("4.99"),
      }),
    );
    await record(comp(order, another));
    await record(comp(other, reason));
    expect((await totals(order, reason.id)).priorReductionOnBill).toBe("28.99");
  });

  it("leaves out the reason's cancels, which a reason changed from Void to Comp still holds", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    await record(comp(order, reason, { action: "cancel" }));
    await record(
      comp(order, reason, { reduction: decimal("1.00"), afterAmount: decimal("11.00") }),
    );
    expect((await totals(order, reason.id)).priorReductionOnBill).toBe("1.00");
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
        percentBp: null,
        reduction: "5.00",
        full: false,
      },
    ]);
  });

  it("marks a Free comp and an amount that took the whole list value as full", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const amount = (beforeAmount: string, nominalValue: string) =>
      comp(order, reason, {
        action: "discount_amount",
        beforeAmount: decimal(beforeAmount),
        afterAmount: decimal("0.00"),
        reduction: decimal(beforeAmount),
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

    const read = await withTransaction(db, (tx) => readBillAdjustments(tx, order));
    expect(read.map((row) => row.full)).toEqual([true, true, false, true]);
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
