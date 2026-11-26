import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  billPayments,
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
import { payments } from "@waitron/payments";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { createPrinter } from "@waitron/printing";
import { centsToDecimal, decimal } from "@waitron/shared";
import { setRoutingCell, setZoneSalePolicyOverride } from "@waitron/venue-service";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { readBillEditState } from "./bill-editing.js";
import { moveBill } from "./move-bill.js";
import { moveDishes } from "./testing/bill-action-fixture.js";
import { takeBillPayment } from "./testing/bill-payment-fixture.js";
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
import { handOverOrder, listCounterWaiting } from "./working-order-counter.js";
import { parkOrder } from "./working-order-open.js";
import { listHeldOrders } from "./working-order-held-read.js";
import { listStationQueues } from "./working-order-station-queue.js";
import { payForItems, previewPayForItems, type ItemPick } from "./pay-for-items.js";
import "./errors.js";

// Pay for items on a Counter order already sent to the kitchen, with no receipt yet: the chosen
// dishes move to a bill of their own, which the payment covers, and the kitchen is told nothing.
let v: PartyVenue;
let kitchenPrinterId: string;
let receiptPrinterId: string;
/** The counter zone's offer of Ham, sold by weight: a line the till never splits into portions. */
let hamOffer: string;
let card: FakePaymentProvider;

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
        customerName: { [v.cfg.locale]: "Cured ham" },
        kitchenName: "HAM",
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
    card = new FakePaymentProvider(db);
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

async function cashRequest(billId: string, picks: ItemPick[], applied: string) {
  return {
    submissionId: randomUUID(),
    picks,
    expectedEdits: [await inTx(v, (tx) => readBillEditState(tx, billId))],
    method: "cash" as const,
    applied,
    tip: "0.00",
    tendered: applied,
  };
}

async function payInCash(billId: string, picks: ItemPick[], applied: string) {
  return payForItems(
    deps(),
    v.cfg,
    billId,
    await cashRequest(billId, picks, applied),
    v.operator,
    null,
  );
}

/** Pays for the dishes on the card reader; `onReaderCheckout` hears the reader's stop. */
async function payByReader(
  billId: string,
  picks: ItemPick[],
  applied: string,
  onReaderCheckout?: Parameters<typeof card.collect>[0]["onReaderCheckout"],
) {
  return payForItems(
    { ...deps(), provider: card, ...(onReaderCheckout === undefined ? {} : { onReaderCheckout }) },
    v.cfg,
    billId,
    {
      submissionId: randomUUID(),
      picks,
      expectedEdits: [await inTx(v, (tx) => readBillEditState(tx, billId))],
      method: "card",
      entry: "reader",
      applied,
      tip: "0.00",
    },
    v.operator,
    null,
  );
}

/** Holds the next card at the reader: `atReader` resolves once it is offered, and `answer` lets
 * the reader answer, declining when `decline` or when its checkout was stopped. */
function holdAtReader() {
  let offered!: () => void;
  let answer!: (decline: boolean) => void;
  let stopped = false;
  const atReader = new Promise<void>((resolve) => (offered = resolve));
  const answered = new Promise<boolean>((resolve) => (answer = resolve));
  const collect = card.collect.bind(card);
  vi.spyOn(card, "collect").mockImplementationOnce(async (params) => {
    params.onReaderCheckout?.(async () => {
      stopped = true;
      return "requested";
    });
    offered();
    if ((await answered) || stopped) card.failNextCollect();
    return collect(params);
  });
  return { atReader, answer };
}

/** An amount paid in cash on the bill, as Pay > An amount takes it. */
async function receive(billId: string, amount: string) {
  await takeBillPayment(
    deps(),
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
    },
    v.operator,
  );
}

