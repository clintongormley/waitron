import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  withTransaction,
  workingOrderLines,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { stringToThousandths } from "@waitron/shared";
import { policySnapshotOf } from "./policy.js";
import {
  deletePendingDiscounts,
  insertPendingDiscount,
  moveShare,
  readPendingDiscounts,
  type NewPendingDiscount,
} from "./pending-discounts.js";
import { seedReason, seedWorkingOrder } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

let db: Database;
beforeAll(() => {
  db = suite.db;
});

const WAITER = "22222222-2222-4222-8222-222222222222";

function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, fn);
}

let lineCount = 0;

async function burger(workingOrderId: string): Promise<string> {
  lineCount += 1;
  const [row] = await db
    .insert(workingOrderLines)
    .values({
      workingOrderId,
      lineNo: lineCount,
      name: "Burger",
      descriptions: { es: "Burger" },
      quantity: stringToThousandths("1"),
      unitPriceGross: 1000,
      lineTotal: 1000,
    })
    .returning({ id: workingOrderLines.id });
  return row!.id;
}

async function bill(): Promise<string> {
  await seedPerson(db, { id: WAITER, displayName: "Waiter" });
  return seedWorkingOrder(db);
}

/** A discount given by the waiter, 10% unless `row` says otherwise. */
async function values(row: Partial<NewPendingDiscount>): Promise<NewPendingDiscount> {
  const reason = await seedReason(db);
  return {
    action: "discount_percent",
    percentBp: 1000,
    origin: "given",
    givenTogether: randomUUID(),
    position: 1,
    reasonId: reason.id,
    reasonName: reason.name,
    policySnapshot: policySnapshotOf(reason, { maxBillComp: null }),
    requestedBy: WAITER,
    givenAt: "2026-11-27T12:00:00.000Z",
    ...row,
  };
}

async function give(row: Partial<NewPendingDiscount>): Promise<string> {
  const given = await values(row);
  return inTx((tx) => insertPendingDiscount(tx, given));
}

const amountOff = (amount: number) =>
  ({ action: "discount_amount", percentBp: null, amount }) as const;

async function held(billIds: readonly string[]) {
  const rows = await inTx((tx) => readPendingDiscounts(tx, billIds));
  return rows.map(({ id, billId, amount, sharedFrom }) => ({ id, billId, amount, sharedFrom }));
}

describe("pending-discounts: the one writer of bill_discounts", () => {
  it("reads each bill's own rows and its lines' rows, in the order given, and no other bill's", async () => {
    const first = await bill();
    const second = await bill();
    const other = await bill();
    const dish = await burger(first);
    const ofDish = await give({ lineId: dish, position: 2 });
    const ofBill = await give({ workingOrderId: first, position: 1 });
    const ofSecond = await give({ workingOrderId: second, position: 1 });
    await give({ workingOrderId: other });
    await give({ lineId: await burger(other) });
    expect(await held([first, second])).toEqual([
      { id: ofBill, billId: first, amount: null, sharedFrom: null },
      { id: ofDish, billId: first, amount: null, sharedFrom: null },
      { id: ofSecond, billId: second, amount: null, sharedFrom: null },
    ]);
  });

  it("reads rows given at one position by id, the same order every time", async () => {
    const order = await bill();
    const ids = ["f", "a", "c"].map((digit) => `${digit.repeat(8)}-0000-4000-8000-000000000000`);
    for (const id of ids) await give({ id, workingOrderId: order });
    expect((await held([order])).map(({ id }) => id)).toEqual([ids[1], ids[2], ids[0]]);
  });

  it("reads nothing for no bills", async () => {
    expect(await held([])).toEqual([]);
  });

  it("keeps every column it was given", async () => {
    const order = await bill();
    const given = await values({ workingOrderId: order, note: "Birthday", approvedBy: WAITER });
    const id = await inTx((tx) => insertPendingDiscount(tx, given));
    const [row] = await inTx((tx) => readPendingDiscounts(tx, [order]));
    expect(row).toEqual({
      ...given,
      id,
      billId: order,
      lineId: null,
      setMenuLineId: null,
      setMenuId: null,
      setMenuName: null,
      amount: null,
      sharedFrom: null,
      sharedFromBillName: null,
      sharedFromPercentBp: null,
    });
  });

  it("deletes the rows named and no others", async () => {
    const order = await bill();
    const gone = [await give({ workingOrderId: order }), await give({ workingOrderId: order })];
    const kept = await give({ workingOrderId: order, position: 2 });
    await inTx((tx) => deletePendingDiscounts(tx, gone));
    expect((await held([order])).map(({ id }) => id)).toEqual([kept]);
    await inTx((tx) => deletePendingDiscounts(tx, []));
    expect((await held([order])).map(({ id }) => id)).toEqual([kept]);
  });

  it("moves part of an amount into a new share, and the share back into it", async () => {
    const source = await bill();
    const target = await bill();
    const dish = await burger(target);
    const from = await give({ workingOrderId: source, ...amountOff(1000) });
    const columns = await values({
      lineId: dish,
      origin: "bill_share",
      sharedFromBillName: "Table 4",
    });
    const share = await inTx((tx) => moveShare(tx, from, 300, columns));
    expect(await held([source, target])).toEqual([
      { id: from, billId: source, amount: 700, sharedFrom: null },
      { id: share, billId: target, amount: 300, sharedFrom: from },
    ]);
    const [row] = await inTx((tx) => readPendingDiscounts(tx, [target]));
    expect(row).toMatchObject({ action: "discount_amount", percentBp: null, origin: "bill_share" });

    await inTx((tx) => moveShare(tx, share, 300, from));
    expect(await held([source, target])).toEqual([
      { id: from, billId: source, amount: 1000, sharedFrom: null },
    ]);
  });

  it("refuses a move from or into a row that is not an amount, or of more than it holds", async () => {
    const order = await bill();
    const percent = await give({ workingOrderId: order });
    const amount = await give({ workingOrderId: order, ...amountOff(500), position: 2 });
    const other = await give({ workingOrderId: order, ...amountOff(500), position: 3 });
    const refused = async (from: string, cents: number, to: string) => {
      const error = await inTx((tx) => moveShare(tx, from, cents, to)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RangeError);
    };
    await refused(percent, 100, amount);
    await refused(amount, 100, percent);
    await refused(amount, 501, other);
    await refused(amount, 0, other);
    await refused(randomUUID(), 100, other);
    expect(await held([order])).toEqual([
      { id: percent, billId: order, amount: null, sharedFrom: null },
      { id: amount, billId: order, amount: 500, sharedFrom: null },
      { id: other, billId: order, amount: 500, sharedFrom: null },
    ]);
  });
});
