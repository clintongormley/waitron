import { randomUUID } from "node:crypto";
import type { Query } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
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
  copyPendingDiscountsToParts,
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

/** A line of `quantity` thousandths at 1.00 each. */
async function lineOf(workingOrderId: string, quantity: number): Promise<string> {
  lineCount += 1;
  const [row] = await db
    .insert(workingOrderLines)
    .values({
      workingOrderId,
      lineNo: lineCount,
      name: "Beer",
      descriptions: { es: "Beer" },
      quantity,
      unitPriceGross: 100,
      lineTotal: quantity / 10,
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

// Every statement, raw or built, reaches SQLite through the session's `prepareQuery`.
type Session = { prepareQuery(query: Query, ...rest: unknown[]): { all(): unknown } };

/** The plan of the one statement `readPendingDiscounts` sends. */
async function planOfRead(billIds: readonly string[]): Promise<string[]> {
  return inTx(async (tx) => {
    const session = (tx as unknown as { session: Session }).session;
    const prepare = vi.spyOn(session, "prepareQuery");
    let sent: Query[];
    try {
      await readPendingDiscounts(tx, billIds);
      sent = prepare.mock.calls.map(([query]) => query);
    } finally {
      prepare.mockRestore();
    }
    expect(sent).toHaveLength(1);
    const rows = session
      .prepareQuery(
        { sql: `explain query plan ${sent[0]!.sql}`, params: sent[0]!.params },
        undefined,
        "all",
        false,
      )
      .all() as { detail: string }[];
    return rows.map((row) => row.detail);
  });
}

async function held(billIds: readonly string[]) {
  const rows = await inTx((tx) => readPendingDiscounts(tx, billIds));
  return rows.map(({ id, billId, amount, sharedFrom }) => ({ id, billId, amount, sharedFrom }));
}

describe("pending-discounts: the store's writer of bill_discounts", () => {
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

  it("reads one bill's rows through the bill's and its lines' indexes, never the whole table", async () => {
    const order = await bill();
    expect(await planOfRead([order])).toEqual([
      "COMPOUND QUERY",
      "LEFT-MOST SUBQUERY",
      "SEARCH bill_discounts USING INDEX bill_discounts_working_order_idx (working_order_id=?)",
      "LIST SUBQUERY 1",
      "SCAN json_each VIRTUAL TABLE INDEX 1:",
      "UNION ALL",
      "SEARCH working_order_lines USING INDEX working_order_lines_line_no_key (working_order_id=?)",
      "LIST SUBQUERY 3",
      "SCAN json_each VIRTUAL TABLE INDEX 1:",
      "SEARCH bill_discounts USING INDEX bill_discounts_line_idx (line_id=?)",
    ]);
  });

  it("reads each row once, since no row may name both a bill and a line on it", async () => {
    const order = await bill();
    const dish = await burger(order);
    const both = await give({ workingOrderId: order, lineId: dish }).catch((e: unknown) => e);
    expect(String((both as Error).cause ?? both)).toContain("bill_discounts_target_ck");
    const ofBill = await give({ workingOrderId: order });
    const ofDish = await give({ lineId: dish, position: 2 });
    expect((await held([order])).map(({ id }) => id)).toEqual([ofBill, ofDish]);
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

  it("refuses a move of part or all of an amount into itself, leaving the row as it was", async () => {
    const order = await bill();
    const amount = await give({ workingOrderId: order, ...amountOff(500) });
    const unchanged = [{ id: amount, billId: order, amount: 500, sharedFrom: null }];
    for (const cents of [100, 500]) {
      const error = await inTx((tx) => moveShare(tx, amount, cents, amount)).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(RangeError);
      expect(await held([order])).toEqual(unchanged);
    }
  });

  it("reads a bill named twice once, at its first place", async () => {
    const first = await bill();
    const second = await bill();
    const ofFirst = await give({ workingOrderId: first });
    const ofSecond = await give({ workingOrderId: second });
    expect(await held([first, second, first])).toEqual([
      { id: ofFirst, billId: first, amount: null, sharedFrom: null },
      { id: ofSecond, billId: second, amount: null, sharedFrom: null },
    ]);
  });

  it("copies a split line's discounts to its parts, an amount shared by quantity from the line", async () => {
    const billId = await bill();
    const line = await lineOf(billId, 2000);
    const parts = [await lineOf(billId, 1000), await lineOf(billId, 1000)];
    const other = await lineOf(billId, 1000);
    const percent = await give({ lineId: line, position: 1 });
    const free = await give({ lineId: line, action: "comp", percentBp: null, position: 2 });
    const amount = await give({ lineId: line, ...amountOff(101), position: 3 });
    const cent = await give({ lineId: line, ...amountOff(1), position: 4 });
    const untouched = await give({ lineId: other, ...amountOff(50), position: 5 });
    await inTx((tx) =>
      copyPendingDiscountsToParts(
        tx,
        parts.map((to) => ({ from: line, to })),
      ),
    );
    const held = await inTx((tx) => readPendingDiscounts(tx, [billId]));
    const at = (lineId: string) =>
      held
        .filter((row) => row.lineId === lineId)
        .map(({ action, percentBp, amount, position }) => [action, percentBp, amount, position]);
    // 1.01 over 2, 1 and 1: 0.50, 0.25 and 0.25, the cent left over on the line; 0.01 stays whole.
    expect(at(line)).toEqual([
      ["discount_percent", 1000, null, 1],
      ["comp", null, null, 2],
      ["discount_amount", null, 51, 3],
      ["discount_amount", null, 1, 4],
    ]);
    for (const part of parts) {
      expect(at(part)).toEqual([
        ["discount_percent", 1000, null, 1],
        ["comp", null, null, 2],
        ["discount_amount", null, 25, 3],
      ]);
    }
    expect(at(other)).toEqual([["discount_amount", null, 50, 5]]);
    expect(
      held.filter(({ id }) => [percent, free, amount, cent, untouched].includes(id)),
    ).toHaveLength(5);
  });

  it("copies nothing for no splits, or a split line holding no discount", async () => {
    const billId = await bill();
    const line = await lineOf(billId, 2000);
    const part = await lineOf(billId, 1000);
    await inTx(async (tx) => {
      await copyPendingDiscountsToParts(tx, []);
      await copyPendingDiscountsToParts(tx, [{ from: line, to: part }]);
    });
    expect(await inTx((tx) => readPendingDiscounts(tx, [billId]))).toEqual([]);
  });
});
