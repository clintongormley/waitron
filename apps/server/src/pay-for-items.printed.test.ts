import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { sales, workingOrderLines, workingOrders } from "@waitron/db";
import { createProduct } from "@waitron/menu";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { centsToDecimal, thousandthsToDecimal } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import {
  inTx,
  paymentRows,
  seatedWith,
  send,
  statusOf,
  type Answer,
} from "./testing/bill-venue.js";
import { provisionOrderVenue, type OrderVenue } from "./testing/order-venue.js";
import * as fixture from "./testing/split-after-print-fixture.js";
import { placeGrouped } from "./testing/adjustment-venue.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import "./errors.js";

// Pay for items on a printed bill (A1515-1 PR4-D7): the bill is reopened to split, the chosen
// dishes move to a bill of their own and the payment is taken there, in one step.
let venue: OrderVenue;
let offers: ZoneOffers;
let ids: Record<"soup" | "hake" | "beer", string>;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
    // Print the bill prints on the till's receipt printer, which the venue's till profile allows.
    db.run(sql`update device_profiles set capabilities = json_insert(capabilities, '$[#]', 'print-receipt')
      where name = 'Counter till'`);
    await inTx(venue, async (tx) => {
      const [{ categoryId }] = await tx.all<{ categoryId: string }>(
        sql`select category_id as categoryId from products where name = 'Tarta'`,
      );
      const product = async (name: string, unitPrice: string) =>
        (
          await createProduct(tx, {
            categoryId: categoryId!,
            name,
            customerName: { es: `${name} (customer)` },
            kitchenName: name.toUpperCase(),
            pricingUnit: "each",
            unitPrice,
            vatClass: "general",
          })
        ).id;
      ids = {
        soup: await product("Soup", "6.00"),
        hake: await product("Hake", "15.00"),
        beer: await product("Beer", "2.50"),
      };
      offers = await offerProducts(tx, { zone: "tables" });
    });
  },
});

type Dish = keyof typeof ids;
type Party = { partyId: string; tabId: string };

/** A party at a table with the dishes ordered, `quantity` of each when given. */
async function seated(...dishes: (Dish | [Dish, string])[]): Promise<Party> {
  const party = await seatedWith(venue);
  const ordered = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/parties/${party.partyId}/groups`,
    {
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, party.tabId)),
      submissionId: randomUUID(),
      expectedPartyRevision: fixture.revisionOf(venue, party.partyId),
      groups: [
        {
          lines: dishes.map((dish) => {
            const [name, quantity] = typeof dish === "string" ? [dish, "1"] : dish;
            return { menuItemId: offers.offerFor(ids[name]), quantity };
          }),
          release: "fire",
        },
      ],
    },
  );
  expect(ordered.status, JSON.stringify(ordered.json)).toBe(200);
  return party;
}

/** A party at a table with three beers on one line, as the groups route would give each its own. */
async function threeBeersOnOneLine(): Promise<Party> {
  const party = await seatedWith(venue);
  await inTx(venue, (tx) =>
    placeGrouped(
      tx,
      venue.cfg,
      party,
      [{ menuItemId: offers.offerFor(ids.beer), quantity: "3" }],
      "fire",
      venue.operatorId,
    ),
  );
  return party;
}

/** The party's dishes served and its bill printed. */
async function printed(party: Party): Promise<Party> {
  const served = await fixture.serve(venue, party, party.tabId);
  expect(served.status, JSON.stringify(served.json)).toBe(200);
  const ticket = await fixture.printBill(venue, party, party.tabId);
  expect(ticket.status, JSON.stringify(ticket.json)).toBe(200);
  return party;
}

async function lineOf(billId: string, dish: Dish): Promise<string> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(
        and(
          eq(workingOrderLines.workingOrderId, billId),
          eq(workingOrderLines.productId, ids[dish]),
        ),
      ),
  );
  return row!.id;
}

/** What the till sends to pay for `picks` of the bill as it reads it now. */
async function itemsBody(
  party: Party,
  picks: { lineId: string; quantity?: string }[],
  pay: Record<string, unknown>,
) {
  return {
    submissionId: randomUUID(),
    picks,
    partyId: party.partyId,
    expectedPartyRevision: fixture.revisionOf(venue, party.partyId),
    expectedEdits: [await inTx(venue, (tx) => readBillEditState(tx, party.tabId))],
    tip: "0.00",
    ...pay,
  };
}

const cashFor = (applied: string, tendered = applied) => ({
  method: "cash",
  applied,
  tendered,
});

function payItems(billId: string, body: unknown): Promise<Answer> {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/item-payments`, body);
}

