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
  readReasonItemShares,
  readReasonTotals,
  readWholeLineReductions,
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

function readShares(workingOrderId: string, reasonId: string, lineIds: string[]) {
  return withTransaction(db, (tx) =>
    readReasonItemShares(tx, { workingOrderId, reasonId, lineIds }),
  );
}

/** Each of `lineIds`' own share, the reason's rows on the whole bill left out. */
async function shares(workingOrderId: string, reasonId: string, lineIds: string[]) {
  return (await readShares(workingOrderId, reasonId, lineIds)).lines;
}

async function shareOf(workingOrderId: string, reasonId: string, lineId: string) {
  return (await shares(workingOrderId, reasonId, [lineId])).get(lineId)!;
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
      createdAt: row!.createdAt,
    });
    expect(Number.isNaN(Date.parse(row!.createdAt))).toBe(false);
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

describe("readReasonItemShares", () => {
  it("sums this reason's shares on this line only, comps included", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const another = await seedReason(db);
    const line = randomUUID();
    const neighbour = randomUUID();
    await record(percent(order, reason, line, 1000));
    await record(percent(order, reason, line, 3000));
    await record(percent(order, another, line, 2000));
    await record(percent(order, reason, neighbour, 500));
    await record(comp(order, reason, { line: { ...comp(order, reason).line!, id: line } }));
    expect(await shareOf(order, reason.id, line)).toBe(14000);
    expect(await shareOf(order, reason.id, neighbour)).toBe(500);
  });

  it("counts the percentage taken off the line a row was split from, at every remove", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const another = await seedReason(db);
    const [line, carved, carvedAgain] = [randomUUID(), randomUUID(), randomUUID()];
    await record(percent(order, reason, line, 1000));
    // Another reason's comp carves `carved` off `line`; this reason then takes 20% off `carved`,
    // carving `carvedAgain` off it.
    await record(
      comp(order, another, {
        line: { ...comp(order, another).line!, id: line },
        splits: [{ from: line, to: carved }],
      }),
    );
    await record(percent(order, reason, carved, 2000, [{ from: carved, to: carvedAgain }]));
    expect(await shareOf(order, reason.id, carved)).toBe(3000);
    expect(await shareOf(order, reason.id, carvedAgain)).toBe(3000);
    // What a row carved off a line takes never counts against the line it came from; what the line
    // takes after the carve still counts against the row.
    expect(await shareOf(order, reason.id, line)).toBe(1000);
    await record(percent(order, reason, line, 500));
    expect(await shareOf(order, reason.id, carved)).toBe(3500);
  });

  it("leaves out the reason's cancel of the line a row was split from", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const another = await seedReason(db);
    const [line, carved] = [randomUUID(), randomUUID()];
    const onLine = { ...comp(order, reason).line!, id: line, quantity: "2" };
    await record(comp(order, another, { line: onLine, splits: [{ from: line, to: carved }] }));
    await record(comp(order, reason, { line: { ...onLine, quantity: "1" }, action: "cancel" }));
    await record(percent(order, reason, carved, 1000));
    expect(await shareOf(order, reason.id, carved)).toBe(1000);
  });

  it("follows a split a bill discount made back to the row it came from", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const another = await seedReason(db);
    const [line, neighbour, carved] = [randomUUID(), randomUUID(), randomUUID()];
    await record(percent(order, reason, line, 3000));
    await record(percent(order, reason, neighbour, 1000));
    // Another reason's discount on the whole bill splits `carved` off `line`.
    await record(
      comp(order, another, {
        line: null,
        quantity: null,
        action: "discount_amount",
        beforeAmount: decimal("20.00"),
        afterAmount: decimal("19.99"),
        reduction: decimal("0.01"),
        nominalValue: decimal("20.00"),
        splits: [{ from: line, to: carved }],
      }),
    );
    expect(await shareOf(order, reason.id, carved)).toBe(3000);
  });

  it("does not follow a split recorded on another bill", async () => {
    const order = await seedWorkingOrder(db);
    const other = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const [line, carved] = [randomUUID(), randomUUID()];
    await record(percent(other, reason, line, 1000, [{ from: line, to: carved }]));
    await record(percent(order, reason, line, 2000));
    expect(await shareOf(order, reason.id, carved)).toBe(0);
  });

  it("answers each line's shares apart in one call, each following its own splits", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const another = await seedReason(db);
    const [dish, extra, carved, untouched] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    await record(percent(order, reason, dish, 1000));
    await record(percent(order, reason, extra, 2500));
    await record(percent(order, another, extra, 500));
    await record(percent(order, reason, dish, 500, [{ from: dish, to: carved }]));

    const percents = await withTransaction(db, (tx) =>
      readReasonItemShares(tx, {
        workingOrderId: order,
        reasonId: reason.id,
        lineIds: [dish, extra, carved, untouched],
      }),
    );

    expect(percents).toEqual({
      lines: new Map([
        [dish, 1500],
        [extra, 2500],
        [carved, 1500],
        [untouched, 0],
      ]),
      billReduction: 0,
    });
  });

  /** An amount of `reduction` off `nominal` on line `lineId`. */
  function amountOff(
    workingOrderId: string,
    reason: AdjustmentReason,
    lineId: string,
    reduction: string,
    nominal: string,
    splits: AdjustmentSplit[] = [],
  ): NewAdjustment {
    const base = comp(workingOrderId, reason);
    return {
      ...base,
      line: { ...base.line!, id: lineId, listUnitPriceGross: decimal(nominal) },
      splits,
      action: "discount_amount",
      beforeAmount: decimal(nominal),
      afterAmount: subtractDecimal(decimal(nominal), decimal(reduction)),
      reduction: decimal(reduction),
      nominalValue: decimal(nominal),
    };
  }

  it("counts a free item as 10000", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const line = randomUUID();
    await record(comp(order, reason, { line: { ...comp(order, reason).line!, id: line } }));
    expect(await shares(order, reason.id, [line])).toEqual(new Map([[line, 10000]]));
  });

  it("counts a €3.00 amount off a €12.00 item as 2500", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const line = randomUUID();
    await record(amountOff(order, reason, line, "3.00", "12.00"));
    expect(await shares(order, reason.id, [line])).toEqual(new Map([[line, 2500]]));
  });

  it("rounds a share up: €1.00 off €3.00 is 3334", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const line = randomUUID();
    await record(amountOff(order, reason, line, "1.00", "3.00"));
    expect(await shares(order, reason.id, [line])).toEqual(new Map([[line, 3334]]));
  });

  it("rounds each row up on its own: two rows of €1.00 off €3.00 are 6668, not 6667", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const line = randomUUID();
    await record(amountOff(order, reason, line, "1.00", "3.00"));
    await record(amountOff(order, reason, line, "1.00", "3.00"));
    expect(await shares(order, reason.id, [line])).toEqual(new Map([[line, 6668]]));
  });

  it("adds nothing for a row with no list value", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const line = randomUUID();
    await record(amountOff(order, reason, line, "0.00", "0.00"));
    expect(await shares(order, reason.id, [line])).toEqual(new Map([[line, 0]]));
  });

  it("adds a row split off the item, at any remove", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const another = await seedReason(db);
    const [line, carved, carvedAgain] = [randomUUID(), randomUUID(), randomUUID()];
    await record(amountOff(order, reason, line, "3.00", "12.00"));
    await record(amountOff(order, another, line, "1.00", "12.00", [{ from: line, to: carved }]));
    await record(amountOff(order, reason, carved, "1.00", "10.00"));
    await record(
      amountOff(order, another, carved, "1.00", "9.00", [{ from: carved, to: carvedAgain }]),
    );
    expect(await shares(order, reason.id, [line, carved, carvedAgain])).toEqual(
      new Map([
        [line, 2500],
        [carved, 3500],
        [carvedAgain, 3500],
      ]),
    );
  });

  it("answers the reason's discount on the whole bill in cents, apart from each line's own share", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const [line, neighbour] = [randomUUID(), randomUUID()];
    await record(amountOff(order, reason, line, "3.00", "12.00"));
    await record(
      comp(order, reason, {
        line: null,
        quantity: null,
        action: "discount_amount",
        beforeAmount: decimal("20.00"),
        afterAmount: decimal("18.00"),
        reduction: decimal("2.00"),
        nominalValue: decimal("20.00"),
      }),
    );
    expect(
      await withTransaction(db, (tx) =>
        readReasonItemShares(tx, {
          workingOrderId: order,
          reasonId: reason.id,
          lineIds: [line, neighbour],
        }),
      ),
    ).toEqual({
      lines: new Map([
        [line, 2500],
        [neighbour, 0],
      ]),
      billReduction: 200,
    });
  });

  it("counts a line named twice once", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const line = randomUUID();
    await record(amountOff(order, reason, line, "3.00", "12.00"));
    await record(
      comp(order, reason, {
        line: null,
        quantity: null,
        action: "discount_amount",
        beforeAmount: decimal("20.00"),
        afterAmount: decimal("18.00"),
        reduction: decimal("2.00"),
        nominalValue: decimal("20.00"),
      }),
    );
    expect(await readShares(order, reason.id, [line, line])).toEqual({
      lines: new Map([[line, 2500]]),
      billReduction: 200,
    });
  });

  it("leaves out another reason's rows and another bill's", async () => {
    const order = await seedWorkingOrder(db);
    const other = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const another = await seedReason(db);
    const line = randomUUID();
    const billWide = {
      line: null,
      quantity: null,
      action: "discount_amount" as const,
      beforeAmount: decimal("20.00"),
      afterAmount: decimal("10.00"),
      reduction: decimal("10.00"),
      nominalValue: decimal("20.00"),
    };
    await record(amountOff(order, reason, line, "1.20", "12.00"));
    await record(amountOff(order, another, line, "3.00", "12.00"));
    await record(comp(order, another, billWide));
    await record(amountOff(other, reason, line, "6.00", "12.00"));
    await record(comp(other, reason, billWide));
    expect(await readShares(order, reason.id, [line])).toEqual({
      lines: new Map([[line, 1000]]),
      billReduction: 0,
    });
  });

  it("adds nothing for a cancel", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const line = randomUUID();
    const voidReason = { ...reason, id: randomUUID(), name: "Void" };
    await record(
      comp(order, voidReason, {
        line: { ...comp(order, reason).line!, id: line },
        action: "cancel",
      }),
    );
    expect(await shares(order, reason.id, [line])).toEqual(new Map([[line, 0]]));
  });

  it("counts a comp of one of two burgers on the burger it carved off, not on the other", async () => {
    const order = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const another = await seedReason(db);
    const [line, carved, carvedAgain] = [randomUUID(), randomUUID(), randomUUID()];
    await record(
      comp(order, reason, {
        line: { ...comp(order, reason).line!, id: line, quantity: "2" },
        quantity: "1",
        splits: [{ from: line, to: carved }],
      }),
    );
    await record(
      amountOff(order, another, carved, "0.00", "0.00", [{ from: carved, to: carvedAgain }]),
    );
    expect(await shares(order, reason.id, [line, carved, carvedAgain])).toEqual(
      new Map([
        [line, 0],
        [carved, 10000],
        [carvedAgain, 10000],
      ]),
    );
  });
});

