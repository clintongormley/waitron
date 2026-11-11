import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { writeGroupedLines } from "./testing/grouped-counter-order.js";
import { createTable } from "./testing/live-table.js";
import { describe, expect, it } from "vitest";
import {
  kitchenNotices,
  parties,
  products,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setRoutingCell } from "@waitron/venue-service";
import { readBillEditState } from "./bill-editing.js";
import { markServed } from "./working-order.js";
import { fireAll, openPartyTab, serveLine } from "./testing/serve-line.js";
import { inTx, provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";

let venue: BillVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    // Handed over at the bar: sent, with no kitchen ticket.
    await inTx(venue, async (tx) => {
      const [wine] = await tx.select().from(products).where(eq(products.name, "Red wine bottle"));
      await setRoutingCell(
        tx,
        { row: { kind: "product", productId: wine!.id }, zoneId: null },
        { kind: "no_preparation" },
      );
    });
  },
});

const kitchenItems = (billId: string) =>
  venue.db
    .select({ id: ticketItems.id, note: ticketItems.note })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(eq(workingOrderLines.workingOrderId, billId));

describe("changing a sent dish that has been served", () => {
  it("is refused, as Recall refuses it, and the kitchen is asked for nothing", async () => {
    const billId = await tabWith(venue, "Steak");
    await inTx(venue, (tx) => fireAll(tx, venue.cfg, billId));
    // What a till that read the bill before the dish was served holds.
    const [seen] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
    const before = await kitchenItems(billId);
    await inTx(venue, (tx) => serveLine(tx, venue.cfg, billId, 1));

    // Control: Recall refuses the served dish.
    const [line] = await venue.db
      .select()
      .from(workingOrderLines)
      .where(and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.lineNo, 1)));
    const [party] = await venue.db.select().from(parties).where(eq(parties.id, seen!.partyId!));
    const recall = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${seen!.partyId}/lines/${line!.id}/recall`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party!.revision,
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
      },
    );
    expect(recall.status).toBe(400);

    const change = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/working-orders/${billId}/lines/1`,
      {
        revision: seen!.revision,
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
        note: "no onions",
        portionLineNos: [],
      },
    );

    expect(change).toMatchObject({
      status: 409,
      json: { code: "ticket.already_served", params: { workingOrderId: billId, lineId: line!.id } },
    });
    expect(await kitchenItems(billId)).toEqual(before);
    expect(await noticesOf(billId)).toEqual([]);
  });
});

/** A fresh party's bill carrying `quantity` of the named dish on one stored line, fired. */
async function firedTabOf(name: string, quantity: string): Promise<string> {
  return inTx(venue, async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `S-${randomUUID().slice(0, 8)}`,
      zoneId: venue.zoneId,
    });
    const { tabId } = await openPartyTab(tx, venue.cfg, { tableId: table.id });
    await writeGroupedLines(tx, venue.cfg, tabId, [{ menuItemId: venue.offerFor(name), quantity }]);
    await fireAll(tx, venue.cfg, tabId);
    return tabId;
  });
}

const noticesOf = (billId: string) =>
  venue.db
    .select({ kind: kitchenNotices.kind })
    .from(kitchenNotices)
    .where(eq(kitchenNotices.workingOrderId, billId));

/** The bill's whole-basket save, as the counter sends it. */
async function saveBasket(
  billId: string,
  lines: { workingOrderLineId?: string; menuItemId: string; quantity: string }[],
) {
  const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
  return send(venue.app, venue.cookie, "PUT", `/api/working-orders/${billId}`, {
    lines,
    revision: order!.revision,
    expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
  });
}

const lineOf = async (billId: string, lineNo: number) =>
  (
    await venue.db
      .select()
      .from(workingOrderLines)
      .where(
        and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.lineNo, lineNo)),
      )
  )[0]!;

