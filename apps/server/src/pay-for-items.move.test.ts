import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  ADJUSTMENTS_PERMISSIONS,
  adjustmentLines,
  createAdjustmentReason,
} from "@waitron/adjustments";
import { sales, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { registerModulePermissions } from "@waitron/identity";
import { createExtraList, createProduct, writeProductModifiers } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { centsToDecimal } from "@waitron/shared";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { moveDishes } from "./testing/bill-action-fixture.js";
import { takeBillPayment } from "./testing/bill-payment-fixture.js";
import { placeGrouped, REASONS } from "./testing/adjustment-venue.js";
import { setMenuOnFullMenu } from "./testing/set-menu-bill-fixture.js";
import { setMenuBill } from "./testing/set-menu-readers-fixture.js";
import {
  OPERATOR,
  commandFor,
  counterOrder,
  inTx,
  seatWithNoAllergies as seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import type { TabRoundLine } from "./working-order.js";
import { moveItemsToNewBill, priceItemPicks, type ItemPick } from "./pay-for-items.js";
import "./errors.js";

let v: PartyVenue;
let offers: ZoneOffers;
let ids: Record<"soup" | "hake" | "beer" | "salad" | "burger" | "cheese" | "toppings", string>;
let houseReason: string;
let setMenu: Awaited<ReturnType<typeof setMenuOnFullMenu>>;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    registerModulePermissions(ADJUSTMENTS_PERMISSIONS);
    v = await setupPartyVenue(db);
    setMenu = await inTx(v, (tx) => setMenuOnFullMenu(tx, v.tables.menuId, v.productId("Flan")));
    await inTx(v, async (tx) => {
      const category = (
        await tx.all<{ categoryId: string }>(
          sql`select category_id as categoryId from products where id = ${v.productId("Burger")}`,
        )
      )[0]!.categoryId;
      const product = async (name: string, unitPrice: string) =>
        (
          await createProduct(tx, {
            categoryId: category,
            name,
            customerName: { [v.cfg.locale]: `${name} (customer)` },
            kitchenName: name.toUpperCase(),
            pricingUnit: "each",
            unitPrice,
            vatClass: "general",
          })
        ).id;
      const soup = await product("Soup", "6.00");
      const hake = await product("Hake", "15.00");
      const beer = await product("Beer", "2.50");
      const salad = await product("Salad", "10.00");
      const cheese = await product("Cheese", "1.00");
      const toppings = (
        await createExtraList(
          tx,
          {
            name: "Toppings",
            customerName: null,
            kitchenName: null,
            minPicks: 0,
            maxPicks: null,
            active: true,
            items: [{ productId: cheese, maxQuantity: 2, preselected: false, price: null }],
          },
          v.cfg.locale,
        )
      ).id;
      const burger = v.productId("Burger");
      await writeProductModifiers(tx, burger, [{ kind: "extras", id: toppings }]);
      offers = await offerProducts(tx, { zone: "tables" });
      ids = { soup, hake, beer, salad, burger, cheese, toppings };
      houseReason = (await createAdjustmentReason(tx, REASONS.house)).id;
    });
  },
});

type Line = { product: keyof typeof ids; quantity?: string; cheese?: number };

/** A party at a fresh table whose bill holds `lines` sent, each one stored row of its count. */
async function seatedBill(...lines: Line[]): Promise<{ partyId: string; billId: string }> {
  const seated = await seat(v, await v.table(`Pay ${randomUUID().slice(0, 8)}`));
  await place(seated, lines);
  return { partyId: seated.partyId, billId: seated.tabId };
}

/** `lines` sent onto the party's bill, each one stored row of its count. */
async function place(seated: { partyId: string; tabId: string }, lines: Line[]) {
  const round: TabRoundLine[] = offers.toOfferLines(
    lines.map((line) => ({
      productId: ids[line.product],
      quantity: line.quantity ?? "1",
      ...(line.cheese === undefined
        ? {}
        : {
            extras: [
              { listId: ids.toppings, picks: [{ productId: ids.cheese, quantity: line.cheese }] },
            ],
          }),
    })),
  );
  await inTx(v, (tx) => placeGrouped(tx, v.cfg, seated, round, "fire", OPERATOR));
}

/** A party whose bill holds the set menu (14.00) and its Flan, the Flan carrying a 2.00 supplement. */
async function setMenuParty() {
  const bill = await setMenuBill({ venue: v, copy: setMenu });
  await v.db
    .update(workingOrderLines)
    .set({ unitPriceGross: 200, lineTotal: 200 })
    .where(eq(workingOrderLines.id, bill.dishId));
  return bill;
}

