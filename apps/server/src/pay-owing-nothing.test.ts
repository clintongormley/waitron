import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  catalogues,
  categories,
  drawerOpens,
  saleSettlements,
  sales,
  tenders,
  workingOrders,
} from "@waitron/db";
import { createAdjustmentReason } from "@waitron/adjustments";
import { createProduct } from "@waitron/catalogue";
import { payments } from "@waitron/payments";
import { parkOrder, placeOrder } from "./working-order.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import {
  inTx,
  provisionBillVenue,
  registroCount,
  seatedWith,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import { cancelBody } from "./testing/cancel-line.js";
import "./errors.js";

// Paying a bill that owes nothing because every line on it was given away (backlog B28). No money
// changes hands, so the sale is filed at 0.00 and settled with no tender, no card payment row and no
// cash drawer opening, as collecting a bill whose credit notes cancel its invoice already does
// (C59, `apps/server/src/collect-by-invoice.test.ts`). Driven over HTTP against a venue that files
// real Veri*Factu records; every case makes its own bill.
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
      const [catalogue] = await tx
        .select({ id: catalogues.id })
        .from(catalogues)
        .where(eq(catalogues.name, "Carta"));
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.name, "Platos"));
      const water = await createProduct(tx, {
        catalogueId: catalogue!.id,
        categoryId: category!.id,
        name: "Agua",
        customerName: { [venue.cfg.locale]: "Agua del grifo" },
        kitchenName: "AGUA",
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "general",
      });
      freeWaterId = water.id;
      return offerProducts(tx, venue.cfg, { zone: "counter", serviceMode: "prepay" });
    });
  },
});