describe("the whole-basket save of a bill with a sent dish", () => {
  it("refuses to leave out a dish the kitchen has, voiding nothing", async () => {
    const billId = await firedTabOf("Steak", "1");
    const before = await kitchenItems(billId);

    const answer = await saveBasket(billId, [
      { menuItemId: venue.offerFor("Steak"), quantity: "1" },
    ]);

    expect(answer).toMatchObject({
      status: 409,
      json: { code: "ticket.already_fired", params: { workingOrderId: billId } },
    });
    expect(await kitchenItems(billId)).toEqual(before);
    expect(await noticesOf(billId)).toEqual([]);
  });

  it("refuses to leave out a served dish as served", async () => {
    const billId = await firedTabOf("Steak", "1");
    await inTx(venue, (tx) => serveLine(tx, venue.cfg, billId, 1));
    const line = await lineOf(billId, 1);
    const before = await kitchenItems(billId);

    const answer = await saveBasket(billId, [
      { menuItemId: venue.offerFor("Steak"), quantity: "1" },
    ]);

    expect(answer).toMatchObject({
      status: 409,
      json: { code: "ticket.already_served", params: { workingOrderId: billId, lineId: line.id } },
    });
    expect(await kitchenItems(billId)).toEqual(before);
    expect(await noticesOf(billId)).toEqual([]);
  });

  it("refuses to lower the count of a dish the kitchen has, voiding nothing", async () => {
    const billId = await firedTabOf("Steak", "2");
    const line = await lineOf(billId, 1);
    const before = await kitchenItems(billId);

    const answer = await saveBasket(billId, [
      { workingOrderLineId: line.id, menuItemId: venue.offerFor("Steak"), quantity: "1" },
    ]);

    expect(answer).toMatchObject({
      status: 409,
      json: { code: "ticket.already_fired", params: { workingOrderId: billId } },
    });
    expect(await kitchenItems(billId)).toEqual(before);
    expect(await noticesOf(billId)).toEqual([]);
    expect(line.quantity).toBe(2000);
    expect((await lineOf(billId, 1)).quantity).toBe(2000);
  });

  it("refuses to lower the count of a partly served dish as served", async () => {
    const billId = await firedTabOf("Steak", "2");
    const line = await lineOf(billId, 1);
    await inTx(venue, async (tx) => {
      const [party] = await tx
        .select()
        .from(parties)
        .innerJoin(workingOrders, eq(workingOrders.partyId, parties.id))
        .where(eq(workingOrders.id, billId));
      await markServed(tx, venue.cfg, party!.parties.id, [{ lineId: line.id, quantity: "1" }], {
        submissionId: randomUUID(),
        expectedPartyRevision: party!.parties.revision,
        operatorId: venue.operatorId,
      });
    });
    const before = await kitchenItems(billId);

    const answer = await saveBasket(billId, [
      { workingOrderLineId: line.id, menuItemId: venue.offerFor("Steak"), quantity: "1" },
    ]);

    expect(answer).toMatchObject({
      status: 409,
      json: { code: "ticket.already_served", params: { workingOrderId: billId, lineId: line.id } },
    });
    expect(await kitchenItems(billId)).toEqual(before);
    expect(await noticesOf(billId)).toEqual([]);
    expect(await lineOf(billId, 1)).toMatchObject({ quantity: 2000, servedQuantity: 1000 });
  });

  it("refuses to leave out a sent dish that needs no preparation", async () => {
    const billId = await firedTabOf("Red wine bottle", "1");
    const line = await lineOf(billId, 1);
    expect(line.sentAt).not.toBeNull();
    expect(await kitchenItems(billId)).toEqual([]);

    const answer = await saveBasket(billId, [
      { menuItemId: venue.offerFor("Steak"), quantity: "1" },
    ]);

    expect(answer).toMatchObject({
      status: 409,
      json: { code: "ticket.already_sent", params: { workingOrderId: billId, lineId: line.id } },
    });
    expect(await lineOf(billId, 1)).toEqual(line);
    expect(await lineOf(billId, 2)).toBeUndefined();
  });

  it("refuses to lower the count of a sent dish that needs no preparation", async () => {
    const billId = await firedTabOf("Red wine bottle", "2");
    const line = await lineOf(billId, 1);

    const answer = await saveBasket(billId, [
      { workingOrderLineId: line.id, menuItemId: venue.offerFor("Red wine bottle"), quantity: "1" },
    ]);

    expect(answer).toMatchObject({
      status: 409,
      json: { code: "ticket.already_sent", params: { workingOrderId: billId, lineId: line.id } },
    });
    expect(await lineOf(billId, 1)).toEqual(line);
  });

  it("still raises a sent dish that needs no preparation", async () => {
    const billId = await firedTabOf("Red wine bottle", "1");
    const line = await lineOf(billId, 1);

    const answer = await saveBasket(billId, [
      { workingOrderLineId: line.id, menuItemId: venue.offerFor("Red wine bottle"), quantity: "2" },
    ]);

    expect(answer.status).toBe(200);
  });

  it("still saves a basket that keeps the sent dish and adds another", async () => {
    const billId = await firedTabOf("Steak", "1");
    const line = await lineOf(billId, 1);

    const answer = await saveBasket(billId, [
      { workingOrderLineId: line.id, menuItemId: venue.offerFor("Steak"), quantity: "1" },
      { menuItemId: venue.offerFor("Steak"), quantity: "1" },
    ]);

    expect(answer.status).toBe(200);
    expect(await noticesOf(billId)).toEqual([]);
  });
});
