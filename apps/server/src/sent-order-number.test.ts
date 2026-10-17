import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setRoutingCell } from "@waitron/venue-service";
import { products, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { mergeBills, splitBill, transferItems } from "./testing/bill-action-fixture.js";
import { readFormerNumbers } from "./former-numbers.js";
import { createStation } from "./kitchen.js";
import { setMadeHereStations } from "./made-here.js";
import { moveBill } from "./testing/move-bill-fixture.js";

import { placeGroups } from "./testing/group-submit-fixture.js";
import {
  OPERATOR,
  billRow,
  commandFor,
  counterOrder,
  inTx,
  revisionOf,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { addExtras } from "./testing/split-extras-venue.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { fireLines, splitLinesWithinOrder, updateOrderLine } from "./working-order.js";
import "./errors.js";

// ticket_items.sent_order_number: the number of the order a dish the kitchen had seen left.
let v: PartyVenue;
let cheese: { listId: string; productId: string };
/** The tables zone's offers, made again once the Caña offers a Cheese extra. */
let offers: ZoneOffers;
/** The venue's device makes the Vino and the Cheese on the spot when it sends them with this configuration. */
let madeHereCfg: PartyVenue["cfg"];
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
    const [cana] = await db
      .select({ catalogueId: products.catalogueId })
      .from(products)
      .where(eq(products.id, v.productId("Caña")));
    const { listId, productIds } = await inTx(v, (tx) =>
      addExtras(tx, v.cfg, cana!.catalogueId, v.productId("Caña"), [
        { name: "Cheese", customerName: "Queso extra", kitchenName: "QUESO", maxQuantity: 2 },
      ]),
    );
    cheese = { listId, productId: productIds[0]! };
    // At a station of its own, the Cheese has a kitchen item of its own rather than riding on the
    // Caña's.
    const quesos = await inTx(v, async (tx) => {
      const { id: stationId } = await createStation(tx, v.cfg, { name: "Quesos" });
      await setRoutingCell(
        tx,
        v.cfg,
        { row: { kind: "product", productId: cheese.productId }, zoneId: null },
        { kind: "station", stationId },
      );
      return stationId;
    });
    await inTx(v, async (tx) => {
      const { id: barra } = await createStation(tx, v.cfg, { name: "Barra" });
      await setRoutingCell(
        tx,
        v.cfg,
        { row: { kind: "product", productId: v.productId("Vino") }, zoneId: null },
        { kind: "station", stationId: barra },
      );
      await setMadeHereStations(tx, v.cfg, v.cfg.origin.deviceId, [barra, quesos]);
    });
    madeHereCfg = { ...v.cfg, sendingDeviceId: v.cfg.origin.deviceId };
    offers = await inTx(v, (tx) => offerProducts(tx, v.cfg, { zone: "tables" }));
  },
});

type Dish = { name: string; quantity?: string; cheese?: number };

/** Sends the dishes to `billId` as one group, fired or held; held groups print no HOLD ticket. */
async function send(
  partyId: string,
  billId: string,
  dishes: Dish[],
  release: "fire" | "hold",
  cfg = v.cfg,
) {
  await inTx(v, (tx) =>
    placeGroups(tx, cfg, partyId, {
      groups: [
        {
          lines: dishes.map((d) => ({
            menuItemId: offers.offerFor(v.productId(d.name)),
            quantity: d.quantity ?? "1",
            ...(d.cheese === undefined
              ? {}
              : {
                  extras: [
                    {
                      listId: cheese.listId,
                      picks: [{ productId: cheese.productId, quantity: d.cheese }],
                    },
                  ],
                }),
          })),
          release,
        },
      ],
      operatorId: OPERATOR,
      billId,
    }),
  );
}

