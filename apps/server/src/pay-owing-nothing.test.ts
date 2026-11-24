import { seedZone } from "@waitron/db/testing/seed.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { randomUUID } from "node:crypto";
import { eq, or, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  billPayments,
  categories,
  drawerOpens,
  saleSettlements,
  sales,
  ticketItems,
  workingOrders,
  workingOrderLines,
} from "@waitron/db";
import { createProduct } from "@waitron/menu";
import { payments } from "@waitron/payments";
import { moveBill } from "./testing/move-bill-fixture.js";
import { createTable } from "./testing/live-table.js";
import { parkOrder } from "./working-order.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { zoneOf } from "./testing/party-venue.js";
import {
  cashPayment,
  inTx,
  partyRevisionOf,
  provisionBillVenue,
  fiscalRecordCount,
  seatedWith,
  send,
  statusOf,
  tendersOfBill,
  type BillVenue,
} from "./testing/bill-venue.js";
import { compWholeBill, seedGivenAwayLine } from "./testing/cancel-line.js";
import "./errors.js";

// Paying a bill that owes nothing: the sale is filed at 0.00 and settled with no tender, no card
// payment row and no cash drawer opening. A bill that still owes, and a refused request, appear
// only as checks on that. Driven over HTTP against a venue that files real Veri*Factu records;
// every case makes its own bill.
let venue: BillVenue;
/** A counter zone where an order pays before the kitchen sees it, offering the free Agua too. */
let counter: ZoneOffers;
let freeWaterId: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    counter = await inTx(venue, async (tx) => {
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.name, "Platos"));
      const water = await createProduct(tx, {
        categoryId: category!.id,
        name: "Agua",
        customerName: { [venue.cfg.locale]: "Agua del grifo" },
        kitchenName: "AGUA",
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "general",
      });
      freeWaterId = water.id;
      return offerProducts(tx, { zone: "counter", orderStart: "counter" });
    });
  },
});

function productIdOf(name: string): string {
  const [row] = venue.db.all<{ id: string }>(sql`select id from products where name = ${name}`);
  return row!.id;
}

/** A table's bill holding one Small beer, given away. */
async function givenAwayBill(): Promise<{ partyId: string; tabId: string }> {
  const party = await seatedWith(venue, "Small beer");
  await seedGivenAwayLine(venue, party.tabId, 1);
  return party;
}

function closeFreeBill(billId: string, handedOver: string | null) {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: billId,
    kind: "contribution",
    amount: "0.00",
    applied: "0.00",
    tip: "0.00",
    ...(handedOver === null
      ? { method: "card", entry: "manual", externalRef: "OP-1" }
      : { method: "cash", tendered: handedOver }),
  });
}

function salesOf(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ id: sales.id, total: sales.total, settledAt: saleSettlements.settledAt })
      .from(sales)
      .leftJoin(saleSettlements, eq(saleSettlements.saleId, sales.id))
      .where(eq(sales.workingOrderId, billId)),
  );
}

function paymentRowsOf(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ amount: payments.amount, provider: payments.provider })
      .from(payments)
      .where(eq(payments.workingOrderId, billId)),
  );
}

function drawerOpensOf(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ reason: drawerOpens.reason })
      .from(drawerOpens)
      .leftJoin(sales, eq(sales.id, drawerOpens.saleId))
      .leftJoin(billPayments, eq(billPayments.id, drawerOpens.billPaymentId))
      .where(or(eq(sales.workingOrderId, billId), eq(billPayments.workingOrderId, billId))),
  );
}

async function ticketCount(billId: string): Promise<number> {
  const items = await inTx(venue, (tx) =>
    tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(eq(workingOrderLines.workingOrderId, billId)),
  );
  return items.length;
}

function drawerJobCount(): number {
  const [row] = venue.db.all<{ count: number }>(
    sql`select count(*) as count from print_jobs where kind = 'drawer'`,
  );
  return row!.count;
}

/** The bill closed as one owing nothing: one invoice of 0.00, settled, and nothing paid. */
async function expectClosedOwingNothing(billId: string): Promise<void> {
  expect(await statusOf(venue, billId)).toBe("settled");
  expect(fiscalRecordCount(venue, billId)).toBe(1);
  expect(await salesOf(billId)).toEqual([
    { id: expect.any(String), total: 0, settledAt: expect.any(String) },
  ]);
  expect(await tendersOfBill(venue, billId)).toEqual([]);
  expect(await paymentRowsOf(billId)).toEqual([]);
  expect(await drawerOpensOf(billId)).toEqual([]);
}