function preview(billId: string, body: unknown): Promise<Answer> {
  return send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/item-payments/preview`,
    body,
  );
}

async function payInCash(billId: string, amount: string, ownReceipt = false): Promise<void> {
  const paid = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
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
  );
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
}

/** The bills reopened from `printedId`. */
async function reopenedFrom(printedId: string): Promise<string[]> {
  const rows = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(eq(workingOrders.reopenedFrom, printedId)),
  );
  return rows.map((row) => row.id);
}

/** The bills items were paid for from, out of `sourceIds`. */
async function itemsBillsOf(sourceIds: string[]): Promise<string[]> {
  if (sourceIds.length === 0) return [];
  const rows = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(inArray(workingOrders.itemsPaidFrom, sourceIds)),
  );
  return rows.map((row) => row.id);
}

async function dishes(billId: string): Promise<[string, string, string][]> {
  return (await fixture.dishesOf(venue, billId))
    .filter((line) => line.parentLineId === null)
    .map((line) => [
      line.name,
      thousandthsToDecimal(line.quantity),
      centsToDecimal(line.lineTotal),
    ]);
}

async function ticketsOf(billId: string): Promise<number[]> {
  const rows = await inTx(venue, (tx) =>
    tx
      .select({ total: sales.total })
      .from(sales)
      .where(eq(sales.workingOrderId, billId))
      .orderBy(asc(sales.total)),
  );
  return rows.map((row) => row.total);
}

function balanceOf(billId: string): Promise<Answer> {
  return send(venue.app, venue.cookie, "GET", `/api/working-orders/${billId}/payments`);
}

describe("Pay for items on a printed bill", () => {
  it("cash pays for chosen items on a printed bill", async () => {
    const party = await printed(await seated("soup", "hake"));
    const original = await fixture.invoiceOf(venue, party.tabId);
    expect(original.total).toBe(2100);

    const paid = await payItems(
      party.tabId,
      await itemsBody(
        party,
        [{ lineId: await lineOf(party.tabId, "hake") }],
        cashFor("15.00", "20.00"),
      ),
    );

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect((await fixture.creditsOf(venue, original.id)).map((credit) => credit.total)).toEqual([
      -2100,
    ]);
    expect(await statusOf(venue, party.tabId)).toBe("abandoned");
    const itemsBill = paid.json.billId as string;
    expect(await statusOf(venue, itemsBill)).toBe("settled");
    expect(await ticketsOf(itemsBill)).toEqual([1500]);
    expect(await dishes(itemsBill)).toEqual([["Hake", "1.000", "15.00"]]);
    const [reopened] = await reopenedFrom(party.tabId);
    expect(await statusOf(venue, reopened!)).toBe("open");
    expect(await dishes(reopened!)).toEqual([["Soup", "1.000", "6.00"]]);
    expect(await itemsBillsOf([reopened!])).toEqual([itemsBill]);
  });

  it("on a part-paid printed bill the paid money stays with the table's bill", async () => {
    const party = await printed(await seated("soup", "hake"));
    const original = await fixture.invoiceOf(venue, party.tabId);
    await payInCash(party.tabId, "10.00");

    const paid = await payItems(
      party.tabId,
      await itemsBody(party, [{ lineId: await lineOf(party.tabId, "hake") }], cashFor("15.00")),
    );

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const [reopened] = await reopenedFrom(party.tabId);
    expect(await dishes(reopened!)).toEqual([["Soup", "1.000", "6.00"]]);
    expect((await balanceOf(reopened!)).json).toMatchObject({
      status: "open",
      total: "6.00",
      received: "10.00",
      overpaid: "4.00",
    });
    expect(await ticketsOf(reopened!)).toEqual([]);

    const kept = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${reopened}/overpaid/keep-as-tip`,
      { submissionId: randomUUID(), overpaid: "4.00" },
    );

    expect(kept.status, JSON.stringify(kept.json)).toBe(200);
    expect(await statusOf(venue, reopened!)).toBe("settled");
    expect(await ticketsOf(reopened!)).toEqual([600]);
    const [credit] = await fixture.creditsOf(venue, original.id);
    const hake = await ticketsOf(paid.json.billId as string);
    expect(hake).toEqual([1500]);
    // Paid 10.00 and 15.00, of which 4.00 kept as a tip: the tickets standing come to 21.00.
    expect(original.total + credit!.total + hake[0]! + 600).toBe(1000 + 1500 - 400);
  });

  it("the same request twice reopens once", async () => {
    const party = await printed(await seated("soup", "hake"));
    const original = await fixture.invoiceOf(venue, party.tabId);
    const body = await itemsBody(
      party,
      [{ lineId: await lineOf(party.tabId, "hake") }],
      cashFor("15.00", "20.00"),
    );

    const first = await payItems(party.tabId, body);
    const again = await payItems(party.tabId, body);

    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(await fixture.creditsOf(venue, original.id)).toHaveLength(1);
    const reopened = await reopenedFrom(party.tabId);
    expect(reopened).toHaveLength(1);
    expect(await itemsBillsOf(reopened)).toEqual([first.json.billId]);
  });

  it("a declined card leaves every dish on the reopened bill", async () => {
    const party = await printed(await seated("soup", "hake"));
    const original = await fixture.invoiceOf(venue, party.tabId);
    await payInCash(party.tabId, "10.00");
    venue.card.failNextCollect();

    const paid = await payItems(
      party.tabId,
      await itemsBody(party, [{ lineId: await lineOf(party.tabId, "hake") }], {
        method: "card",
        entry: "reader",
        applied: "15.00",
      }),
    );

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json.payment).toMatchObject({ outcome: "declined" });
    expect((await fixture.creditsOf(venue, original.id)).map((credit) => credit.total)).toEqual([
      -2100,
    ]);
    const [reopened] = await reopenedFrom(party.tabId);
    expect(await statusOf(venue, reopened!)).toBe("open");
    expect(await dishes(reopened!)).toEqual([
      ["Soup", "1.000", "6.00"],
      ["Hake", "1.000", "15.00"],
    ]);
    expect((await balanceOf(reopened!)).json).toMatchObject({
      total: "21.00",
      received: "10.00",
      outstanding: "11.00",
    });
    const itemsBill = paid.json.billId as string;
    expect(await statusOf(venue, itemsBill)).toBe("abandoned");
    expect(await ticketsOf(itemsBill)).toEqual([]);
    expect(await paymentRows(venue, itemsBill)).toMatchObject([{ state: "failed" }]);
  });

  it("a refusal reopens nothing", async () => {
    const party = await printed(await seated("soup", "hake"));
    const original = await fixture.invoiceOf(venue, party.tabId);
    const body = await itemsBody(
      party,
      [{ lineId: await lineOf(party.tabId, "hake") }],
      cashFor("14.00", "20.00"),
    );

    await fixture.expectRefused(venue, party.tabId, () => payItems(party.tabId, body), {
      status: 409,
      code: "bill.allocation_changed",
    });
    expect(await fixture.creditsOf(venue, original.id)).toEqual([]);
    expect(await reopenedFrom(party.tabId)).toEqual([]);
  });

  it("a stale party revision is refused before the reopen", async () => {
    const party = await printed(await seated("soup", "hake"));
    const body = await itemsBody(
      party,
      [{ lineId: await lineOf(party.tabId, "hake") }],
      cashFor("15.00"),
    );

    await fixture.expectRefused(
      venue,
      party.tabId,
      () =>
        payItems(party.tabId, { ...body, expectedPartyRevision: body.expectedPartyRevision - 1 }),
      { status: 409, code: "party.out_of_date" },
    );
    expect(await reopenedFrom(party.tabId)).toEqual([]);
  });

  it("part of a line on a printed bill", async () => {
    const party = await printed(await threeBeersOnOneLine());

    const paid = await payItems(
      party.tabId,
      await itemsBody(
        party,
        [{ lineId: await lineOf(party.tabId, "beer"), quantity: "1" }],
        cashFor("2.50"),
      ),
    );

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const [reopened] = await reopenedFrom(party.tabId);
    expect(await dishes(reopened!)).toEqual([["Beer", "2.000", "5.00"]]);
    expect(await dishes(paid.json.billId as string)).toEqual([["Beer", "1.000", "2.50"]]);
    expect(await ticketsOf(paid.json.billId as string)).toEqual([250]);
  });
});