/** A party at a fresh table with `count` bills, each made by splitting off an Agua. */
async function party(label: string, count: number): Promise<{ partyId: string; bills: string[] }> {
  const { partyId, tabId } = await seat(v, await v.table(label));
  const bills = [tabId];
  for (let i = 1; i < count; i++) {
    await send(partyId, tabId, [{ name: "Agua" }], "fire");
    const command = await commandFor(v, partyId);
    const { billId } = await inTx(v, async (tx) => {
      const [{ lineNo }] = await tx.all<{ lineNo: number }>(
        sql`select max(line_no) as lineNo from working_order_lines where working_order_id = ${tabId}`,
      );
      return splitBill(tx, v.cfg, tabId, [{ lineNo }], command);
    });
    bills.push(billId);
  }
  return { partyId, bills };
}

async function numberOf(billId: string): Promise<number> {
  return (await billRow(v, billId)).orderNumber;
}

/**
 * Each kitchen item on the bill but the Aguas {@link party} splits off: its dish, the quantity it
 * asks for and its sent order number.
 */
function kitchenItems(billId: string) {
  return v.db.all<{ name: string; quantity: number; sent: number | null }>(sql`
    select l.name as name, t.quantity as quantity, t.sent_order_number as sent
    from ticket_items t join working_order_lines l on l.id = t.working_order_line_id
    where t.working_order_id = ${billId} and l.name <> 'Agua'
    order by l.line_no`);
}

/** Whether the bill's kitchen items of `name` are made here. */
function madeHereOf(billId: string, name: string): boolean[] {
  return v.db
    .all<{ madeHere: number }>(
      sql`
      select t.made_here as madeHere
      from ticket_items t join working_order_lines l on l.id = t.working_order_line_id
      where t.working_order_id = ${billId} and l.name = ${name}`,
    )
    .map((row) => row.madeHere === 1);
}

/** The line number of the bill's line of `name`. */
function lineOf(billId: string, name: string): number {
  const [row] = v.db.all<{ lineNo: number }>(sql`
    select line_no as lineNo from working_order_lines
    where working_order_id = ${billId} and name = ${name}`);
  return row!.lineNo;
}

async function merge(partyId: string, intoBillId: string, fromBillId: string) {
  const command = await commandFor(v, partyId);
  await inTx(v, (tx) => mergeBills(tx, v.cfg, intoBillId, fromBillId, command));
}

async function transfer(
  partyId: string,
  fromBillId: string,
  toBillId: string,
  transfers: { lineNo: number; quantity?: string }[],
) {
  const command = await commandFor(v, partyId);
  await inTx(v, (tx) => transferItems(tx, v.cfg, fromBillId, toBillId, transfers, command));
}

/** Changes the note on the bill's line of `name`, as the till's line edit does. */
async function editNote(billId: string, name: string, note: string, cfg = v.cfg) {
  const { revision } = await billRow(v, billId);
  await inTx(v, (tx) =>
    updateOrderLine(tx, cfg, billId, lineOf(billId, name), { note }, revision, OPERATOR),
  );
}

/** Marks the bill's held groups as printed on a HOLD ticket. */
function holdTicketPrinted(billId: string) {
  v.db.run(sql`
    update order_groups set hold_printed_at = '2026-10-14T12:00:00.000Z'
    where id in (select group_id from working_order_lines where working_order_id = ${billId})
      and state = 'held'`);
}

