import { DatabaseSync } from "node:sqlite";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adjustmentEndings,
  adjustmentLines,
  captureError,
  checkFailed,
  CORE_MIGRATIONS,
  withTransaction,
  workingOrderLines,
  type AdjustmentEndingWhy,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { decimal, stringToThousandths } from "@waitron/shared";
import { endAdjustment, endingRestores, readDiscountNotices } from "./endings.js";
import { policySnapshotOf } from "./policy.js";
import { recordAdjustment } from "./record.js";
import { seedReason, seedWorkingOrder } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

let db: Database;
beforeAll(() => {
  db = suite.db;
});

const WAITER = "11111111-1111-4111-8111-111111111111";

beforeEach(async () => {
  await seedPerson(db, { id: WAITER, displayName: "Waiter" });
});

let lineCount = 0;

/** A row of `quantity` a la carte Hakes (16.00) on `workingOrderId`, at 10% off: 14.40 each. */
async function discountedHakes(workingOrderId: string, quantity: string): Promise<string> {
  lineCount += 1;
  const count = Number(quantity);
  const [row] = await db
    .insert(workingOrderLines)
    .values({
      workingOrderId,
      lineNo: lineCount,
      name: "Hake",
      descriptions: { es: "Hake" },
      quantity: stringToThousandths(quantity),
      priceQuantity: stringToThousandths("1"),
      unitPriceGross: 1440,
      listUnitPriceGross: 1600,
      aLaCarteUnitPrice: 1600,
      vatClass: "general",
      takeawayVatClass: "general",
      lineTotal: 1440 * count,
    })
    .returning({ id: workingOrderLines.id });
  return row!.id;
}

/** Records 10% off the `quantity` Hakes of `lineId`, as the comp window writes it. */
async function tenPercentOff(
  workingOrderId: string,
  lineId: string,
  quantity: string,
): Promise<string> {
  const reason = await seedReason(db);
  const count = Number(quantity);
  return withTransaction(db, async (tx) => {
    const id = await recordAdjustment(tx, {
      workingOrderId,
      line: {
        id: lineId,
        name: "Hake",
        quantity,
        listUnitPriceGross: decimal("16.00"),
        creditedTo: WAITER,
        stage: "served",
      },
      quantity,
      reason: {
        id: reason.id,
        name: reason.name,
        policy: policySnapshotOf(reason, { maxBillComp: null }),
      },
      action: "discount_percent",
      percentBp: 1000,
      beforeAmount: decimal((16 * count).toFixed(2)),
      afterAmount: decimal((14.4 * count).toFixed(2)),
      reduction: decimal((1.6 * count).toFixed(2)),
      nominalValue: decimal((16 * count).toFixed(2)),
      requestedBy: WAITER,
      approvedBy: null,
      note: null,
    });
    await tx.insert(adjustmentLines).values({
      adjustmentId: id,
      lineId,
      reduction: 160 * count,
      quantity: stringToThousandths(quantity),
    });
    return id;
  });
}

/** Records `cents` off one Hake of `lineId`, written as the comp window writes it. */
async function amountOff(workingOrderId: string, lineId: string, cents: number): Promise<string> {
  const reason = await seedReason(db);
  return withTransaction(db, async (tx) => {
    const id = await recordAdjustment(tx, {
      workingOrderId,
      line: {
        id: lineId,
        name: "Hake",
        quantity: "1",
        listUnitPriceGross: decimal("16.00"),
        creditedTo: WAITER,
        stage: "served",
      },
      quantity: "1",
      reason: {
        id: reason.id,
        name: reason.name,
        policy: policySnapshotOf(reason, { maxBillComp: null }),
      },
      action: "discount_amount",
      percentBp: null,
      beforeAmount: decimal("16.00"),
      afterAmount: decimal((16 - cents / 100).toFixed(2)),
      reduction: decimal((cents / 100).toFixed(2)),
      nominalValue: decimal("16.00"),
      requestedBy: WAITER,
      approvedBy: null,
      note: null,
    });
    await tx
      .insert(adjustmentLines)
      .values({ adjustmentId: id, lineId, reduction: cents, quantity: stringToThousandths("1") });
    return id;
  });
}

async function priceOf(lineId: string) {
  const [row] = await db
    .select({
      unitPriceGross: workingOrderLines.unitPriceGross,
      lineTotal: workingOrderLines.lineTotal,
      listUnitPriceGross: workingOrderLines.listUnitPriceGross,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.id, lineId));
  return row;
}

async function endingsOf(adjustmentId: string) {
  return db
    .select({
      workingOrderId: adjustmentEndings.workingOrderId,
      why: adjustmentEndings.why,
      dishName: adjustmentEndings.dishName,
      lineId: adjustmentEndings.lineId,
    })
    .from(adjustmentEndings)
    .where(eq(adjustmentEndings.adjustmentId, adjustmentId));
}