describe("Pay on a bill whose every line was given away", () => {
  it("opens the drawer for a cash Pay of a bill that owes something, so the cases below can see one", async () => {
    const party = await seatedWith(venue, "Small beer");
    const drawerJobs = drawerJobCount();

    const answer = await cashPayment(venue, venue.cookie, party.tabId, "3.00");

    expect(answer.status).toBe(200);
    expect(await drawerOpensOf(party.tabId)).toEqual([{ reason: "bill_payment" }]);
    expect(drawerJobCount()).toBe(drawerJobs + 1);
  });

  // `0` is what the till's cash screen sends when nothing is typed.
  it.each(["0", "0.00", "5.00"])(
    "closes the bill on a cash Pay of %s, with an invoice of 0.00, no tender and no drawer",
    async (handedOver) => {
      const { tabId } = await givenAwayBill();
      const drawerJobs = drawerJobCount();

      const answer = await closeFreeBill(tabId, handedOver);

      expect(answer.status).toBe(200);
      expect(answer.json).toMatchObject({
        invoice: { total: "0.00", tender: { method: "unpaid" } },
      });
      await expectClosedOwingNothing(tabId);
      expect(drawerJobCount()).toBe(drawerJobs);
    },
  );

  it("closes the bill on a manual card Pay, with no tender and no card payment row", async () => {
    const { tabId } = await givenAwayBill();

    const answer = await closeFreeBill(tabId, null);

    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ invoice: { total: "0.00", tender: { method: "unpaid" } } });
    await expectClosedOwingNothing(tabId);
  });

  it("answers a resent Pay with the first ticket and files nothing more", async () => {
    const { tabId } = await givenAwayBill();

    const first = await closeFreeBill(tabId, "0.00");
    const again = await closeFreeBill(tabId, "0.00");

    expect(first.status).toBe(200);
    expect(again).toEqual(first);
    await expectClosedOwingNothing(tabId);
  });

  it("refuses a malformed cash amount and leaves the bill open", async () => {
    const { tabId } = await givenAwayBill();

    const answer = await closeFreeBill(tabId, "not-money");

    expect(answer).toEqual({
      status: 400,
      json: { code: "management.request_invalid", params: { field: "tendered" } },
    });
    expect(await statusOf(venue, tabId)).toBe("open");
    expect(fiscalRecordCount(venue, tabId)).toBe(0);
  });

  it("lets Finish table close the party once the bill is paid and its food served", async () => {
    const { partyId, tabId } = await givenAwayBill();
    expect((await closeFreeBill(tabId, "0.00")).status).toBe(200);
    const unserved = await send(venue.app, venue.cookie, "POST", `/api/parties/${partyId}/finish`, {
      expectedPartyRevision: await partyRevisionOf(venue, tabId),
    });
    expect([unserved.status, unserved.json.code]).toEqual([409, "party.unserved_dishes"]);
    const dishes = (unserved.json.params as { dishes: { lineId: string; quantity: string }[] })
      .dishes;
    expect(dishes).toHaveLength(1);
    const served = await send(venue.app, venue.cookie, "POST", `/api/parties/${partyId}/served`, {
      submissionId: randomUUID(),
      expectedPartyRevision: await partyRevisionOf(venue, tabId),
      items: dishes.map(({ lineId, quantity }) => ({ lineId, quantity })),
    });
    expect(served.status, JSON.stringify(served.json)).toBe(200);
    const expectedPartyRevision = await partyRevisionOf(venue, tabId);

    const finished = await send(venue.app, venue.cookie, "POST", `/api/parties/${partyId}/finish`, {
      expectedPartyRevision,
    });

    expect(finished).toMatchObject({ status: 200, json: { state: "closed" } });
  });
});

function closeOnReader(billId: string, tip = "0.00") {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: billId,
    kind: "contribution",
    amount: "0.00",
    method: "card",
    entry: "reader",
    applied: "0.00",
    tip,
  });
}

