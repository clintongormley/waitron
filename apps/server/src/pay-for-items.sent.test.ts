import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  printJobs,
  sales,
  ticketItems,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createProduct } from "@waitron/menu";
import { createPrinter } from "@waitron/printing";
import { centsToDecimal } from "@waitron/shared";
import { setRoutingCell, setZoneSalePolicyOverride } from "@waitron/venue-service";
import { readBillEditState } from "./bill-editing.js";
import { moveBill } from "./move-bill.js";
import { moveDishes } from "./testing/bill-action-fixture.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import {
  OPERATOR,
  commandFor,
  inTx,
  orderForParty,
  seatWithNoAllergies as seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { printSaleReceipt } from "./till-sale.js";
import { attachedPrinter } from "./testing/working-order.test-support.js";
import { offerProducts } from "./testing/zone-offers.js";
import { parkOrder } from "./working-order-open.js";
import { payForItems, type ItemPick } from "./pay-for-items.js";
import "./errors.js";

// Pay for items on a Counter order already sent to the kitchen, with no receipt yet: the chosen
// dishes move to a bill of their own, which the payment covers, and the kitchen is told nothing.
let v: PartyVenue;
let kitchenPrinterId: string;
let receiptPrinterId: string;
/** The counter zone's offer of Ham, sold by weight: a line the till never splits into portions. */
let hamOffer: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
    await inTx(v, async (tx) => {
      await setZoneSalePolicyOverride(tx, v.counter.zoneId, "paidWhen", "ticket_then_pay");
      await setZoneSalePolicyOverride(tx, v.counter.zoneId, "collectionNumber", "numbered");
      const kitchen = await attachedPrinter(tx, { name: "Kitchen" }, "Kitchen printer");
      kitchenPrinterId = kitchen.printerId;
      const [{ categoryId }] = await tx.all<{ categoryId: string }>(
        sql`select category_id as categoryId from products where id = ${v.productId("Burger")}`,
      );
      const ham = await createProduct(tx, {
        categoryId: categoryId!,
        name: "Ham",
        customerName: { [v.cfg.locale]: "Jamón" },
        kitchenName: "JAMON",
        pricingUnit: "weight",
        unitPrice: "20.00",
        vatClass: "general",
      });
      hamOffer = (await offerProducts(tx, { zone: "counter" })).offerFor(ham.id);
      for (const productId of [v.productId("Burger"), v.productId("Paella"), ham.id])
        await setRoutingCell(
          tx,
          { row: { kind: "product", productId }, zoneId: null },
          { kind: "station", stationId: kitchen.station.id },
        );
      receiptPrinterId = (
        await createPrinter(tx, {
          name: "Receipt printer",
          transport: "cloud_poll",
          pollId: `poll-${randomUUID()}`,
        })
      ).id;
    });
    db.run(
      sql`update devices set receipt_printer_id = ${receiptPrinterId} where id = ${v.cfg.origin.deviceId}`,
    );
  },
});

const deps = () => ({
  admission: testTradingAdmission(),
  db: v.db,
  backend: v.backend,
  clock: v.clock,
});

/** A Counter order of the dishes, `quantity` of each when given, sent to the kitchen unpaid. */
async function sentOrder(...dishes: (string | [string, string])[]): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: v.db }, v.cfg, {
    id,
    zoneId: v.counter.zoneId,
    lines: dishes.map((dish) => {
      const [name, quantity] = typeof dish === "string" ? [dish, "1"] : dish;
      return { menuItemId: name === "Ham" ? hamOffer : v.counterItem(name), quantity };
    }),
    operatorId: OPERATOR,
  });
  await placeOrder(deps(), v.cfg, id, OPERATOR);
  return id;
}

/** An order of no party sent from the tables zone, which serves by tab. */
async function sentTablesZoneOrder(...names: string[]): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: v.db }, v.cfg, {
    id,
    zoneId: v.tables.zoneId,
    lines: names.map((name) => ({ menuItemId: v.item(name), quantity: "1" })),
    operatorId: OPERATOR,
  });
  await placeOrder(deps(), v.cfg, id, OPERATOR);
  return id;
}

async function lineOf(billId: string, name: string): Promise<string> {
  const [row] = await v.db
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.name, name)));
  return row!.id;
}

async function payInCash(billId: string, picks: ItemPick[], applied: string) {
  return payForItems(
    deps(),
    v.cfg,
    billId,
    {
      submissionId: randomUUID(),
      picks,
      expectedEdits: [await inTx(v, (tx) => readBillEditState(tx, billId))],
      method: "cash",
      applied,
      tip: "0.00",
      tendered: applied,
    },
    v.operator,
    null,
  );
}

async function billOf(billId: string) {
  const [row] = await v.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
  return row!;
}