describe("readWholeLineReductions", () => {
  /** The rows found, smallest reduction first. */
  async function read(workingOrderId: string, lineIds: string[]) {
    const found = await withTransaction(db, (tx) =>
      readWholeLineReductions(tx, { workingOrderId, lineIds }),
    );
    return found.sort((a, b) => a.reduction - b.reduction);
  }

  it("answers every reason's comps and discounts of a whole line that split nothing, in cents and thousandths", async () => {
    const order = await seedWorkingOrder(db);
    const [reason, another] = [await seedReason(db), await seedReason(db)];
    const [line, neighbour] = [randomUUID(), randomUUID()];
    await record(percent(order, reason, line, 1000));
    await record(
      comp(order, another, {
        line: { ...comp(order, reason).line!, id: line, quantity: "2" },
        quantity: "2",
        beforeAmount: decimal("24.00"),
        reduction: decimal("24.00"),
        nominalValue: decimal("24.00"),
      }),
    );
    await record(percent(order, reason, neighbour, 2000));
    expect(await read(order, [line])).toEqual([
      { lineId: line, lineQuantity: 1000, nominal: 1000, reduction: 100 },
      { lineId: line, lineQuantity: 2000, nominal: 2400, reduction: 2400 },
    ]);
  });

  it("leaves out a cancel, part of a line, a row that split a row off, the whole bill and another bill", async () => {
    const order = await seedWorkingOrder(db);
    const other = await seedWorkingOrder(db);
    const reason = await seedReason(db);
    const line = randomUUID();
    const twoBurgers = { ...comp(order, reason).line!, id: line, quantity: "2" };
    await record(
      comp(order, reason, { line: { ...comp(order, reason).line!, id: line }, action: "cancel" }),
    );
    await record(comp(order, reason, { line: twoBurgers, quantity: "1" }));
    await record(percent(order, reason, line, 1000, [{ from: line, to: randomUUID() }]));
    await record(comp(order, reason, { line: null, quantity: null, action: "discount_amount" }));
    await record(percent(other, reason, line, 1000));
    expect(await read(order, [line])).toEqual([]);
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
