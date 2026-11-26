import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adjustmentEndings,
  adjustmentLines,
  captureError,
  CORE_MIGRATIONS,
  refusalOn,
  UNIQUE_VIOLATION,
  withTransaction,
  workingOrderLines,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { decimal, stringToThousandths } from "@waitron/shared";
import { endAdjustment, endingRestores } from "./endings.js";
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

/** A row of `quantity` à la carte Hakes (16.00) on `workingOrderId`, at 10% off: 14.40 each. */
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
  it("gives an à la carte Hake its 16.00 back, clears its list price and records one ending, as endingRestores answered beforehand without writing", async () => {
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

  it("ends a discount on each bill its rows reached at most once, giving back only that bill's rows", async () => {
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

    const again = await captureError(() => endOn(second));
    expect(
      refusalOn(again, UNIQUE_VIOLATION, {
        table: "adjustment_endings",
        columns: ["adjustment_id", "working_order_id"],
      }),
    ).toBe(true);
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
});
