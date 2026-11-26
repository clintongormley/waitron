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
import { updateMenuItem } from "@waitron/menu";
import { setRoutingCell } from "@waitron/venue-service";
import { readBillEditState } from "./bill-editing.js";
import { markServed } from "./working-order-serving.js";
import { advanceTicketItem } from "./working-order-kitchen-service.js";
import {
  readChangesAfterSending,
  setChangesAfterSending,
} from "./testing/changes-after-sending.js";
import { fireAll, openPartyTab, serveLine } from "./testing/serve-line.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
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
  it("is refused after Recall is retired, and the kitchen is asked for nothing", async () => {
    const billId = await tabWith(venue, "Steak");
    await inTx(venue, (tx) => fireAll(tx, venue.cfg, billId));
    // What a till that read the bill before the dish was served holds.
    const [seen] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
    const before = await kitchenItems(billId);
    await inTx(venue, (tx) => serveLine(tx, venue.cfg, billId, 1));

    // Recall is absent even for a served dish.
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
    expect(recall.status).toBe(404);

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

async function firedTabOf(
  name: string,
  quantity: string,
  ...otherItems: string[]
): Promise<string> {
  return inTx(venue, async (tx) => {
    const table = await createTable(tx, {
      label: `S-${randomUUID().slice(0, 8)}`,
      zoneId: venue.zoneId,
    });
    const { tabId } = await openPartyTab(tx, venue.cfg, { tableId: table.id });
    await writeGroupedLines(tx, venue.cfg, tabId, [
      { menuItemId: venue.offerFor(name), quantity },
      ...otherItems.map((item) => ({ menuItemId: venue.offerFor(item), quantity: "1" })),
    ]);
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
  lines: {
    workingOrderLineId?: string;
    menuItemId: string;
    menuVersionId?: string;
    quantity: string;
    note?: string;
  }[],
) {
  const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
  return send(venue.app, venue.cookie, "PUT", `/api/working-orders/${billId}`, {
    dining: "eat_in",
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
  it.each([
    "waiting first",
    "started first",
    "waiting then served then started",
    "waiting omitted",
    "waiting and started omitted",
    "waiting omitted after a menu publish",
  ] as const)("reports the started dish in a mixed save with %s", async (scenario) => {
    const names = ["Steak", "Red wine bottle", "House salad", "Small beer"] as const;
    const [steak, ...otherItems] = names;
    const billId = await firedTabOf(steak, "1", ...otherItems);
    if (scenario === "waiting then served then started") {
      await inTx(venue, (tx) => serveLine(tx, venue.cfg, billId, 2));
    }
    const lineNos = [1, 2, 3, 4];
    const originals = await Promise.all(lineNos.map((lineNo) => lineOf(billId, lineNo)));
    const [waiting, sent, started, kept] = originals.map((line, index) => ({
      workingOrderLineId: line.id,
      menuItemId: venue.offerFor(names[index]!),
      quantity: "1",
    }));
    const [ticket] = await venue.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, started!.workingOrderLineId));
    const stations = await inTx(venue, readChangesAfterSending);
    const menuChanged = scenario === "waiting omitted after a menu publish";
    const { menuId, menuVersionId } = originals[0]!;
    try {
      await inTx(venue, async (tx) => {
        await setChangesAfterSending(tx, "never");
        await advanceTicketItem(tx, ticket!.id, "preparing");
        if (menuChanged) {
          await updateMenuItem(tx, menuId!, waiting!.menuItemId, { grossPrice: "26.00" });
          expect(await publishWorkingMenu(tx, menuId!)).not.toBe(menuVersionId);
        }
      });
      const edited = [waiting!, started!].map((line) => ({ ...line, note: "no onions" }));
      const lines = {
        "waiting first": [...edited, sent!],
        "started first": [edited[1]!, edited[0]!, sent!],
        "waiting then served then started": [edited[0]!, { ...sent!, note: "a glass" }, edited[1]!],
        "waiting omitted": [edited[1]!, sent!],
        "waiting and started omitted": [],
        "waiting omitted after a menu publish": [
          edited[1]!,
          sent!,
          { menuItemId: waiting!.menuItemId, quantity: "1", menuVersionId: menuVersionId! },
        ],
      }[scenario];

      expect(await saveBasket(billId, [...lines, kept!])).toMatchObject({
        status: 409,
        json: { code: "ticket.already_started", params: { ticketItemId: ticket!.id } },
      });
      if (menuChanged) {
        expect(await saveBasket(billId, [edited[0]!, ...lines, kept!])).toMatchObject({
          status: 409,
          json: { code: "menu.version_changed" },
        });
      }
      if (scenario === "waiting first") {
        for (const quantity of ["1", "2"]) {
          expect(
            await saveBasket(billId, [edited[0]!, { ...started!, quantity }, sent!, kept!]),
          ).toMatchObject({
            status: 409,
            json: { code: "ticket.already_fired", params: { workingOrderId: billId } },
          });
        }
      }
      expect(await Promise.all(lineNos.map((lineNo) => lineOf(billId, lineNo)))).toEqual(originals);
    } finally {
      await inTx(venue, async (tx) => {
        for (const [id, policy] of stations) await setChangesAfterSending(tx, policy, [id]);
        if (menuChanged) {
          await updateMenuItem(tx, menuId!, waiting!.menuItemId, { grossPrice: null });
          await publishWorkingMenu(tx, menuId!);
        }
      });
    }
  });

  it("keeps the sent refusal when a whole-basket save lowers a paid and fired line", async () => {
    const billId = await firedTabOf("Steak", "2", "House salad");
    const steak = await lineOf(billId, 1);
    const salad = await lineOf(billId, 2);
    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "50.00",
        method: "cash",
        tendered: "50.00",
        applied: "50.00",
        tip: "0.00",
      },
    );
    expect(paid.status).toBe(200);

    expect(
      await saveBasket(billId, [
        { workingOrderLineId: steak.id, menuItemId: venue.offerFor("Steak"), quantity: "1" },
        { workingOrderLineId: salad.id, menuItemId: venue.offerFor("House salad"), quantity: "1" },
      ]),
    ).toMatchObject({
      status: 409,
      json: { code: "ticket.already_fired", params: { workingOrderId: billId } },
    });
    expect(await lineOf(billId, 1)).toEqual(steak);
  });

  it("reports a refused sent edit before pricing a new sold-out dish", async () => {
    const billId = await firedTabOf("Steak", "1");
    const steak = await lineOf(billId, 1);
    const [salad] = await venue.db.select().from(products).where(eq(products.name, "House salad"));
    const stations = await inTx(venue, readChangesAfterSending);
    const saved = {
      workingOrderLineId: steak.id,
      menuItemId: venue.offerFor("Steak"),
      quantity: "1",
    };
    const newDish = { menuItemId: venue.offerFor("House salad"), quantity: "1" };
    try {
      await inTx(venue, async (tx) => {
        await setChangesAfterSending(tx, "never");
        await tx.update(products).set({ available: false }).where(eq(products.id, salad!.id));
      });
      expect(await saveBasket(billId, [saved, newDish])).toMatchObject({
        status: 409,
        json: { code: "product.unavailable", params: { productId: salad!.id } },
      });
      expect(await saveBasket(billId, [{ ...saved, note: "no onions" }, newDish])).toMatchObject({
        status: 409,
        json: { code: "ticket.already_fired", params: { workingOrderId: billId } },
      });
      expect(await lineOf(billId, 1)).toEqual(steak);
    } finally {
      await inTx(venue, async (tx) => {
        for (const [id, policy] of stations) await setChangesAfterSending(tx, policy, [id]);
        await tx
          .update(products)
          .set({ available: salad!.available })
          .where(eq(products.id, salad!.id));
      });
    }
  });

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