describe("ending a comp or discount", () => {
  it("gives an a la carte Hake its 16.00 back, clears its list price and records one ending, as endingRestores answered beforehand without writing", async () => {
    const order = await seedWorkingOrder(db);
    const hake = await discountedHakes(order, "1");
    const adjustmentId = await tenPercentOff(order, hake, "1");

    const answered = await withTransaction(db, (tx) =>
      endingRestores(tx, { workingOrderId: order, adjustmentIds: [adjustmentId] }),
    );
    expect(answered).toEqual([
      { lineId: hake, unitPriceGross: 1600, lineTotal: 1600, listUnitPriceGross: null },
    ]);
    expect(await priceOf(hake)).toEqual({
      unitPriceGross: 1440,
      lineTotal: 1440,
      listUnitPriceGross: 1600,
    });
    expect(await endingsOf(adjustmentId)).toEqual([]);

    await withTransaction(db, (tx) =>
      endAdjustment(tx, {
        adjustmentId,
        workingOrderId: order,
        why: "extras_changed",
        dishName: "Hake",
        lineId: hake,
      }),
    );
    expect(await priceOf(hake)).toEqual({
      unitPriceGross: 1600,
      lineTotal: 1600,
      listUnitPriceGross: null,
    });
    expect(await endingsOf(adjustmentId)).toEqual([
      { workingOrderId: order, why: "extras_changed", dishName: "Hake", lineId: hake },
    ]);
  });

  it("gives back each row a discount took something off once, on whichever bill the row is on", async () => {
    const first = await seedWorkingOrder(db);
    const second = await seedWorkingOrder(db);
    const stayed = await discountedHakes(first, "2");
    const adjustmentId = await tenPercentOff(first, stayed, "2");
    // One of the two Hakes moved to the second bill: the row split, and the split row carries what
    // the discount took off the two, as `carryLineReductions` copies it.
    await db
      .update(workingOrderLines)
      .set({ quantity: stringToThousandths("1"), lineTotal: 1440 })
      .where(eq(workingOrderLines.id, stayed));
    const moved = await discountedHakes(second, "1");
    await db
      .insert(adjustmentLines)
      .values({ adjustmentId, lineId: moved, reduction: 320, quantity: stringToThousandths("2") });

    const endOn = (workingOrderId: string) =>
      withTransaction(db, (tx) =>
        endAdjustment(tx, { adjustmentId, workingOrderId, why: "dish_moved", dishName: "Hake" }),
      );

    await endOn(second);
    expect(await priceOf(moved)).toEqual({
      unitPriceGross: 1600,
      lineTotal: 1600,
      listUnitPriceGross: null,
    });
    expect(await priceOf(stayed)).toEqual({
      unitPriceGross: 1440,
      lineTotal: 1440,
      listUnitPriceGross: 1600,
    });

    await expect(endOn(second)).rejects.toMatchObject({
      code: "adjustment.not_standing",
      params: { adjustmentId, workingOrderId: second },
    });
    expect(await priceOf(moved)).toEqual({
      unitPriceGross: 1600,
      lineTotal: 1600,
      listUnitPriceGross: null,
    });

    await endOn(first);
    expect(await priceOf(stayed)).toEqual({
      unitPriceGross: 1600,
      lineTotal: 1600,
      listUnitPriceGross: null,
    });
    expect(
      (await endingsOf(adjustmentId)).map(({ workingOrderId }) => workingOrderId).sort(),
    ).toEqual([first, second].sort());
  });

  it("keeps a row given back on one bill given back once the row moves to another keeping its id", async () => {
    const first = await seedWorkingOrder(db);
    const second = await seedWorkingOrder(db);
    const hake = await discountedHakes(first, "1");
    const adjustmentId = await tenPercentOff(first, hake, "1");
    const endOn = (workingOrderId: string) =>
      withTransaction(db, (tx) =>
        endAdjustment(tx, { adjustmentId, workingOrderId, why: "dish_moved", dishName: "Hake" }),
      );
    await endOn(first);

    await db
      .update(workingOrderLines)
      .set({ workingOrderId: second })
      .where(eq(workingOrderLines.id, hake));

    expect(
      await withTransaction(db, (tx) =>
        endingRestores(tx, { workingOrderId: second, adjustmentIds: [adjustmentId] }),
      ),
    ).toEqual([]);
    await expect(endOn(second)).rejects.toMatchObject({ code: "adjustment.not_standing" });
    expect(await priceOf(hake)).toEqual({
      unitPriceGross: 1600,
      lineTotal: 1600,
      listUnitPriceGross: null,
    });
    expect(await endingsOf(adjustmentId)).toHaveLength(1);
  });

  it("refuses an ending on a bill holding none of the discount's rows, recording nothing", async () => {
    const first = await seedWorkingOrder(db);
    const other = await seedWorkingOrder(db);
    const hake = await discountedHakes(first, "1");
    const adjustmentId = await tenPercentOff(first, hake, "1");

    await expect(
      withTransaction(db, (tx) =>
        endAdjustment(tx, {
          adjustmentId,
          workingOrderId: other,
          why: "dish_moved",
          dishName: "Hake",
        }),
      ),
    ).rejects.toMatchObject({ code: "adjustment.not_standing" });
    expect(await endingsOf(adjustmentId)).toEqual([]);
  });

  it("never gives a row back more than its stamped list price while another discount still stands on it", async () => {
    const order = await seedWorkingOrder(db);
    const hake = await discountedHakes(order, "1");
    // A row whose recorded share overstates what it took (as a share of a row split by price can).
    const overstated = await amountOff(order, hake, 200);
    await amountOff(order, hake, 10);

    await withTransaction(db, (tx) =>
      endAdjustment(tx, {
        adjustmentId: overstated,
        workingOrderId: order,
        why: "dish_moved",
        dishName: "Hake",
      }),
    );

    expect(await priceOf(hake)).toEqual({
      unitPriceGross: 1600,
      lineTotal: 1600,
      listUnitPriceGross: null,
    });
  });

  it("leaves every price as it was when the ending itself is refused inside a transaction that carries on", async () => {
    const order = await seedWorkingOrder(db);
    const hake = await discountedHakes(order, "1");
    const adjustmentId = await tenPercentOff(order, hake, "1");

    const refused = await withTransaction(db, async (tx) => {
      const error = await captureError(() =>
        endAdjustment(tx, {
          adjustmentId,
          workingOrderId: order,
          why: "not_a_why" as AdjustmentEndingWhy,
          dishName: "Hake",
        }),
      );
      return {
        error,
        price: await tx
          .select({ unit: workingOrderLines.unitPriceGross })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.id, hake)),
      };
    });

    expect(checkFailed(refused.error, "adjustment_endings_why_ck")).toBe(true);
    expect(refused.price).toEqual([{ unit: 1440 }]);
  });
});