describe("the card reader on a bill whose every line was given away", () => {
  it("refuses a malformed tip and leaves the bill open", async () => {
    const { tabId } = await givenAwayBill();

    const answer = await closeOnReader(tabId, "not-money");

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "tip" },
    });
    expect(await statusOf(venue, tabId)).toBe("open");
    expect(fiscalRecordCount(venue, tabId)).toBe(0);
  });

  it("leaves a party's unsent dish unsent in a zone that sends before payment, where the same dish with no party is sent once", async () => {
    const ticketZone = await inTx(venue, async (tx) => {
      const [zone] = [await seedZone(tx, { name: "Barra ticket" })];
      const offered = await offerProducts(tx, {
        zone: { zoneId: zone!.id },
        orderStart: "counter",
        productIds: [productIdOf("Small beer")],
      });
      await tx.execute(sql`
        update floor_zones set paid_when = 'ticket_then_pay'
        where id = ${offered.zoneId}`);
      return offered;
    });
    const [partyBill, walkUp] = [randomUUID(), randomUUID()];
    for (const id of [partyBill, walkUp]) {
      await parkOrder({ db: venue.db }, venue.cfg, {
        id,
        zoneId: id === partyBill ? venue.zoneId : ticketZone.zoneId,
        lines: [
          {
            menuItemId:
              id === partyBill
                ? venue.offerFor("Small beer")
                : ticketZone.offerFor(productIdOf("Small beer")),
            quantity: "1",
          },
        ],
        operatorId: venue.operatorId,
      });
      await seedGivenAwayLine(venue, id, 1);
    }
    await inTx(venue, async (tx) => {
      const table = await createTable(tx, {
        label: "Mesa ticket",
        zoneId: venue.zoneId,
      });
      await moveBill(
        tx,
        venue.cfg,
        partyBill,
        { tableId: table.id },
        { operatorId: venue.operatorId },
      );
    });
    const [moved] = await inTx(venue, (tx) =>
      tx
        .select({ partyId: workingOrders.partyId })
        .from(workingOrders)
        .where(eq(workingOrders.id, partyBill)),
    );
    expect(moved!.partyId).not.toBeNull();
    expect(await zoneOf(venue, partyBill)).toBe(venue.zoneId);
    expect(await ticketCount(partyBill)).toBe(0);
    expect(await ticketCount(walkUp)).toBe(0);
    const readerCalls = venue.card.collectCalls.length;

    for (const id of [partyBill, walkUp]) {
      const answer = await closeOnReader(id);
      expect(answer).toMatchObject({
        status: 200,
        json: { outcome: "settled", invoice: { total: "0.00" } },
      });
    }

    expect(venue.card.collectCalls.length).toBe(readerCalls);
    await expectClosedOwingNothing(partyBill);
    await expectClosedOwingNothing(walkUp);
    expect(await ticketCount(partyBill)).toBe(0);
    expect(await ticketCount(walkUp)).toBe(1);
  });
});

/** A counter order of one Small beer, given away, then presented without an invoice. */
async function presentedGivenAway(): Promise<string> {
  const id = randomUUID();
  const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: [{ menuItemId: counter.offerFor(productIdOf("Small beer")), quantity: "1" }],
    zoneId: counter.zoneId,
    operatorId: venue.operatorId,
  });
  await seedGivenAwayLine(venue, id, 1);
  await placeOrder({ ...deps, admission: testTradingAdmission() }, venue.cfg, id, venue.operatorId);
  expect(await statusOf(venue, id)).toBe("placed");
  expect(fiscalRecordCount(venue, id)).toBe(0);
  return id;
}

