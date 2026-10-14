import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { mergeBills, splitBill, transferItems } from "./bill-actions.js";
import { placeGroups } from "./order-groups.js";
import {
  OPERATOR,
  billRow,
  commandFor,
  inTx,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { splitLinesWithinOrder } from "./working-order.js";
import "./errors.js";

// ticket_items.sent_order_number: the number of the order a dish the kitchen had seen left.
let v: PartyVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

type Dish = { name: string; quantity?: string };

/** Sends the dishes to `billId` as one group, fired or held; held groups print no HOLD ticket. */
async function send(partyId: string, billId: string, dishes: Dish[], release: "fire" | "hold") {
  await inTx(v, (tx) =>
    placeGroups(tx, v.cfg, partyId, {
      groups: [
        {
          lines: dishes.map((d) => ({ menuItemId: v.item(d.name), quantity: d.quantity ?? "1" })),
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
});