describe("ending a comp or discount on some of its rows", () => {
  it("gives back only the named Hake, leaving the other Hake's share standing until a later ending names it", async () => {
    const order = await seedWorkingOrder(db);
    const edited = await discountedHakes(order, "1");
    const other = await discountedHakes(order, "1");
    const adjustmentId = await tenPercentOff(order, edited, "1");
    await db
      .insert(adjustmentLines)
      .values({ adjustmentId, lineId: other, reduction: 160, quantity: stringToThousandths("1") });
    const endOn = (lineId: string) =>
      withTransaction(db, (tx) =>
        endAdjustment(tx, {
          adjustmentId,
          workingOrderId: order,
          why: "extras_changed",
          dishName: "Hake",
          lineId,
          lineIds: [lineId],
        }),
      );

    expect(
      await withTransaction(db, (tx) =>
        endingRestores(tx, {
          workingOrderId: order,
          adjustmentIds: [adjustmentId],
          lineIds: [edited],
        }),
      ),
    ).toEqual([
      { lineId: edited, unitPriceGross: 1600, lineTotal: 1600, listUnitPriceGross: null },
    ]);
    await endOn(edited);
    expect(await priceOf(edited)).toEqual({
      unitPriceGross: 1600,
      lineTotal: 1600,
      listUnitPriceGross: null,
    });
    expect(await priceOf(other)).toEqual({
      unitPriceGross: 1440,
      lineTotal: 1440,
      listUnitPriceGross: 1600,
    });

    await endOn(other);
    expect(await priceOf(other)).toEqual({
      unitPriceGross: 1600,
      lineTotal: 1600,
      listUnitPriceGross: null,
    });
    expect((await endingsOf(adjustmentId)).map(({ lineId }) => lineId)).toEqual([edited, other]);
    await expect(endOn(other)).rejects.toMatchObject({ code: "adjustment.not_standing" });
  });
});