describe("other ways a bill owing nothing is paid", () => {
  it("settles a free bill through the bill payment route without taking a card or opening a drawer", async () => {
    const { tabId } = await givenAwayBill();
    const calls = venue.card.collectCalls.length;
    const drawerJobs = drawerJobCount();
    const take = () => closeOnReader(tabId);

    const closed = await take();

    expect(closed).toMatchObject({
      status: 200,
      json: {
        outcome: "settled",
        balance: { status: "settled", payments: [] },
        invoice: { total: "0.00", tender: { method: "unpaid" } },
      },
    });
    expect(closed.json.payment).toBeUndefined();
    expect(await take()).toEqual(closed);
    await expectClosedOwingNothing(tabId);
    expect(venue.card.collectCalls.length).toBe(calls);
    expect(drawerJobCount()).toBe(drawerJobs);
  });

  it("files and settles a 0.00 invoice as soon as a whole-bill comp leaves nothing due", async () => {
    const { tabId } = await seatedWith(venue, "Small beer");
    const drawerJobs = drawerJobCount();

    await compWholeBill(venue, tabId, 10000);

    await expectClosedOwingNothing(tabId);
    expect(drawerJobCount()).toBe(drawerJobs);

    const replay = await closeFreeBill(tabId, "0");
    expect(replay).toMatchObject({
      status: 200,
      json: { invoice: { total: "0.00", tender: { method: "unpaid" } } },
    });
    await expectClosedOwingNothing(tabId);
  });

  it("refuses a cash Pay of 0 on a bill comped only by half, which still owes, leaving it open with nothing filed", async () => {
    const { tabId } = await seatedWith(venue, "Small beer");
    await compWholeBill(venue, tabId, 5000);

    const answer = await cashPayment(venue, venue.cookie, tabId, "0");

    expect(answer).toEqual({
      status: 400,
      json: { code: "management.request_invalid", params: { field: "tendered" } },
    });
    expect(await statusOf(venue, tabId)).toBe("open");
    expect(fiscalRecordCount(venue, tabId)).toBe(0);
  });

  it("closes a presented order given away before it was presented, on the reader without charging", async () => {
    const id = await presentedGivenAway();
    const readerCalls = venue.card.collectCalls.length;

    const answer = await closeOnReader(id);

    expect(answer).toMatchObject({
      status: 200,
      json: { outcome: "settled", invoice: { total: "0.00", tender: { method: "unpaid" } } },
    });
    expect(venue.card.collectCalls.length).toBe(readerCalls);
    await expectClosedOwingNothing(id);
  });

  it.each(["cash", "card"] as const)(
    "collects a presented counter order given away before it was presented, by %s",
    async (method) => {
      const id = await presentedGivenAway();

      const answer = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${id}/payments`,
        {
          submissionId: randomUUID(),
          kind: "contribution",
          amount: "0.00",
          applied: "0.00",
          tip: "0.00",
          method,
          ...(method === "cash" ? { tendered: "0.00" } : { entry: "manual" }),
        },
      );

      expect(answer.status).toBe(200);
      expect(answer.json).toMatchObject({
        invoice: { total: "0.00", tender: { method: "unpaid" } },
      });
      await expectClosedOwingNothing(id);
    },
  );

  it("settles an edited counter basket already covered by a part payment without taking cash twice", async () => {
    const id = randomUUID();
    const menuItemId = counter.offerFor(productIdOf("Small beer"));
    await parkOrder({ db: venue.db }, venue.cfg, {
      id,
      zoneId: counter.zoneId,
      lines: [{ menuItemId, quantity: "2" }],
      operatorId: venue.operatorId,
    });
    const path = `/api/working-orders/${id}/payments`;
    const taken = await send(venue.app, venue.cookie, "POST", path, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "3.00",
      applied: "3.00",
      tip: "0.00",
      method: "cash",
      tendered: "3.00",
    });
    expect(taken.status, JSON.stringify(taken.json)).toBe(200);
    const held = await send(venue.app, venue.cookie, "GET", `/api/working-orders/${id}`);
    const [portion] = held.json.lines as { workingOrderLineId: string }[];
    const drawerJobs = drawerJobCount();
    const close = {
      submissionId: randomUUID(),
      kind: "share",
      shareOf: 1,
      method: "cash",
      tendered: "5.00",
      dining: "eat_in",
      basket: {
        revision: held.json.revision,
        lines: [{ workingOrderLineId: portion!.workingOrderLineId, menuItemId, quantity: "1" }],
      },
    };
    const answer = await send(venue.app, venue.cookie, "POST", path, close);
    expect(answer).toMatchObject({
      status: 200,
      json: {
        outcome: "settled",
        invoice: { invoiceNumber: expect.any(String), total: "3.00" },
        balance: { payments: [taken.json.payment] },
      },
    });
    expect(await send(venue.app, venue.cookie, "POST", path, close)).toMatchObject({
      status: 409,
      json: { code: "working_order.not_open" },
    });
    const receipt = await send(venue.app, venue.cookie, "GET", `/api/sales/${id}`);
    const { invoiceNumber } = answer.json.invoice as { invoiceNumber: string };
    expect(receipt).toMatchObject({
      status: 200,
      json: { invoiceNumber, total: "3.00" },
    });
    expect(fiscalRecordCount(venue, id)).toBe(1);
    expect(drawerJobCount()).toBe(drawerJobs);
  });

  it("sells a counter order of a free item on the reader without charging", async () => {
    const id = randomUUID();
    const readerCalls = venue.card.collectCalls.length;

    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${id}/payments`,
      {
        dining: "eat_in",
        submissionId: id,
        kind: "share",
        shareOf: 1,
        method: "card",
        entry: "reader",
        basket: {
          zoneId: counter.zoneId,
          lines: [{ menuItemId: counter.offerFor(freeWaterId), quantity: "1" }],
        },
      },
    );

    expect(answer).toMatchObject({
      status: 200,
      json: { outcome: "settled", invoice: { total: "0.00", tender: { method: "unpaid" } } },
    });
    expect(venue.card.collectCalls.length).toBe(readerCalls);
    await expectClosedOwingNothing(id);
  });

  it("sells a counter order of a free item, with an invoice of 0.00 and no drawer", async () => {
    const id = randomUUID();

    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${id}/payments`,
      {
        dining: "eat_in",
        submissionId: id,
        kind: "share",
        shareOf: 1,
        method: "cash",
        tendered: "0.00",
        basket: {
          zoneId: counter.zoneId,
          lines: [{ menuItemId: counter.offerFor(freeWaterId), quantity: "1" }],
        },
      },
    );

    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ invoice: { total: "0.00", tender: { method: "unpaid" } } });
    await expectClosedOwingNothing(id);
    const [line] = venue.db.all<{ total: number }>(
      sql`select line_total as total from working_order_lines where working_order_id = ${id}`,
    );
    expect(line).toEqual({ total: 0 });
  });
});