async function dishesOf(billId: string): Promise<[string, string][]> {
  const rows = await v.db
    .select({ name: workingOrderLines.name, quantity: workingOrderLines.quantity })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(asc(workingOrderLines.lineNo));
  return rows.map(({ name, quantity }) => [name, (quantity / 1000).toFixed(3)]);
}

async function salesOf(billId: string) {
  return v.db
    .select({ id: sales.id, total: sales.total })
    .from(sales)
    .where(eq(sales.workingOrderId, billId));
}

function count(query: ReturnType<typeof sql>): number {
  return v.db.all<{ n: number }>(query)[0]!.n;
}

const kitchenJobs = () =>
  count(sql`select count(*) as n from print_jobs where printer_id = ${kitchenPrinterId}`);
const kitchenNotices = () => count(sql`select count(*) as n from kitchen_notices`);

async function kitchenItemOf(lineId: string) {
  const [row] = await v.db
    .select({
      id: ticketItems.id,
      firedAt: ticketItems.firedAt,
      state: ticketItems.state,
      stationId: ticketItems.stationId,
      sentOrderNumber: ticketItems.sentOrderNumber,
    })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderLineId, lineId));
  return row;
}

async function rowsOf(billId: string) {
  return {
    bill: await billOf(billId),
    lines: await v.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(asc(workingOrderLines.lineNo)),
  };
}

