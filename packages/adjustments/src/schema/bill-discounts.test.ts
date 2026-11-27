import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  billDiscounts,
  captureError,
  checkFailed,
  CORE_MIGRATIONS,
  menus,
  menuVersions,
  workingOrderLines,
  workingOrders,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { stringToThousandths } from "@waitron/shared";
import { policySnapshotOf } from "../policy.js";
import { seedReason, seedWorkingOrder } from "../../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

let db: Database;
beforeAll(() => {
  db = suite.db;
});

const WAITER = "11111111-1111-4111-8111-111111111111";

type Pending = typeof billDiscounts.$inferInsert;

let lineCount = 0;

/** A €10.00 Burger on `workingOrderId`; returns its id. */
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

/** A set menu's own row on `workingOrderId`; returns its id and the menu's. */
async function setMenuRow(workingOrderId: string): Promise<{ lineId: string; menuId: string }> {
  const [menu] = await db.insert(menus).values({ name: "Daily" }).returning({ id: menus.id });
  const [version] = await db
    .insert(menuVersions)
    .values({
      menuId: menu!.id,
      number: 1,
      document: {} as never,
      contentHash: "hash",
      createdAt: new Date(),
      createdBy: WAITER,
    })
    .returning({ id: menuVersions.id });
  lineCount += 1;
  const [row] = await db
    .insert(workingOrderLines)
    .values({
      workingOrderId,
      lineNo: lineCount,
      name: "Daily",
      descriptions: { es: "Daily" },
      quantity: stringToThousandths("1"),
      unitPriceGross: 2200,
      lineTotal: 2200,
      setMenuRole: "set_menu",
      setMenuId: menu!.id,
      setMenuVersionId: version!.id,
    })
    .returning({ id: workingOrderLines.id });
  return { lineId: row!.id, menuId: menu!.id };
}

/** A bill with a person and a reason to give discounts under; returns the bill's id. */
async function bill(): Promise<string> {
  await seedPerson(db, { id: WAITER, displayName: "Waiter" });
  return seedWorkingOrder(db);
}

/** A pending 10% given by the waiter, on whatever target `row` names; returns its id. */
async function give(row: Partial<Pending>): Promise<string> {
  const reason = await seedReason(db);
  const id = randomUUID();
  await db.insert(billDiscounts).values({
    id,
    action: "discount_percent",
    percentBp: 1000,
    origin: "given",
    givenTogether: randomUUID(),
    position: 1,
    reasonId: reason.id,
    reasonName: reason.name,
    policySnapshot: policySnapshotOf(reason, { maxBillComp: null }),
    requestedBy: WAITER,
    givenAt: new Date().toISOString(),
    ...row,
  });
  return id;
}

async function refusedBy(row: Partial<Pending>, constraint: string): Promise<void> {
  const error = await captureError(() => give(row));
  expect(checkFailed(error, constraint), constraint).toBe(true);
}

async function pendingIds(): Promise<string[]> {
  const rows = await db.select({ id: billDiscounts.id }).from(billDiscounts);
  return rows.map(({ id }) => id).sort();
}

async function pending(id: string) {
  const [row] = await db.select().from(billDiscounts).where(eq(billDiscounts.id, id));
  return row;
}

