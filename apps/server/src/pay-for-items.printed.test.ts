import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
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

// Pay for items on a printed bill (A1515-1 PR4-D7): the bill is reopened, the chosen
// dishes move to a bill of their own and the payment is taken there, in one step.
let venue: OrderVenue;
let offers: ZoneOffers;
let ids: Record<"soup" | "hake" | "beer" | "tasting" | "salad", string>;

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
        tasting: await product("Tasting menu", "120.00"),
        salad: await product("Salad bowl", "20.00"),
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

const printed = (party: Party) => fixture.printed(venue, party);

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

const payInCash = (billId: string, amount: string, ownReceipt = false) =>
  fixture.payInCash(venue, billId, amount, ownReceipt);

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

const balanceOf = (billId: string) => fixture.balanceOf(venue, billId);

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

  it("a replay on a printed bill carries the reopened bill", async () => {
    const party = await printed(await seated("soup", "hake"));
    const body = await itemsBody(
      party,
      [{ lineId: await lineOf(party.tabId, "hake") }],
      cashFor("15.00", "20.00"),
    );

    const first = await payItems(party.tabId, body);
    const again = await payItems(party.tabId, body);

    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    const [reopened] = await reopenedFrom(party.tabId);
    const left = { workingOrderId: reopened, status: "open", total: "6.00", outstanding: "6.00" };
    expect(first.json.sourceBalance).toMatchObject(left);
    expect(again.json.sourceBalance).toMatchObject(left);
  });

  it("a replay after the table's bill was reopened again answers the bill the table owes on now", async () => {
    const party = await printed(await seated("soup", "hake", "beer"));
    const firstBody = await itemsBody(
      party,
      [{ lineId: await lineOf(party.tabId, "hake") }],
      cashFor("15.00"),
    );
    const first = await payItems(party.tabId, firstBody);
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const [firstReopen] = await reopenedFrom(party.tabId);
    const next = { partyId: party.partyId, tabId: firstReopen! };
    const reprinted = await fixture.printBill(venue, next, next.tabId);
    expect(reprinted.status, JSON.stringify(reprinted.json)).toBe(200);
    const second = await payItems(
      next.tabId,
      await itemsBody(next, [{ lineId: await lineOf(next.tabId, "beer") }], cashFor("2.50")),
    );
    expect(second.status, JSON.stringify(second.json)).toBe(200);
    const [current] = await reopenedFrom(firstReopen!);

    const replay = await payItems(party.tabId, firstBody);

    expect(replay.status, JSON.stringify(replay.json)).toBe(200);
    expect(replay.json.billId).toBe(first.json.billId);
    expect(replay.json.payment).toEqual(first.json.payment);
    expect(replay.json.sourceBalance).toMatchObject({
      workingOrderId: current,
      status: "open",
      outstanding: "6.00",
    });
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
    // The till reads the answer's status to say where the dishes are (apps/till's keptOnOwnBill).
    expect(paid.json.payment).toMatchObject({
      balance: { workingOrderId: itemsBill, status: "abandoned" },
    });
    expect(await statusOf(venue, itemsBill)).toBe("abandoned");
    expect(await ticketsOf(itemsBill)).toEqual([]);
    expect(await paymentRows(venue, itemsBill)).toMatchObject([{ state: "failed" }]);
  });

  it("a declined card leaves the dishes on their own bill when the reopened bill was printed again meanwhile", async () => {
    const party = await printed(await seated("soup", "hake"));
    let offered!: () => void;
    let release!: () => void;
    const atReader = new Promise<void>((resolve) => (offered = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    const collect = venue.card.collect.bind(venue.card);
    vi.spyOn(venue.card, "collect").mockImplementationOnce(async (params) => {
      offered();
      await released;
      venue.card.failNextCollect();
      return collect(params);
    });
    const body = await itemsBody(party, [{ lineId: await lineOf(party.tabId, "hake") }], {
      method: "card",
      entry: "reader",
      applied: "15.00",
    });

    const paying = payItems(party.tabId, body);
    await atReader;
    const [reopened] = await reopenedFrom(party.tabId);
    const reprinted = await fixture.printBill(venue, party, reopened!).finally(release);
    const paid = await paying;

    expect(reprinted.status, JSON.stringify(reprinted.json)).toBe(200);
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const itemsBill = paid.json.billId as string;
    expect(paid.json.payment).toMatchObject({
      outcome: "declined",
      balance: { workingOrderId: itemsBill, status: "open", outstanding: "15.00" },
    });
    expect(await statusOf(venue, itemsBill)).toBe("open");
    expect(await dishes(itemsBill)).toEqual([["Hake", "1.000", "15.00"]]);
    expect(await dishes(reopened!)).toEqual([["Soup", "1.000", "6.00"]]);
  });

  it("Cancel payment at the reader leaves every dish on the reopened bill, as a declined card does", async () => {
    const party = await printed(await seated("soup", "hake"));
    const original = await fixture.invoiceOf(venue, party.tabId);
    let offered!: () => void;
    let stopped!: () => void;
    const atReader = new Promise<void>((resolve) => (offered = resolve));
    const cancelled = new Promise<void>((resolve) => (stopped = resolve));
    const stop = vi.fn(async () => {
      stopped();
      return "requested" as const;
    });
    const collect = venue.card.collect.bind(venue.card);
    vi.spyOn(venue.card, "collect").mockImplementationOnce(async (params) => {
      params.onReaderCheckout?.(stop);
      offered();
      await cancelled;
      // The reader charges nothing once its checkout is stopped.
      venue.card.failNextCollect();
      return collect(params);
    });
    const body = await itemsBody(party, [{ lineId: await lineOf(party.tabId, "hake") }], {
      method: "card",
      entry: "reader",
      applied: "15.00",
    });

    const paying = payItems(party.tabId, body);
    await atReader;
    const cancel = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/payments/${body.submissionId}/cancel`,
    );
    const paid = await paying;

    expect(cancel.json).toEqual({ outcome: "requested" });
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
    expect(paid.json.sourceBalance).toMatchObject({
      workingOrderId: reopened,
      outstanding: "21.00",
    });
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

  it("a stale edit state on the printed bill is refused before the reopen", async () => {
    const party = await printed(await seated("soup", "hake"));
    const body = await itemsBody(
      party,
      [{ lineId: await lineOf(party.tabId, "hake") }],
      cashFor("15.00"),
    );
    const [edit] = body.expectedEdits;

    await fixture.expectRefused(
      venue,
      party.tabId,
      () =>
        payItems(party.tabId, {
          ...body,
          expectedEdits: [{ ...edit!, editorVersion: edit!.editorVersion + 1 }],
        }),
      { status: 409, code: "draft.out_of_date" },
    );
    expect(await reopenedFrom(party.tabId)).toEqual([]);
  });

  it("a pick naming a line not on the printed bill reopens nothing", async () => {
    const party = await printed(await seated("soup", "hake"));
    const other = await printed(await seated("hake"));
    const original = await fixture.invoiceOf(venue, party.tabId);
    const body = await itemsBody(
      party,
      [{ lineId: await lineOf(other.tabId, "hake") }],
      cashFor("15.00"),
    );

    await fixture.expectRefused(venue, party.tabId, () => payItems(party.tabId, body), {
      status: 400,
      code: "tab.line_not_found",
    });
    expect(await fixture.creditsOf(venue, original.id)).toEqual([]);
    expect(await reopenedFrom(party.tabId)).toEqual([]);
    expect(await statusOf(venue, other.tabId)).toBe("placed");
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

describe("Pay for items on a printed bill with an advance", () => {
  /** A 140.00 table, 30.00 of it paid as an advance on the payer's own receipt, its bill printed
   * with a 110.00 receipt; the party, the advance's payment and that receipt. */
  async function advancedAndPrinted() {
    const party = await seated("tasting", "salad");
    const advancePayment = await payInCash(party.tabId, "30.00", true);
    await printed(party);
    const receipt = await fixture.invoiceOf(venue, party.tabId);
    expect(receipt.total).toBe(11000);
    return { party, advancePayment, receipt };
  }

  it("pays for a dish: the reopened bill keeps the advance, 30.00 received of 120.00", async () => {
    const { party, advancePayment, receipt } = await advancedAndPrinted();

    const paid = await payItems(
      party.tabId,
      await itemsBody(party, [{ lineId: await lineOf(party.tabId, "salad") }], cashFor("20.00")),
    );

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect((await fixture.creditsOf(venue, receipt.id)).map((credit) => credit.total)).toEqual([
      -11000,
    ]);
    expect(await statusOf(venue, party.tabId)).toBe("abandoned");
    const itemsBill = paid.json.billId as string;
    expect(await statusOf(venue, itemsBill)).toBe("settled");
    expect(await ticketsOf(itemsBill)).toEqual([2000]);
    const [reopened] = await reopenedFrom(party.tabId);
    expect(await dishes(reopened!)).toEqual([["Tasting menu", "1.000", "120.00"]]);
    expect((await paymentRows(venue, reopened!)).map((row) => row.id)).toEqual([advancePayment]);
    expect((await balanceOf(reopened!)).json).toMatchObject({
      status: "open",
      total: "120.00",
      received: "30.00",
      outstanding: "90.00",
    });
    expect(paid.json.sourceBalance).toMatchObject({
      workingOrderId: reopened,
      outstanding: "90.00",
    });
  });

  it("paying for dishes that would leave less than the advance is bill.below_advances, the bill still printed and nothing credited", async () => {
    const { party, receipt } = await advancedAndPrinted();
    const picks = [{ lineId: await lineOf(party.tabId, "tasting") }];

    await fixture.expectRefused(
      venue,
      party.tabId,
      async () => payItems(party.tabId, await itemsBody(party, picks, cashFor("120.00"))),
      { status: 409, code: "bill.below_advances" },
    );
    expect(await fixture.creditsOf(venue, receipt.id)).toEqual([]);
    expect(await reopenedFrom(party.tabId)).toEqual([]);
    await fixture.expectRefused(
      venue,
      party.tabId,
      () => preview(party.tabId, { picks, method: "card" }),
      { status: 409, code: "bill.below_advances" },
    );
  });

  it("a part payment and then an advance, the bill printed: the reopened bill is overpaid, 130.00 of 120.00, and Keep as tip takes none from the advance, the newest payment", async () => {
    const party = await seated("tasting", "salad");
    const partPayment = await payInCash(party.tabId, "100.00");
    const advancePayment = await payInCash(party.tabId, "30.00", true);
    await printed(party);
    expect((await fixture.invoiceOf(venue, party.tabId)).total).toBe(11000);
    // Keep as tip takes from the newest received payment first: the advance's has to be it.
    const [part, advanced] = await paymentRows(venue, party.tabId);
    expect([part!.id, advanced!.id]).toEqual([partPayment, advancePayment]);
    expect(advanced!.receivedAt! > part!.receivedAt!).toBe(true);

    const paid = await payItems(
      party.tabId,
      await itemsBody(party, [{ lineId: await lineOf(party.tabId, "salad") }], cashFor("20.00")),
    );

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const [reopened] = await reopenedFrom(party.tabId);
    expect((await balanceOf(reopened!)).json).toMatchObject({
      status: "open",
      total: "120.00",
      received: "130.00",
      overpaid: "10.00",
    });

    const kept = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${reopened}/overpaid/keep-as-tip`,
      { submissionId: randomUUID(), overpaid: "10.00" },
    );

    expect(kept.status, JSON.stringify(kept.json)).toBe(200);
    expect(await statusOf(venue, reopened!)).toBe("settled");
    const money = (await paymentRows(venue, reopened!)).map((row) => [
      row.id,
      centsToDecimal(row.applied),
      centsToDecimal(row.tip),
    ]);
    expect(money).toEqual([
      [partPayment, "90.00", "10.00"],
      [advancePayment, "30.00", "0.00"],
    ]);
    expect(await ticketsOf(reopened!)).toEqual([9000]);
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

  it("the preview says Reopen bill's refusal before any money", async () => {
    const unserved = await seated("soup", "hake");
    const ticket = await fixture.printBill(venue, unserved, unserved.tabId, true);
    expect(ticket.status, JSON.stringify(ticket.json)).toBe(200);

    await fixture.expectRefused(
      venue,
      unserved.tabId,
      async () =>
        preview(unserved.tabId, {
          picks: [{ lineId: await lineOf(unserved.tabId, "hake") }],
          method: "card",
        }),
      { status: 409, code: "bill.unserved_dishes" },
    );
  });
});

describe("the dishes Pay > Items lists on a printed bill", () => {
  it("the till's lines read answers a printed table bill's dishes, and an edit stays refused", async () => {
    const party = await printed(await seated("soup", "hake"));

    const read = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/working-orders/${party.tabId}/lines`,
    );

    expect(read.status, JSON.stringify(read.json)).toBe(200);
    expect(
      (read.json.lines as { id: string; name: string }[]).map(({ id, name }) => [name, id]),
    ).toEqual([
      ["Soup", await lineOf(party.tabId, "soup")],
      ["Hake", await lineOf(party.tabId, "hake")],
    ]);
    const edit = await send(
      venue.app,
      venue.cookie,
      "PATCH",
      `/api/working-orders/${party.tabId}/lines/1/course`,
      {
        courseId: null,
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, party.tabId)),
      },
    );
    expect({ status: edit.status, code: edit.json.code }).toEqual({
      status: 409,
      code: "tab.not_open",
    });
    expect(await statusOf(venue, party.tabId)).toBe("placed");
  });
});