describe("Pay for items on a sent Counter order", () => {
  it("cash pays for chosen dishes on a sent Counter order on a bill of their own", async () => {
    const orderId = await sentOrder("Burger", "Paella");

    const paid = await payInCash(orderId, [{ lineId: await lineOf(orderId, "Burger") }], "12.00");

    expect(paid.payment.outcome).toBe("received");
    expect(await billOf(paid.billId)).toMatchObject({
      status: "settled",
      itemsPaidFrom: orderId,
    });
    expect((await salesOf(paid.billId)).map(({ total }) => centsToDecimal(total))).toEqual([
      "12.00",
    ]);
    expect(await dishesOf(paid.billId)).toEqual([["Burger", "1.000"]]);
    expect((await billOf(orderId)).status).toBe("placed");
    expect(await dishesOf(orderId)).toEqual([["Paella", "1.000"]]);
    expect(await salesOf(orderId)).toEqual([]);
  });

  it("tells the kitchen nothing", async () => {
    const orderId = await sentOrder("Burger", "Paella");
    const burger = await lineOf(orderId, "Burger");
    const sentItem = await kitchenItemOf(burger);
    const { orderNumber } = await billOf(orderId);
    const before = [kitchenJobs(), kitchenNotices()];

    const paid = await payInCash(orderId, [{ lineId: burger }], "12.00");

    expect([kitchenJobs(), kitchenNotices()]).toEqual(before);
    const moved = await lineOf(paid.billId, "Burger");
    expect(await kitchenItemOf(moved)).toEqual({ ...sentItem, sentOrderNumber: orderNumber });

    // The same dish moved off an open table bill with the kitchen told: the counts above can move.
    const { partyId, tabId } = await seat(v, await v.table(`Sent ${randomUUID().slice(0, 8)}`));
    await orderForParty(v, partyId, ["Burger", "Paella"], tabId);
    const told = [kitchenJobs(), kitchenNotices()];
    const command = {
      ...(await commandFor(v, partyId)),
      partyId,
      expectedEdits: [await inTx(v, (tx) => readBillEditState(tx, tabId))],
    };
    const tableBurger = await lineOf(tabId, "Burger");
    await inTx(v, (tx) => moveDishes(tx, v.cfg, tabId, null, [tableBurger], command));
    expect(kitchenJobs() + kitchenNotices()).toBeGreaterThan(told[0]! + told[1]!);
  });

  it("prints the paid part's receipt and no collection slip", async () => {
    const orderId = await sentOrder("Burger", "Paella");
    const receiptJobs = () =>
      v.db
        .select({ id: printJobs.id, saleId: printJobs.saleId })
        .from(printJobs)
        .where(eq(printJobs.printerId, receiptPrinterId));
    const before = new Set((await receiptJobs()).map((job) => job.id));
    expect(before.size).toBeGreaterThan(0);

    const paid = await payInCash(orderId, [{ lineId: await lineOf(orderId, "Burger") }], "12.00");
    expect((await receiptJobs()).filter((job) => !before.has(job.id))).toEqual([]);
    // The till then asks for the paid part's receipt (`POST /api/sales/:id/receipt`).
    await printSaleReceipt(v, v.cfg, paid.billId, "original", { personId: OPERATOR });

    const added = (await receiptJobs()).filter((job) => !before.has(job.id));
    const [sale] = await salesOf(paid.billId);
    expect(added).toEqual([{ id: expect.any(String), saleId: sale!.id }]);
  });

  it("part of a sent line", async () => {
    const orderId = await sentOrder("Burger", ["Ham", "0.300"]);
    const ham = await lineOf(orderId, "Ham");
    const sentItem = await kitchenItemOf(ham);
    const before = [kitchenJobs(), kitchenNotices()];

    const paid = await payInCash(orderId, [{ lineId: ham, quantity: "0.100" }], "2.00");

    expect(await dishesOf(paid.billId)).toEqual([["Ham", "0.100"]]);
    expect(await dishesOf(orderId)).toEqual([
      ["Burger", "1.000"],
      ["Ham", "0.200"],
    ]);
    expect((await billOf(orderId)).status).toBe("placed");
    expect(await kitchenItemOf(await lineOf(paid.billId, "Ham"))).toMatchObject({
      firedAt: sentItem!.firedAt,
      stationId: sentItem!.stationId,
      sentOrderNumber: (await billOf(orderId)).orderNumber,
    });
    expect(await kitchenItemOf(ham)).toMatchObject({ id: sentItem!.id });
    expect([kitchenJobs(), kitchenNotices()]).toEqual(before);
  });

  it("every dish chosen is refused, the order still placed", async () => {
    const orderId = await sentOrder("Burger", "Paella");
    const before = await rowsOf(orderId);

    await expect(
      payInCash(
        orderId,
        [{ lineId: await lineOf(orderId, "Burger") }, { lineId: await lineOf(orderId, "Paella") }],
        "32.00",
      ),
    ).rejects.toMatchObject({ code: "bill.all_items_chosen" });

    expect(await rowsOf(orderId)).toEqual(before);
    expect(before.bill.status).toBe("placed");
  });

  it("a sent Counter order with a receipt is still refused bill.not_at_table", async () => {
    const orderId = await sentOrder("Burger", "Paella");
    await issueOrderInvoice(deps(), v.cfg, orderId, OPERATOR);

    await expect(
      payInCash(orderId, [{ lineId: await lineOf(orderId, "Burger") }], "12.00"),
    ).rejects.toMatchObject({ code: "bill.not_at_table" });

    expect((await billOf(orderId)).status).toBe("placed");
  });

  it("a no-party order sent in the tables zone is still refused bill.not_at_table", async () => {
    const orderId = await sentTablesZoneOrder("Burger", "Paella");
    expect((await billOf(orderId)).partyId).toBeNull();
    const before = await rowsOf(orderId);

    await expect(
      payInCash(orderId, [{ lineId: await lineOf(orderId, "Burger") }], "12.00"),
    ).rejects.toMatchObject({ code: "bill.not_at_table" });

    expect(await rowsOf(orderId)).toEqual(before);
    expect(before.bill.status).toBe("placed");
  });

  it("an order sent in a Counter zone that takes payment first is still refused", async () => {
    await inTx(v, (tx) => setZoneSalePolicyOverride(tx, v.counter.zoneId, "paidWhen", "prepay"));
    try {
      const orderId = await sentOrder("Burger", "Paella");
      const before = await rowsOf(orderId);

      await expect(
        payInCash(orderId, [{ lineId: await lineOf(orderId, "Burger") }], "12.00"),
      ).rejects.toMatchObject({ code: "bill.not_at_table" });

      expect(await rowsOf(orderId)).toEqual(before);
      expect(before.bill.status).toBe("placed");
    } finally {
      await inTx(v, (tx) =>
        setZoneSalePolicyOverride(tx, v.counter.zoneId, "paidWhen", "ticket_then_pay"),
      );
    }
  });

  it("a sent order at a table is still refused bill.not_issued", async () => {
    const orderId = await sentOrder("Burger", "Paella");
    const tableId = await v.table(`Moved ${randomUUID().slice(0, 8)}`);
    await inTx(v, async (tx: Transaction) =>
      moveBill(
        tx,
        v.cfg,
        orderId,
        { tableId },
        {
          expectedEdits: [await readBillEditState(tx, orderId)],
          partyId: null,
          otherPartyId: null,
          operatorId: OPERATOR,
        },
      ),
    );
    const { partyId } = await billOf(orderId);
    expect(partyId).not.toBeNull();

    await expect(
      payForItems(
        deps(),
        v.cfg,
        orderId,
        {
          submissionId: randomUUID(),
          picks: [{ lineId: await lineOf(orderId, "Burger") }],
          ...(await commandFor(v, partyId!)),
          partyId: partyId!,
          expectedEdits: [await inTx(v, (tx) => readBillEditState(tx, orderId))],
          method: "cash",
          applied: "12.00",
          tip: "0.00",
          tendered: "12.00",
        },
        v.operator,
        null,
      ),
    ).rejects.toMatchObject({ code: "bill.not_issued" });

    expect((await billOf(orderId)).status).toBe("placed");
  });
});