async function billsNaming(billId: string) {
  return v.db
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(eq(workingOrders.itemsPaidFrom, billId));
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

  it("Waiting lists the paid part with the number it was sent under", async () => {
    const orderId = await sentOrder("Burger", "Paella");
    const { orderNumber } = await billOf(orderId);

    const paid = await payInCash(orderId, [{ lineId: await lineOf(orderId, "Burger") }], "12.00");

    const waiting = await listCounterWaiting({ db: v.db });
    expect(waiting.find((order) => order.id === paid.billId)).toMatchObject({
      status: "settled",
      formerNumbers: [orderNumber],
      total: "12.00",
    });
    expect(waiting.find((order) => order.id === orderId)).toMatchObject({
      status: "placed",
      orderNumber,
      total: "20.00",
    });
  });

  it("a handed-over original keeps the paid part off the kitchen screen", async () => {
    const orderId = await sentOrder("Burger", "Paella");
    const { stationId } = (await kitchenItemOf(await lineOf(orderId, "Burger")))!;
    await inTx(v, (tx) => handOverOrder(tx, v.cfg, orderId));

    const paid = await payInCash(orderId, [{ lineId: await lineOf(orderId, "Burger") }], "12.00");

    const queue = (await inTx(v, (tx) => listStationQueues(tx, [stationId]))).get(stationId)!;
    expect(queue.map((group) => group.orderId)).not.toContain(orderId);
    expect(queue.map((group) => group.orderId)).not.toContain(paid.billId);
    expect((await billOf(paid.billId)).collectedAt).toBe((await billOf(orderId)).collectedAt);
  });

  it("a part-paid original left exactly paid issues its invoice", async () => {
    const orderId = await sentOrder("Burger", "Paella");
    await receive(orderId, "20.00");

    await payInCash(orderId, [{ lineId: await lineOf(orderId, "Burger") }], "12.00");

    expect((await billOf(orderId)).status).toBe("settled");
    expect((await salesOf(orderId)).map(({ total }) => centsToDecimal(total))).toEqual(["20.00"]);
  });

  it("a part-paid original left holding more than it owes keeps the money, issuing nothing", async () => {
    const orderId = await sentOrder("Burger", "Paella");
    await receive(orderId, "25.00");

    const paid = await payInCash(orderId, [{ lineId: await lineOf(orderId, "Burger") }], "12.00");

    expect((await billOf(paid.billId)).status).toBe("settled");
    expect((await billOf(orderId)).status).toBe("placed");
    expect(await salesOf(orderId)).toEqual([]);
    const kept = await v.db
      .select({ applied: billPayments.applied, state: billPayments.state })
      .from(billPayments)
      .where(eq(billPayments.workingOrderId, orderId));
    expect(kept.map(({ applied, state }) => [centsToDecimal(applied), state])).toEqual([
      ["25.00", "received"],
    ]);
  });

  it("the same submission twice makes one bill", async () => {
    const orderId = await sentOrder("Burger", "Paella");
    const request = await cashRequest(
      orderId,
      [{ lineId: await lineOf(orderId, "Burger") }],
      "12.00",
    );

    const first = await payForItems(deps(), v.cfg, orderId, request, v.operator, null);
    const again = await payForItems(deps(), v.cfg, orderId, request, v.operator, null);

    expect(again.billId).toBe(first.billId);
    expect(await billsNaming(orderId)).toEqual([{ id: first.billId }]);
    expect(await salesOf(first.billId)).toHaveLength(1);
    expect(await dishesOf(orderId)).toEqual([["Paella", "1.000"]]);
    expect((await billOf(orderId)).status).toBe("placed");
  });

  it("the preview prices a sent Counter order's chosen dishes, writing nothing", async () => {
    const orderId = await sentOrder("Burger", "Paella");
    const before = await rowsOf(orderId);

    expect(
      await previewPayForItems(
        deps(),
        v.cfg,
        orderId,
        { picks: [{ lineId: await lineOf(orderId, "Burger") }], method: "cash", tendered: "20.00" },
        null,
      ),
    ).toEqual({ total: "12.00", applied: "12.00", tip: "0.00", change: "8.00" });
    expect(await rowsOf(orderId)).toEqual(before);
    expect(await billsNaming(orderId)).toEqual([]);
  });

  it("a declined card puts every dish back on the sent order, placed again", async () => {
    const orderId = await sentOrder("Burger", "Paella");
    const reader = holdAtReader();

    const paying = payByReader(orderId, [{ lineId: await lineOf(orderId, "Burger") }], "12.00");
    await reader.atReader;
    const atReader = await billOf(orderId);
    const before = [kitchenJobs(), kitchenNotices()];
    reader.answer(true);
    const paid = await paying;

    expect(paid.payment.outcome).toBe("declined");
    expect(await billOf(paid.billId)).toMatchObject({ status: "abandoned" });
    expect(await dishesOf(paid.billId)).toEqual([]);
    // The put-back adds the dishes after those left on the order.
    expect(await dishesOf(orderId)).toEqual([
      ["Paella", "1.000"],
      ["Burger", "1.000"],
    ]);
    const after = await billOf(orderId);
    expect(after.status).toBe("placed");
    expect(after.revision).toBeGreaterThan(atReader.revision);
    expect(await salesOf(orderId)).toEqual([]);
    expect([kitchenJobs(), kitchenNotices()]).toEqual(before);
  });

  it("Cancel payment at the reader does the same", async () => {
    const orderId = await sentOrder("Burger", "Paella");
    const reader = holdAtReader();
    let stop: (() => Promise<unknown>) | undefined;

    const paying = payByReader(
      orderId,
      [{ lineId: await lineOf(orderId, "Burger") }],
      "12.00",
      (readerStop) => (stop = readerStop),
    );
    await reader.atReader;
    // Cancel payment calls the reader's stop, as the cancel route does; the reader charges nothing.
    expect(await stop!()).toBe("requested");
    reader.answer(false);
    const paid = await paying;

    expect(paid.payment.outcome).toBe("declined");
    expect((await billOf(paid.billId)).status).toBe("abandoned");
    expect(await dishesOf(orderId)).toEqual([
      ["Paella", "1.000"],
      ["Burger", "1.000"],
    ]);
    expect((await billOf(orderId)).status).toBe("placed");
    expect(paid.sourceBalance).toMatchObject({ workingOrderId: orderId, outstanding: "32.00" });
  });

  it("a captured card settles the paid part and leaves the original placed", async () => {
    const orderId = await sentOrder("Burger", "Paella");
    const before = [kitchenJobs(), kitchenNotices()];

    const paid = await payByReader(orderId, [{ lineId: await lineOf(orderId, "Burger") }], "12.00");

    expect(paid.payment.outcome).toBe("received");
    expect((await billOf(paid.billId)).status).toBe("settled");
    expect((await salesOf(paid.billId)).map(({ total }) => centsToDecimal(total))).toEqual([
      "12.00",
    ]);
    expect(await dishesOf(paid.billId)).toEqual([["Burger", "1.000"]]);
    expect((await billOf(orderId)).status).toBe("placed");
    expect(await dishesOf(orderId)).toEqual([["Paella", "1.000"]]);
    expect(await salesOf(orderId)).toEqual([]);
    expect([kitchenJobs(), kitchenNotices()]).toEqual(before);
  });

  it("a put-back refused after a stalled card leaves the original placed and the dish on its own open bill", async () => {
    const orderId = await sentOrder("Burger", "Paella");
    card.stallNextCollect();
    const paid = await payByReader(orderId, [{ lineId: await lineOf(orderId, "Burger") }], "12.00");
    expect(paid.payment.outcome).toBe("timeout");
    const [payment] = await v.db
      .select({ id: billPayments.id })
      .from(billPayments)
      .where(eq(billPayments.workingOrderId, paid.billId));
    await inTx(v, (tx) =>
      tx
        .update(payments)
        .set({
          state: "failed",
          resolvedBy: null,
          resolutionOutcome: "failed",
          resolutionCancelledAtProvider: true,
          resolutionProviderStatus: "canceled",
          resolvedAt: v.clock.now().instant.toISOString(),
        })
        .where(eq(payments.billPaymentId, payment!.id)),
    );
    const atReader = await billOf(orderId);
    expect(atReader.status).toBe("placed");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let warned: unknown[][] = [];
    // The lowered limit refuses the move back once the original is open again.
    await settlePendingBillPayments({
      ...deps(),
      cfg: { ...v.cfg, simplifiedInvoiceLimit: decimal("25.00") },
    }).finally(() => {
      warned = [...warn.mock.calls];
      warn.mockRestore();
    });

    expect(warned).toContainEqual([
      "payment.items_put_back_refused",
      expect.objectContaining({
        billPaymentId: payment!.id,
        code: "sale.total_exceeds_simplified_limit",
      }),
    ]);
    const after = await billOf(orderId);
    expect(after.status).toBe("placed");
    expect(after.revision).toBe(atReader.revision);
    expect(await dishesOf(orderId)).toEqual([["Paella", "1.000"]]);
    expect((await billOf(paid.billId)).status).toBe("open");
    expect(await dishesOf(paid.billId)).toEqual([["Burger", "1.000"]]);
  });

  it("a declined card after the original was paid meanwhile leaves the dishes on an open bill listed under Held orders", async () => {
    const orderId = await sentOrder("Burger", "Paella");
    const { orderNumber } = await billOf(orderId);
    const reader = holdAtReader();

    const paying = payByReader(orderId, [{ lineId: await lineOf(orderId, "Burger") }], "12.00");
    await reader.atReader;
    await receive(orderId, "20.00");
    reader.answer(true);
    const paid = await paying;

    expect(paid.payment.outcome).toBe("declined");
    expect((await billOf(orderId)).status).toBe("settled");
    expect((await salesOf(orderId)).map(({ total }) => centsToDecimal(total))).toEqual(["20.00"]);
    expect((await billOf(paid.billId)).status).toBe("open");
    expect(await dishesOf(paid.billId)).toEqual([["Burger", "1.000"]]);
    const held = await listHeldOrders({ db: v.db });
    expect(held.find((order) => order.id === paid.billId)).toMatchObject({
      formerNumbers: [orderNumber],
      total: "12.00",
    });
  });
});