describe("previewing Pay for items on a printed bill", () => {
  it("prices the printed bill's own dishes, writing nothing", async () => {
    const party = await printed(await seated("soup", "hake"));
    const before = fixture.written(venue);

    const answer = await preview(party.tabId, {
      picks: [{ lineId: await lineOf(party.tabId, "hake") }],
      method: "cash",
      tendered: "20.00",
    });

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toEqual({ total: "15.00", applied: "15.00", tip: "0.00", change: "5.00" });
    expect(fixture.written(venue)).toEqual(before);
    expect(await statusOf(venue, party.tabId)).toBe("placed");
  });

  it("the preview says the reopen's refusal before any money", async () => {
    const advanced = await seated("soup", "hake");
    await payInCash(advanced.tabId, "10.00", true);
    await printed(advanced);
    const unserved = await seated("soup", "hake");
    const ticket = await fixture.printBill(venue, unserved, unserved.tabId, true);
    expect(ticket.status, JSON.stringify(ticket.json)).toBe(200);

    for (const [party, code] of [
      [advanced, "bill.has_advance"],
      [unserved, "bill.unserved_dishes"],
    ] as const) {
      await fixture.expectRefused(
        venue,
        party.tabId,
        async () =>
          preview(party.tabId, {
            picks: [{ lineId: await lineOf(party.tabId, "hake") }],
            method: "card",
          }),
        { status: 409, code },
      );
    }
  });
});