describe("the order number a moved dish was sent under", () => {
  it("is recorded on a merged bill's sent dishes, and the first one is kept through a second merge", async () => {
    const { partyId, bills } = await party("Mesa sent 1", 3);
    const [b26, b27, b28] = bills as [string, string, string];
    await send(partyId, b27, [{ name: "Paella" }], "fire");
    await send(partyId, b28, [{ name: "Burger" }], "fire");
    const n27 = await numberOf(b27);
    const n28 = await numberOf(b28);

    await merge(partyId, b27, b28);
    expect(kitchenItems(b27)).toEqual([
      { name: "Paella", quantity: 1000, sent: null },
      { name: "Burger", quantity: 1000, sent: n28 },
    ]);

    await merge(partyId, b26, b27);
    expect(kitchenItems(b26)).toEqual([
      { name: "Paella", quantity: 1000, sent: n27 },
      { name: "Burger", quantity: 1000, sent: n28 },
    ]);
  });

  it("is recorded on the part of a sent line transferred, not on the part kept", async () => {
    const { partyId, bills } = await party("Mesa sent 2", 2);
    const [b27, b28] = bills as [string, string];
    await send(partyId, b28, [{ name: "Burger", quantity: "3" }], "fire");
    const n28 = await numberOf(b28);

    await transfer(partyId, b28, b27, [{ lineNo: lineOf(b28, "Burger"), quantity: "1" }]);

    expect(kitchenItems(b28)).toEqual([{ name: "Burger", quantity: 2000, sent: null }]);
    expect(kitchenItems(b27)).toEqual([{ name: "Burger", quantity: 1000, sent: n28 }]);
  });

  it("keeps the first number when part of an already moved dish moves on", async () => {
    const { partyId, bills } = await party("Mesa sent 3", 3);
    const [b26, b27, b28] = bills as [string, string, string];
    await send(partyId, b28, [{ name: "Burger", quantity: "2" }], "fire");
    const n28 = await numberOf(b28);
    await merge(partyId, b27, b28);

    await transfer(partyId, b27, b26, [{ lineNo: lineOf(b27, "Burger"), quantity: "1" }]);

    expect(kitchenItems(b27)).toEqual([{ name: "Burger", quantity: 1000, sent: n28 }]);
    expect(kitchenItems(b26)).toEqual([{ name: "Burger", quantity: 1000, sent: n28 }]);
  });

  it("is recorded on the dishes a split puts on a new bill, whole lines and parts", async () => {
    const { partyId, bills } = await party("Mesa sent 4", 1);
    const [b28] = bills as [string];
    await send(partyId, b28, [{ name: "Burger" }, { name: "Paella", quantity: "2" }], "fire");
    const n28 = await numberOf(b28);
    const command = await commandFor(v, partyId);

    const { billId: b29 } = await inTx(v, (tx) =>
      splitBill(
        tx,
        v.cfg,
        b28,
        [{ lineNo: lineOf(b28, "Burger") }, { lineNo: lineOf(b28, "Paella"), quantity: "1" }],
        command,
      ),
    );

    expect(kitchenItems(b28)).toEqual([{ name: "Paella", quantity: 1000, sent: null }]);
    expect(kitchenItems(b29).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "Burger", quantity: 1000, sent: n28 },
      { name: "Paella", quantity: 1000, sent: n28 },
    ]);
  });

  it("is not recorded on a held dish whose HOLD ticket never printed", async () => {
    const { partyId, bills } = await party("Mesa sent 5", 3);
    const [b26, b27, b28] = bills as [string, string, string];
    await send(partyId, b28, [{ name: "Flan" }, { name: "Tarta", quantity: "2" }], "hold");

    await transfer(partyId, b28, b27, [{ lineNo: lineOf(b28, "Tarta"), quantity: "1" }]);
    await merge(partyId, b26, b28);

    expect(kitchenItems(b26)).toEqual([
      { name: "Flan", quantity: 1000, sent: null },
      { name: "Tarta", quantity: 1000, sent: null },
    ]);
    expect(kitchenItems(b27)).toEqual([{ name: "Tarta", quantity: 1000, sent: null }]);
  });

  it("is recorded on a held dish whose HOLD ticket printed", async () => {
    const { partyId, bills } = await party("Mesa sent 6", 3);
    const [b26, b27, b28] = bills as [string, string, string];
    await send(partyId, b28, [{ name: "Flan" }, { name: "Tarta", quantity: "2" }], "hold");
    holdTicketPrinted(b28);
    const n28 = await numberOf(b28);

    await transfer(partyId, b28, b27, [{ lineNo: lineOf(b28, "Tarta"), quantity: "1" }]);
    await merge(partyId, b26, b28);

    expect(kitchenItems(b26)).toEqual([
      { name: "Flan", quantity: 1000, sent: n28 },
      { name: "Tarta", quantity: 1000, sent: n28 },
    ]);
    expect(kitchenItems(b27)).toEqual([{ name: "Tarta", quantity: 1000, sent: n28 }]);
  });

  it("is not recorded when part of a sent line is split off within its own order", async () => {
    const { bills } = await party("Mesa sent 7", 1);
    const [b28] = bills as [string];
    const partyId = (await billRow(v, b28)).partyId!;
    await send(partyId, b28, [{ name: "Burger", quantity: "2" }], "fire");

    await inTx(v, (tx) =>
      splitLinesWithinOrder(tx, v.cfg, b28, [{ lineNo: lineOf(b28, "Burger"), quantity: "1" }]),
    );

    expect(kitchenItems(b28)).toEqual([
      { name: "Burger", quantity: 1000, sent: null },
      { name: "Burger", quantity: 1000, sent: null },
    ]);
  });
  // A part of a dish with extras cannot move to another bill (`tab.transfer_modifier_line`), so
  // extras change order only as whole lines.
  it("is recorded on a moved dish's extras too", async () => {
    const { partyId, bills } = await party("Mesa sent 8", 3);
    const [b26, b27, b28] = bills as [string, string, string];
    await send(partyId, b28, [{ name: "Caña", quantity: "2", cheese: 1 }], "fire");
    await send(partyId, b27, [{ name: "Caña", cheese: 1 }], "fire");
    const n27 = await numberOf(b27);
    const n28 = await numberOf(b28);

    await transfer(partyId, b28, b27, [{ lineNo: lineOf(b28, "Caña") }]);
    await merge(partyId, b26, b27);

    expect(kitchenItems(b26)).toEqual([
      { name: "Caña", quantity: 1000, sent: n27 },
      { name: "Cheese", quantity: 1000, sent: n27 },
      { name: "Caña", quantity: 2000, sent: n28 },
      { name: "Cheese", quantity: 2000, sent: n28 },
    ]);
  });

  // A made-here item is never printed and no kitchen screen shows it, so it has no kitchen paper.
  it("is not recorded on a made-here item when its bill merges", async () => {
    const { partyId, bills } = await party("Mesa sent 10", 2);
    const [b27, b28] = bills as [string, string];
    await send(partyId, b28, [{ name: "Burger" }], "fire");
    await send(partyId, b28, [{ name: "Vino" }], "fire", madeHereCfg);
    const n28 = await numberOf(b28);
    expect(madeHereOf(b28, "Vino")).toEqual([true]);

    await merge(partyId, b27, b28);

    expect(kitchenItems(b27)).toEqual([
      { name: "Burger", quantity: 1000, sent: n28 },
      { name: "Vino", quantity: 1000, sent: null },
    ]);
  });

  it("is not recorded on the part of a made-here line transferred", async () => {
    const { partyId, bills } = await party("Mesa sent 11", 2);
    const [b27, b28] = bills as [string, string];
    await send(partyId, b28, [{ name: "Vino", quantity: "2" }], "fire", madeHereCfg);

    await transfer(partyId, b28, b27, [{ lineNo: lineOf(b28, "Vino"), quantity: "1" }]);

    expect(madeHereOf(b27, "Vino")).toEqual([true]);
    expect(kitchenItems(b27)).toEqual([{ name: "Vino", quantity: 1000, sent: null }]);
    expect(kitchenItems(b28)).toEqual([{ name: "Vino", quantity: 1000, sent: null }]);
  });

  it("is recorded as the counter order's number when a sent counter order merges into a table's bill", async () => {
    const mesa = await v.table("Mesa sent 9");
    const { partyId, tabId } = await seat(v, mesa);
    await send(partyId, tabId, [{ name: "Paella" }], "fire");
    const counter = await counterOrder(v, "Burger");
    await inTx(v, async (tx) =>
      fireLines(
        tx,
        v.cfg,
        counter,
        await tx
          .select({
            id: workingOrderLines.id,
            productId: workingOrderLines.productId,
            courseId: workingOrderLines.courseId,
            parentLineId: workingOrderLines.parentLineId,
            note: workingOrderLines.note,
            quantity: workingOrderLines.quantity,
          })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, counter)),
      ),
    );
    const nCounter = await numberOf(counter);

    const expectedOtherPartyRevision = await revisionOf(v, partyId);
    const result = await inTx(v, (tx) =>
      moveBill(
        tx,
        v.cfg,
        counter,
        { tableId: mesa },
        {
          bills: "merge",
          operatorId: OPERATOR,
          otherPartyId: partyId,
          expectedOtherPartyRevision,
        },
      ),
    );

    expect(result).toMatchObject({ billId: tabId, merged: true });
    expect(kitchenItems(tabId)).toEqual([
      { name: "Paella", quantity: 1000, sent: null },
      { name: "Burger", quantity: 1000, sent: nCounter },
    ]);
  });
});