describe("the notices a bill answers", () => {
  it("answers an ending a change caused on its own bill, not a replacement, and not once a comp or discount on that bill gives it again", async () => {
    const order = await seedWorkingOrder(db);
    const other = await seedWorkingOrder(db);
    const moved = await tenPercentOff(order, await discountedHakes(order, "1"), "1");
    const replaced = await amountOff(order, await discountedHakes(order, "1"), 200);
    const given = await tenPercentOff(order, await discountedHakes(order, "1"), "1");
    for (const [adjustmentId, why] of [
      [moved, "dish_moved"],
      [replaced, "replaced"],
      [given, "dish_cancelled"],
    ] as const) {
      await withTransaction(db, (tx) =>
        endAdjustment(tx, { adjustmentId, workingOrderId: order, why, dishName: "Hake" }),
      );
    }
    const reason = await seedReason(db);
    await withTransaction(db, (tx) =>
      recordAdjustment(tx, {
        workingOrderId: order,
        line: null,
        quantity: null,
        reason: {
          id: reason.id,
          name: reason.name,
          policy: policySnapshotOf(reason, { maxBillComp: null }),
        },
        action: "discount_amount",
        percentBp: null,
        beforeAmount: decimal("16.00"),
        afterAmount: decimal("15.00"),
        reduction: decimal("1.00"),
        nominalValue: decimal("16.00"),
        requestedBy: WAITER,
        approvedBy: null,
        note: null,
        reappliesAdjustmentId: given,
      }),
    );

    const notices = await withTransaction(db, (tx) => readDiscountNotices(tx, [order, other]));

    expect(notices).toEqual([
      expect.objectContaining({
        workingOrderId: order,
        adjustmentId: moved,
        why: "dish_moved",
        dishName: "Hake",
        lineId: null,
        action: "discount_percent",
        percentBp: 1000,
        givenBack: "1.60",
        lineName: "Hake",
      }),
    ]);
    expect(await withTransaction(db, (tx) => readDiscountNotices(tx, []))).toEqual([]);
  });

  it("answers what each ending gave back: one of two Hakes split onto another bill gives back 1.60 of 3.20, and a row since gone counts whole", async () => {
    const first = await seedWorkingOrder(db);
    const second = await seedWorkingOrder(db);
    const stayed = await discountedHakes(first, "2");
    const adjustmentId = await tenPercentOff(first, stayed, "2");
    await db
      .update(workingOrderLines)
      .set({ quantity: stringToThousandths("1"), lineTotal: 1440 })
      .where(eq(workingOrderLines.id, stayed));
    const moved = await discountedHakes(second, "1");
    await db
      .insert(adjustmentLines)
      .values({ adjustmentId, lineId: moved, reduction: 320, quantity: stringToThousandths("2") });
    for (const workingOrderId of [second, first]) {
      await withTransaction(db, (tx) =>
        endAdjustment(tx, { adjustmentId, workingOrderId, why: "dish_moved", dishName: "Hake" }),
      );
    }
    const byBill = (rows: { workingOrderId: string; givenBack: string }[]) =>
      [...rows].sort((a, b) => a.workingOrderId.localeCompare(b.workingOrderId));
    const givenBack = async () =>
      byBill(
        (await withTransaction(db, (tx) => readDiscountNotices(tx, [first, second]))).map(
          ({ workingOrderId, givenBack }) => ({ workingOrderId, givenBack }),
        ),
      );
    expect(await givenBack()).toEqual(
      byBill([
        { workingOrderId: second, givenBack: "1.60" },
        { workingOrderId: first, givenBack: "1.60" },
      ]),
    );

    await db.delete(workingOrderLines).where(eq(workingOrderLines.id, stayed));

    expect(await givenBack()).toEqual(
      byBill([
        { workingOrderId: second, givenBack: "1.60" },
        { workingOrderId: first, givenBack: "3.20" },
      ]),
    );
    const untouched = await seedWorkingOrder(db);
    expect(await withTransaction(db, (tx) => readDiscountNotices(tx, [untouched]))).toEqual([]);
  });

  it("finds a bill's endings through the bill index, not by reading every ending", async () => {
    const order = await seedWorkingOrder(db);
    const plans: string[] = [];
    const prepare = DatabaseSync.prototype.prepare;
    const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
      this: DatabaseSync,
      text,
    ) {
      const statement = prepare.call(this, text);
      if (!text.includes('from "adjustment_endings"')) return statement;
      const all = statement.all;
      statement.all = (...parameters: unknown[]) => {
        const explain = prepare.call(this, `explain query plan ${text}`);
        const plan = Reflect.apply(all, explain, parameters) as { detail: string }[];
        plans.push(...plan.map((row) => String(row.detail)));
        return Reflect.apply(all, statement, parameters);
      };
      return statement;
    });
    try {
      await withTransaction(db, (tx) => readDiscountNotices(tx, [order]));
    } finally {
      spy.mockRestore();
    }
    expect(plans.some((d) => d.startsWith("SCAN adjustment_endings"))).toBe(false);
    expect(
      plans.some((d) =>
        d.startsWith("SEARCH adjustment_endings USING INDEX adjustment_endings_working_order_idx"),
      ),
    ).toBe(true);
  });
});