describe("A1621 bill_discounts: a discount held on an open bill until its invoice", () => {
  it("takes a dish, a bill, a set menu and a set menu whose row is gone as targets", async () => {
    const order = await bill();
    const line = await burger(order);
    const { lineId, menuId } = await setMenuRow(order);
    const ids = [
      await give({ lineId: line }),
      await give({ workingOrderId: order }),
      await give({
        workingOrderId: order,
        setMenuLineId: lineId,
        setMenuId: menuId,
        setMenuName: "Daily",
      }),
      await give({ workingOrderId: order, setMenuId: menuId, setMenuName: "Daily" }),
    ];
    expect(await pendingIds()).toEqual(ids.sort());
  });

  it("refuses a row naming no target, or more than one", async () => {
    const order = await bill();
    const line = await burger(order);
    const { lineId, menuId } = await setMenuRow(order);
    const target = "bill_discounts_target_ck";
    await refusedBy({}, target);
    await refusedBy({ lineId: line, workingOrderId: order }, target);
    await refusedBy({ lineId: line, setMenuId: menuId, setMenuName: "Daily" }, target);
    await refusedBy({ lineId: line, setMenuLineId: lineId }, target);
    await refusedBy({ workingOrderId: order, setMenuLineId: lineId }, target);
    await refusedBy({ workingOrderId: order, setMenuId: menuId }, target);
    await refusedBy({ workingOrderId: order, setMenuName: "Daily" }, target);
  });

  it("pairs each action with its percentage or amount", async () => {
    const order = await bill();
    const value = "bill_discounts_value_ck";
    await give({ workingOrderId: order, action: "comp", percentBp: null });
    await give({ workingOrderId: order, action: "discount_amount", percentBp: null, amount: 1 });
    await give({ workingOrderId: order, percentBp: 10000 });
    await refusedBy({ workingOrderId: order, action: "comp" }, value);
    await refusedBy({ workingOrderId: order, action: "comp", percentBp: null, amount: 100 }, value);
    await refusedBy({ workingOrderId: order, percentBp: null }, value);
    await refusedBy({ workingOrderId: order, percentBp: 0 }, value);
    await refusedBy({ workingOrderId: order, percentBp: 10001 }, value);
    await refusedBy({ workingOrderId: order, amount: 100 }, value);
    await refusedBy({ workingOrderId: order, action: "discount_amount", percentBp: null }, value);
    await refusedBy(
      { workingOrderId: order, action: "discount_amount", percentBp: null, amount: 0 },
      value,
    );
    await refusedBy({ workingOrderId: order, action: "discount_amount", amount: 100 }, value);
  });

  it("refuses an unknown action or origin", async () => {
    const order = await bill();
    await refusedBy(
      { workingOrderId: order, action: "cancel" as never },
      "bill_discounts_action_ck",
    );
    await refusedBy(
      { workingOrderId: order, origin: "moved" as never },
      "bill_discounts_origin_ck",
    );
  });

  it("names the source bill on a share and on nothing else", async () => {
    const order = await bill();
    const line = await burger(order);
    const share = {
      lineId: line,
      action: "discount_amount",
      percentBp: null,
      amount: 100,
    } as const;
    const shared = "bill_discounts_shared_from_ck";
    await give({ ...share, origin: "bill_share", sharedFromBillName: "Table 4" });
    await give({
      ...share,
      origin: "bill_share",
      sharedFromBillName: "Table 4",
      sharedFromPercentBp: 1000,
    });
    await refusedBy({ ...share, origin: "bill_share" }, shared);
    await refusedBy({ ...share, origin: "bill_share", sharedFromPercentBp: 1000 }, shared);
    await refusedBy(
      { ...share, origin: "bill_share", sharedFromBillName: "Table 4", sharedFromPercentBp: 0 },
      shared,
    );
    await refusedBy({ ...share, sharedFromBillName: "Table 4" }, shared);
    await refusedBy({ ...share, sharedFromPercentBp: 1000 }, shared);
  });

  it("removes a dish's discount with the dish", async () => {
    const order = await bill();
    const line = await burger(order);
    const kept = await burger(order);
    await give({ lineId: line });
    const other = await give({ lineId: kept });
    await db.delete(workingOrderLines).where(eq(workingOrderLines.id, line));
    expect(await pendingIds()).toEqual([other]);
  });

  it("keeps a set menu's discount, with no row, when its grouping is deleted", async () => {
    const order = await bill();
    const { lineId, menuId } = await setMenuRow(order);
    const id = await give({
      workingOrderId: order,
      setMenuLineId: lineId,
      setMenuId: menuId,
      setMenuName: "Daily",
    });
    await db.delete(workingOrderLines).where(eq(workingOrderLines.id, lineId));
    expect(await pending(id)).toMatchObject({
      setMenuLineId: null,
      setMenuId: menuId,
      setMenuName: "Daily",
    });
  });

  it("keeps a share, with no source, when the row it was split from is deleted", async () => {
    const order = await bill();
    const source = await give({
      workingOrderId: order,
      action: "discount_amount",
      percentBp: null,
      amount: 1000,
    });
    const share = await give({
      workingOrderId: await seedWorkingOrder(db),
      action: "discount_amount",
      percentBp: null,
      amount: 400,
      sharedFrom: source,
    });
    await db.delete(billDiscounts).where(eq(billDiscounts.id, source));
    expect(await pending(share)).toMatchObject({ sharedFrom: null, amount: 400 });
  });

  it("clears an abandoned bill's own discounts and its dishes', and no other bill's", async () => {
    const order = await bill();
    const line = await burger(order);
    await give({ workingOrderId: order });
    await give({ lineId: line });
    const other = await seedWorkingOrder(db);
    const kept = [
      await give({ workingOrderId: other }),
      await give({ lineId: await burger(other) }),
    ];
    await db.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, order));
    expect(await pendingIds()).toEqual(kept.sort());
  });

  it("indexes every foreign key column", async () => {
    const rows = await db.execute<{ name: string }>(
      sql`select il.name as name from pragma_index_list('bill_discounts') as il where il.origin = 'c'`,
    );
    const columns: string[] = [];
    for (const { name } of rows.rows) {
      const info = await db.execute<{ name: string }>(
        sql`select name from pragma_index_info(${name})`,
      );
      columns.push(info.rows[0]!.name);
    }
    expect(columns.sort()).toEqual(
      [
        "approved_by",
        "line_id",
        "requested_by",
        "set_menu_line_id",
        "shared_from",
        "working_order_id",
      ].sort(),
    );
  });
});