function rowsOf(billId: string) {
  return v.db
    .select({
      id: workingOrderLines.id,
      productId: workingOrderLines.productId,
      parentLineId: workingOrderLines.parentLineId,
      quantity: workingOrderLines.quantity,
      lineTotal: workingOrderLines.lineTotal,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(asc(workingOrderLines.lineNo));
}

async function lineOf(billId: string, product: keyof typeof ids): Promise<string> {
  const row = (await rowsOf(billId)).find(
    (r) => r.productId === ids[product] && r.parentLineId === null,
  );
  return row!.id;
}

/** The bill's dishes as [product, quantity, line total]. */
async function dishesOf(billId: string): Promise<[string, string, string][]> {
  const names = new Map(Object.entries(ids).map(([name, id]) => [id, name]));
  return (await rowsOf(billId))
    .filter((row) => row.parentLineId === null)
    .map((row) => [
      names.get(row.productId!) ?? row.productId!,
      (row.quantity / 1000).toFixed(3),
      centsToDecimal(row.lineTotal),
    ]);
}

async function billOf(billId: string) {
  const [row] = await v.db
    .select({
      status: workingOrders.status,
      partyId: workingOrders.partyId,
      itemsPaidFrom: workingOrders.itemsPaidFrom,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  return row;
}

function billsNaming(sourceId: string) {
  return v.db
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(eq(workingOrders.itemsPaidFrom, sourceId));
}

const sale = () => ({
  deps: { admission: testTradingAdmission(), db: v.db, backend: v.backend, clock: v.clock },
  cfg: v.cfg,
});

/** What the till sends: the party's revision when there is a party, and the bill's editor. */
async function commandOf(partyId: string | null, billId: string) {
  return {
    ...(partyId === null
      ? { operatorId: OPERATOR }
      : { ...(await commandFor(v, partyId)), partyId }),
    expectedEdits: [await inTx(v, (tx) => readBillEditState(tx, billId))],
    admission: testTradingAdmission(),
  };
}

async function payFor(partyId: string | null, billId: string, picks: ItemPick[]) {
  const command = await commandOf(partyId, billId);
  return inTx(v, (tx) => moveItemsToNewBill(tx, v.cfg, billId, picks, command, sale()));
}

async function receive(billId: string, amount: string, ownReceipt = false) {
  await takeBillPayment(
    { admission: testTradingAdmission(), db: v.db, backend: v.backend, clock: v.clock },
    v.cfg,
    billId,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      method: "cash",
      tendered: amount,
      applied: amount,
      tip: "0.00",
      ...(ownReceipt ? { ownReceipt: true } : {}),
    },
    v.operator,
  );
}

function count(table: "print_jobs" | "kitchen_notices"): number {
  return v.db.all<{ n: number }>(sql.raw(`select count(*) as n from ${table}`))[0]!.n;
}

describe("A1515 pay for items: moving the chosen items to a new bill", () => {
  it("moves whole lines to a new bill of the party that names its source", async () => {
    const { partyId, billId } = await seatedBill({ product: "soup" }, { product: "hake" });

    const moved = await payFor(partyId, billId, [{ lineId: await lineOf(billId, "hake") }]);

    expect(await dishesOf(moved.billId)).toEqual([["hake", "1.000", "15.00"]]);
    expect(await billOf(moved.billId)).toEqual({
      status: "open",
      partyId,
      itemsPaidFrom: billId,
    });
    expect(await dishesOf(billId)).toEqual([["soup", "1.000", "6.00"]]);
  });

  it("moves one of three units of a line", async () => {
    const { partyId, billId } = await seatedBill({ product: "beer", quantity: "3" });
    const beer = await lineOf(billId, "beer");
    const picks = [{ lineId: beer, quantity: "1" }];

    expect(await inTx(v, (tx) => priceItemPicks(tx, billId, picks))).toBe("2.50");
    const moved = await payFor(partyId, billId, picks);

    expect(await dishesOf(moved.billId)).toEqual([["beer", "1.000", "2.50"]]);
    expect(await dishesOf(billId)).toEqual([["beer", "2.000", "5.00"]]);
  });

  it("carries a dish's own comp with it", async () => {
    const { partyId, billId } = await seatedBill({ product: "soup" }, { product: "hake" });
    const hake = await lineOf(billId, "hake");
    await inTx(v, async (tx) => {
      const [order] = await tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, billId));
      await applyAdjustment(
        tx,
        v.cfg,
        {
          admission: testTradingAdmission(),
          orderId: billId,
          expectedEdit: await readBillEditState(tx, billId),
          expectedRevision: order!.revision,
          submissionId: randomUUID(),
          lineId: hake,
          reasonId: houseReason,
          action: "comp",
          note: null,
          operatorId: OPERATOR,
        },
        v.cfg.locale,
      );
    });
    const comped = await v.db
      .select()
      .from(adjustmentLines)
      .where(eq(adjustmentLines.lineId, hake));
    expect(comped).toHaveLength(1);

    const moved = await payFor(partyId, billId, [{ lineId: hake }]);

    expect(await dishesOf(moved.billId)).toEqual([["hake", "1.000", "0.00"]]);
    expect(await rowsOf(moved.billId)).toEqual([expect.objectContaining({ id: hake })]);
    expect(
      await v.db.select().from(adjustmentLines).where(eq(adjustmentLines.lineId, hake)),
    ).toEqual(comped);
  });

  it("refuses part of a line whose extras do not split evenly, moving nothing", async () => {
    const { partyId, billId } = await seatedBill(
      { product: "burger", quantity: "3", cheese: 1 },
      { product: "soup" },
    );
    // Two cheeses across three burgers, as a cancel of one of their cheeses leaves the line.
    const cheese = (await rowsOf(billId)).find((row) => row.productId === ids.cheese)!;
    expect(cheese.quantity).toBe(3000);
    await v.db
      .update(workingOrderLines)
      .set({ quantity: 2000, lineTotal: 200 })
      .where(eq(workingOrderLines.id, cheese.id));
    const before = await rowsOf(billId);

    await expect(
      payFor(partyId, billId, [{ lineId: await lineOf(billId, "burger"), quantity: "1" }]),
    ).rejects.toMatchObject({ code: "tab.transfer_modifier_line" });

    expect(await billsNaming(billId)).toEqual([]);
    expect(await rowsOf(billId)).toEqual(before);
  });

  it("refuses taking the bill below its advances", async () => {
    const { partyId, billId } = await seatedBill(
      { product: "salad" },
      { product: "beer", quantity: "4" },
    );
    await receive(billId, "15.00", true);

    await expect(
      payFor(partyId, billId, [{ lineId: await lineOf(billId, "salad") }]),
    ).rejects.toMatchObject({ code: "bill.below_advances", params: { advances: "15.00" } });
    expect(await billsNaming(billId)).toEqual([]);
  });

  it("refuses choosing a set menu that is everything on the bill, moving nothing", async () => {
    const { partyId, billId, menuLineId } = await setMenuParty();
    const before = await rowsOf(billId);

    await expect(payFor(partyId, billId, [{ lineId: menuLineId }])).rejects.toMatchObject({
      code: "bill.all_items_chosen",
    });
    expect(await billsNaming(billId)).toEqual([]);
    expect(await rowsOf(billId)).toEqual(before);
  });

  it("prices a chosen set menu with its dishes' supplements, and moves them with it", async () => {
    const { partyId, billId, menuLineId, dishId } = await setMenuParty();
    await place({ partyId, tabId: billId }, [
      { product: "soup" },
      { product: "beer", quantity: "3" },
    ]);
    const picks = [{ lineId: menuLineId }, { lineId: await lineOf(billId, "beer"), quantity: "1" }];

    expect(await inTx(v, (tx) => priceItemPicks(tx, billId, picks))).toBe("18.50");
    const moved = await payFor(partyId, billId, picks);

    const ids = (await rowsOf(moved.billId)).map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining([menuLineId, dishId]));
    expect(ids).toHaveLength(3);
    expect(await dishesOf(billId)).toEqual([
      ["soup", "1.000", "6.00"],
      ["beer", "2.000", "5.00"],
    ]);
  });

  it("accepts leaving the bill owing exactly its advances", async () => {
    const { partyId, billId } = await seatedBill(
      { product: "salad" },
      { product: "beer", quantity: "4" },
    );
    await receive(billId, "10.00", true);

    const moved = await payFor(partyId, billId, [{ lineId: await lineOf(billId, "salad") }]);

    expect(await dishesOf(moved.billId)).toEqual([["salad", "1.000", "10.00"]]);
    expect(await dishesOf(billId)).toEqual([["beer", "4.000", "10.00"]]);
  });

  it("answers a stale party's refusal before looking at the items", async () => {
    const { partyId, billId } = await seatedBill(
      { product: "soup" },
      { product: "beer", quantity: "3" },
    );
    const command = await commandOf(partyId, billId);
    const { expectedPartyRevision } = await commandFor(v, partyId);
    const stale = { ...command, expectedPartyRevision: expectedPartyRevision - 1 };
    const beer = await lineOf(billId, "beer");

    await expect(
      inTx(v, (tx) =>
        moveItemsToNewBill(tx, v.cfg, billId, [{ lineId: beer, quantity: "9" }], stale, sale()),
      ),
    ).rejects.toMatchObject({ code: "party.out_of_date" });
    // The same choice under the party's revision is refused for its quantity.
    await expect(payFor(partyId, billId, [{ lineId: beer, quantity: "9" }])).rejects.toMatchObject({
      code: "tab.transfer_quantity_invalid",
    });
  });

  it("answers a presented bill's refusal, not the every-item one", async () => {
    const { partyId, billId } = await seatedBill({ product: "soup" });
    await v.db.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, billId));

    await expect(
      payFor(partyId, billId, [{ lineId: await lineOf(billId, "soup") }]),
    ).rejects.toMatchObject({ code: "bill.presented" });
  });

  it("refuses every dish", async () => {
    const { partyId, billId } = await seatedBill(
      { product: "soup" },
      { product: "beer", quantity: "3" },
    );

    await expect(
      payFor(partyId, billId, [
        { lineId: await lineOf(billId, "soup") },
        { lineId: await lineOf(billId, "beer"), quantity: "3" },
      ]),
    ).rejects.toMatchObject({ code: "bill.all_items_chosen" });
    expect(await billsNaming(billId)).toEqual([]);
  });

  it("tells the kitchen nothing", async () => {
    const paying = await seatedBill({ product: "soup" }, { product: "hake" });
    const jobs = count("print_jobs");
    const notices = count("kitchen_notices");

    await payFor(paying.partyId, paying.billId, [{ lineId: await lineOf(paying.billId, "hake") }]);

    expect([count("print_jobs"), count("kitchen_notices")]).toEqual([jobs, notices]);

    // The same dishes through Move dishes: the kitchen is told, so the counts above could move.
    const moving = await seatedBill({ product: "soup" }, { product: "hake" });
    const hake = await lineOf(moving.billId, "hake");
    const command = await commandOf(moving.partyId, moving.billId);
    await inTx(v, (tx) => moveDishes(tx, v.cfg, moving.billId, null, [hake], command));
    expect(count("print_jobs") + count("kitchen_notices")).toBeGreaterThan(jobs + notices);
  });

  it("a source left exactly paid issues its invoice", async () => {
    const { partyId, billId } = await seatedBill(
      { product: "salad" },
      { product: "beer", quantity: "4" },
    );
    await receive(billId, "10.00");

    await payFor(partyId, billId, [{ lineId: await lineOf(billId, "salad") }]);

    expect((await billOf(billId))!.status).toBe("settled");
    const [invoice] = await v.db
      .select({ total: sales.total })
      .from(sales)
      .where(eq(sales.workingOrderId, billId));
    expect(centsToDecimal(invoice!.total)).toBe("10.00");
  });

  it("leaves a source that received more than it now owes holding the money, issuing nothing", async () => {
    const { partyId, billId } = await seatedBill(
      { product: "salad" },
      { product: "beer", quantity: "4" },
    );
    await receive(billId, "15.00");

    const moved = await payFor(partyId, billId, [{ lineId: await lineOf(billId, "salad") }]);

    expect(await dishesOf(moved.billId)).toEqual([["salad", "1.000", "10.00"]]);
    expect((await billOf(billId))!.status).toBe("open");
    expect(await v.db.select().from(sales).where(eq(sales.workingOrderId, billId))).toEqual([]);
  });

  it("a counter order's items go to a new counter order", async () => {
    const id = await counterOrder(v, "Burger", "Flan");
    const burger = (await rowsOf(id)).find((row) => row.productId === ids.burger)!.id;

    const moved = await payFor(null, id, [{ lineId: burger }]);

    expect(await billOf(moved.billId)).toEqual({
      status: "open",
      partyId: null,
      itemsPaidFrom: id,
    });
    expect((await rowsOf(moved.billId)).map((row) => row.id)).toEqual([burger]);
  });

  it("Move dishes still refuses an overpaid source", async () => {
    const { partyId, billId } = await seatedBill(
      { product: "salad" },
      { product: "beer", quantity: "4" },
    );
    await receive(billId, "15.00");

    const salad = await lineOf(billId, "salad");
    const command = await commandOf(partyId, billId);
    await expect(
      inTx(v, (tx) => moveDishes(tx, v.cfg, billId, null, [salad], command)),
    ).rejects.toMatchObject({ code: "bill.received_exceeds_total" });
  });
});