describe("the order number an edited dish was sent under", () => {
  it("is kept when a moved dish is edited and sent again", async () => {
    const { partyId, bills } = await party("Mesa edit 1", 2);
    const [b27, b28] = bills as [string, string];
    await send(partyId, b28, [{ name: "Burger" }], "fire");
    const n28 = await numberOf(b28);
    await merge(partyId, b27, b28);

    await editNote(b27, "Burger", "sin cebolla");

    expect(kitchenItems(b27)).toEqual([{ name: "Burger", quantity: 1000, sent: n28 }]);
    const former = await inTx(v, (tx) => readFormerNumbers(tx, [b27]));
    expect(former.get(b27)).toEqual([n28]);
  });

  it("is kept on the extras of a moved dish that is edited", async () => {
    const { partyId, bills } = await party("Mesa edit 2", 2);
    const [b27, b28] = bills as [string, string];
    await send(partyId, b28, [{ name: "Caña", cheese: 1 }], "fire");
    const n28 = await numberOf(b28);
    await merge(partyId, b27, b28);

    await editNote(b27, "Caña", "bien fría");

    expect(kitchenItems(b27)).toEqual([
      { name: "Caña", quantity: 1000, sent: n28 },
      { name: "Cheese", quantity: 1000, sent: n28 },
    ]);
  });

  it("is not given to an edited dish that never moved", async () => {
    const { partyId, bills } = await party("Mesa edit 3", 1);
    const [b28] = bills as [string];
    await send(partyId, b28, [{ name: "Burger" }], "fire");

    await editNote(b28, "Burger", "sin cebolla");

    expect(kitchenItems(b28)).toEqual([{ name: "Burger", quantity: 1000, sent: null }]);
  });

  it("stays the first number when an edited moved dish moves again", async () => {
    const { partyId, bills } = await party("Mesa edit 4", 3);
    const [b26, b27, b28] = bills as [string, string, string];
    await send(partyId, b28, [{ name: "Burger" }], "fire");
    const n28 = await numberOf(b28);
    await merge(partyId, b27, b28);
    await editNote(b27, "Burger", "sin cebolla");

    await merge(partyId, b26, b27);

    expect(kitchenItems(b26)).toEqual([{ name: "Burger", quantity: 1000, sent: n28 }]);
  });

  it("is not given to an edited moved dish's extra when the editing device makes it on the spot", async () => {
    const { partyId, bills } = await party("Mesa edit 5", 2);
    const [b27, b28] = bills as [string, string];
    await send(partyId, b28, [{ name: "Caña", cheese: 1 }], "fire");
    const n28 = await numberOf(b28);
    await merge(partyId, b27, b28);
    expect(madeHereOf(b27, "Cheese")).toEqual([false]);

    await editNote(b27, "Caña", "bien fría", madeHereCfg);

    expect(madeHereOf(b27, "Caña")).toEqual([false]);
    expect(madeHereOf(b27, "Cheese")).toEqual([true]);
    expect(kitchenItems(b27)).toEqual([
      { name: "Caña", quantity: 1000, sent: n28 },
      { name: "Cheese", quantity: 1000, sent: null },
    ]);
  });
});