/** Gives away line `lineNo` of the bill in full, under a reason anyone may apply unapproved. */
async function giveAway(billId: string, lineNo: number): Promise<void> {
  const reasonId = await inTx(venue, async (tx) => {
    const [found] = venue.db.all<{ id: string }>(
      sql`select id from adjustment_reasons where name = 'Given away in a test'`,
    );
    return (
      found?.id ??
      (
        await createAdjustmentReason(tx, {
          name: "Given away in a test",
          names: {},
          actions: ["comp"],
          maxPercentBp: null,
          maxAmount: null,
          applyRole: "staff",
          approverRole: "staff",
          noteRequired: false,
        })
      ).id
    );
  });
  const body = await cancelBody(venue.db, billId, lineNo);
  const given = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/adjustments`,
    { ...body, reasonId, action: "comp" },
  );
  expect(given.status).toBe(200);
}

function productIdOf(name: string): string {
  const [row] = venue.db.all<{ id: string }>(sql`select id from products where name = ${name}`);
  return row!.id;
}

/** A table's bill holding one Caña, given away. */
async function givenAwayBill(): Promise<{ partyId: string; tabId: string }> {
  const party = await seatedWith(venue, "Caña");
  await giveAway(party.tabId, 1);
  return party;
}

function pay(billId: string, tender: Record<string, unknown>) {
  return send(venue.app, venue.cookie, "POST", "/api/sales", {
    lines: [],
    tender,
    workingOrderId: billId,
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

function tenderRowsOf(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ method: tenders.method, amount: tenders.amount })
      .from(tenders)
      .innerJoin(sales, eq(sales.id, tenders.saleId))
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
      .innerJoin(sales, eq(sales.id, drawerOpens.saleId))
      .where(eq(sales.workingOrderId, billId)),
  );
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
  expect(registroCount(venue, billId)).toBe(1);
  expect(await salesOf(billId)).toEqual([
    { id: expect.any(String), total: 0, settledAt: expect.any(String) },
  ]);
  expect(await tenderRowsOf(billId)).toEqual([]);
  expect(await paymentRowsOf(billId)).toEqual([]);
  expect(await drawerOpensOf(billId)).toEqual([]);
}

describe("Pay on a bill whose every line was given away", () => {
  it("opens the drawer for a cash Pay of a bill that owes something, so the cases below can see one", async () => {
    const party = await seatedWith(venue, "Caña");
    const drawerJobs = drawerJobCount();

    const answer = await pay(party.tabId, { method: "cash", amount: "3.00" });

    expect(answer.status).toBe(200);
    expect(await drawerOpensOf(party.tabId)).toEqual([{ reason: "cash_sale" }]);
    expect(drawerJobCount()).toBe(drawerJobs + 1);
  });

  // `0` is what the till's cash screen sends when nothing is typed.
  it.each(["0", "0.00", "5.00"])(
    "closes the bill on a cash Pay of %s, with an invoice of 0.00, no tender and no drawer",
    async (handedOver) => {
      const { tabId } = await givenAwayBill();
      const drawerJobs = drawerJobCount();

      const answer = await pay(tabId, { method: "cash", amount: handedOver });

      expect(answer.status).toBe(200);
      expect(answer.json).toMatchObject({ total: "0.00", tender: { method: "unpaid" } });
      await expectClosedOwingNothing(tabId);
      expect(drawerJobCount()).toBe(drawerJobs);
    },
  );

  it("closes the bill on a manual card Pay, with no tender and no card payment row", async () => {
    const { tabId } = await givenAwayBill();

    const answer = await pay(tabId, { method: "card", amount: "0.00", externalRef: "OP-1" });

    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ total: "0.00", tender: { method: "unpaid" } });
    await expectClosedOwingNothing(tabId);
  });

  it("answers a resent Pay with the first ticket and files nothing more", async () => {
    const { tabId } = await givenAwayBill();

    const first = await pay(tabId, { method: "cash", amount: "0.00" });
    const again = await pay(tabId, { method: "cash", amount: "0.00" });

    expect(first.status).toBe(200);
    expect(again).toEqual(first);
    await expectClosedOwingNothing(tabId);
  });

  it("refuses a malformed cash amount and leaves the bill open", async () => {
    const { tabId } = await givenAwayBill();

    const answer = await pay(tabId, { method: "cash", amount: "not-money" });

    expect(answer.json).toMatchObject({ code: "shared.invalid_decimal" });
    expect(await statusOf(venue, tabId)).toBe("open");
    expect(registroCount(venue, tabId)).toBe(0);
  });

  it("lets Finish table close the party once the bill is paid", async () => {
    const { partyId, tabId } = await givenAwayBill();
    expect((await pay(tabId, { method: "cash", amount: "0.00" })).status).toBe(200);
    const [party] = venue.db.all<{ revision: number }>(
      sql`select revision from parties where id = ${partyId}`,
    );

    const finished = await send(venue.app, venue.cookie, "POST", `/api/parties/${partyId}/finish`, {
      expectedPartyRevision: party!.revision,
    });

    expect(finished).toMatchObject({ status: 200, json: { state: "closed" } });
  });
});

describe("the card reader on a bill whose every line was given away", () => {
  it("closes the bill without asking the reader to charge anything", async () => {
    const { tabId } = await givenAwayBill();
    const readerCalls = venue.card.collectCalls.length;

    const answer = await send(venue.app, venue.cookie, "POST", "/api/pay", {
      id: tabId,
      lines: [],
    });

    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({
      outcome: "captured",
      ticket: { total: "0.00", tender: { method: "unpaid" } },
    });
    expect(venue.card.collectCalls.length).toBe(readerCalls);
    await expectClosedOwingNothing(tabId);
    const [order] = await inTx(venue, (tx) =>
      tx
        .select({ attemptAt: workingOrders.paymentAttemptAt })
        .from(workingOrders)
        .where(eq(workingOrders.id, tabId)),
    );
    expect(order!.attemptAt).toBeNull();
  });

  it("refuses a malformed tip and leaves the bill open", async () => {
    const { tabId } = await givenAwayBill();

    const answer = await send(venue.app, venue.cookie, "POST", "/api/pay", {
      id: tabId,
      lines: [],
      tip: "not-money",
    });

    expect(answer.json).toMatchObject({ code: "shared.invalid_decimal" });
    expect(await statusOf(venue, tabId)).toBe("open");
    expect(registroCount(venue, tabId)).toBe(0);
  });

  it("answers a resent reader Pay with the first ticket and files nothing more", async () => {
    const { tabId } = await givenAwayBill();
    const body = { id: tabId, lines: [] };

    const first = await send(venue.app, venue.cookie, "POST", "/api/pay", body);
    const again = await send(venue.app, venue.cookie, "POST", "/api/pay", body);

    expect(first.status).toBe(200);
    expect(again).toEqual(first);
    await expectClosedOwingNothing(tabId);
  });
});

/** A counter order of one Caña, given away, then presented without an invoice. */
async function presentedGivenAway(): Promise<string> {
  const id = randomUUID();
  const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: [{ menuItemId: counter.offerFor(productIdOf("Caña")), quantity: "1" }],
    zoneId: counter.zoneId,
    operatorId: venue.operatorId,
  });
  await giveAway(id, 1);
  await placeOrder(deps, venue.cfg, id, venue.operatorId, venue.cfg.tillId);
  expect(await statusOf(venue, id)).toBe("placed");
  expect(registroCount(venue, id)).toBe(0);
  return id;
}

describe("other ways a bill owing nothing is paid", () => {
  it("closes a presented order given away before it was presented, on the reader without charging", async () => {
    const id = await presentedGivenAway();
    const readerCalls = venue.card.collectCalls.length;

    const answer = await send(venue.app, venue.cookie, "POST", "/api/pay", { id, lines: [] });

    expect(answer).toMatchObject({
      status: 200,
      json: { outcome: "captured", ticket: { total: "0.00", tender: { method: "unpaid" } } },
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
        `/api/working-orders/${id}/collect`,
        {
          tender: { method, amount: "0.00" },
        },
      );

      expect(answer.status).toBe(200);
      expect(answer.json).toMatchObject({ total: "0.00", tender: { method: "unpaid" } });
      await expectClosedOwingNothing(id);
    },
  );

  it("sells a counter order of a free item, with an invoice of 0.00 and no drawer", async () => {
    const id = randomUUID();

    const answer = await send(venue.app, venue.cookie, "POST", "/api/sales", {
      lines: [{ menuItemId: counter.offerFor(freeWaterId), quantity: "1" }],
      tender: { method: "cash", amount: "0.00" },
      workingOrderId: id,
      zoneId: counter.zoneId,
    });

    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ total: "0.00", tender: { method: "unpaid" } });
    await expectClosedOwingNothing(id);
    const [line] = venue.db.all<{ total: number }>(
      sql`select line_total as total from working_order_lines where working_order_id = ${id}`,
    );
    expect(line).toEqual({ total: 0 });
  });
});
