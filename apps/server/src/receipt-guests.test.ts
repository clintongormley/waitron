import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sales } from "@waitron/db";
import { mergeBills, transferItems } from "./bill-actions.js";
import { setPartyGuests } from "./parties.js";
import { joinTables, splitTable } from "./table-actions.js";
import { readReceiptGuests } from "./receipt-guests.js";
import {
  OPERATOR,
  commandFor,
  counterOrder,
  inTx,
  join,
  linesOf,
  nextMillisecond,
  orderForParty,
  partyRow,
  pay,
  revisionOf,
  seat,
  setupPartyVenue,
  split,
  type PartyVenue,
} from "./testing/party-venue.js";
import "./errors.js";

let v: PartyVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

/** Pays the bill in cash and answers the guests its receipt prints. */
async function guestsOnPaying(billId: string, amount: string): Promise<number | undefined> {
  await pay(v, billId, amount);
  return inTx(v, async (tx) => {
    const [sale] = await tx
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.workingOrderId, billId));
    return readReceiptGuests(tx, sale!.id);
  });
}

async function joinOther(
  partyId: string,
  tableId: string,
  otherPartyId: string,
  bills: "merge" | "separate",
) {
  await nextMillisecond();
  const options = {
    bills,
    expectedPartyRevision: await revisionOf(v, partyId),
    otherPartyId,
    expectedOtherPartyRevision: await revisionOf(v, otherPartyId),
    operatorId: OPERATOR,
  };
  await inTx(v, (tx) => joinTables(tx, v.cfg, partyId, tableId, options));
}

describe("the guests a receipt prints", () => {
  it("prints a party's count on its one bill", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Invitados 1"), 4);
    await orderForParty(v, partyId, ["Burger"], tabId);

    expect(await guestsOnPaying(tabId, "12.00")).toBe(4);
  });

  it("prints nothing for a party seated with no count", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Invitados 2"));
    await orderForParty(v, partyId, ["Burger"], tabId);

    expect(await guestsOnPaying(tabId, "12.00")).toBeUndefined();
  });

  it("prints nothing for a counter sale", async () => {
    const orderId = await counterOrder(v, "Burger");

    expect(await guestsOnPaying(orderId, "12.00")).toBeUndefined();
  });

  it("prints nothing on either bill of a party that split a dish onto a second bill", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Invitados 4"), 4);
    await orderForParty(v, partyId, ["Burger", "Vino"], tabId);
    const second = await split(v, partyId, tabId, [2]);

    expect(await guestsOnPaying(second, "30.00")).toBeUndefined();
    expect(await guestsOnPaying(tabId, "12.00")).toBeUndefined();
  });

  it("prints the count again once the split bill is merged back", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Invitados 5"), 4);
    await orderForParty(v, partyId, ["Burger", "Vino"], tabId);
    const second = await split(v, partyId, tabId, [2]);
    const command = await commandFor(v, partyId);
    await inTx(v, (tx) => mergeBills(tx, v.cfg, tabId, second, command));

    expect(await guestsOnPaying(tabId, "42.00")).toBe(4);
  });

  it("prints the sum on joined tables whose bills were merged", async () => {
    const mesa4 = await v.table("Invitados 6a 4");
    const mesa5 = await v.table("Invitados 6a 5");
    const four = await seat(v, mesa4, 2);
    const five = await seat(v, mesa5, 3);
    await orderForParty(v, four.partyId, ["Burger"], four.tabId);
    await orderForParty(v, five.partyId, ["Paella"], five.tabId);
    await joinOther(four.partyId, mesa5, five.partyId, "merge");

    expect(await guestsOnPaying(four.tabId, "32.00")).toBe(5);
  });

  it("prints nothing on joined tables whose bills were kept separate", async () => {
    const mesa4 = await v.table("Invitados 6b 4");
    const mesa5 = await v.table("Invitados 6b 5");
    const four = await seat(v, mesa4, 2);
    const five = await seat(v, mesa5, 3);
    await orderForParty(v, four.partyId, ["Burger"], four.tabId);
    await orderForParty(v, five.partyId, ["Paella"], five.tabId);
    await joinOther(four.partyId, mesa5, five.partyId, "separate");

    expect(await guestsOnPaying(five.tabId, "20.00")).toBeUndefined();
    expect(await guestsOnPaying(four.tabId, "12.00")).toBeUndefined();
  });

  it("prints nothing on a bill paid by a party afterwards merged into another", async () => {
    const xTable = await v.table("Invitados 7 X");
    const x = await seat(v, xTable, 2);
    await orderForParty(v, x.partyId, ["Burger"], x.tabId);
    await pay(v, x.tabId, "12.00");
    const y = await seat(v, await v.table("Invitados 7 Y"), 3);
    await joinOther(y.partyId, xTable, x.partyId, "merge");

    expect((await partyRow(v, x.partyId)).mergedIntoPartyId).toBe(y.partyId);
    const [sale] = await inTx(v, (tx) =>
      tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, x.tabId)),
    );
    expect(await inTx(v, (tx) => readReceiptGuests(tx, sale!.id))).toBeUndefined();
  });

  it("prints a count changed after seating", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Invitados 8"), 4);
    await orderForParty(v, partyId, ["Burger"], tabId);
    const expectedPartyRevision = await revisionOf(v, partyId);
    await inTx(v, (tx) => setPartyGuests(tx, { partyId, guestCount: 6, expectedPartyRevision }));

    expect(await guestsOnPaying(tabId, "12.00")).toBe(6);
  });

  it("prints nothing for a party that joined a table whose party had already paid", async () => {
    const xTable = await v.table("Invitados 9 X");
    const x = await seat(v, xTable, 2);
    await orderForParty(v, x.partyId, ["Burger"], x.tabId);
    await pay(v, x.tabId, "12.00");
    const y = await seat(v, await v.table("Invitados 9 Y"), 3);
    await orderForParty(v, y.partyId, ["Paella"], y.tabId);
    await joinOther(y.partyId, xTable, x.partyId, "merge");

    expect((await partyRow(v, y.partyId)).guestCount).toBe(5);
    expect(await guestsOnPaying(y.tabId, "20.00")).toBeUndefined();
  });

  it("prints each side's count after Split a table", async () => {
    const mesa4 = await v.table("Invitados 10 4");
    const mesa5 = await v.table("Invitados 10 5");
    const { partyId, tabId } = await seat(v, mesa4, 4);
    await join(v, partyId, mesa5);
    await orderForParty(v, partyId, ["Burger", "Vino"], tabId);
    const second = await split(v, partyId, tabId, [2]);
    const command = await commandFor(v, partyId);
    await inTx(v, (tx) =>
      splitTable(tx, v.cfg, partyId, mesa5, second, {
        ...command,
        guests: { staying: 3, leaving: 1 },
      }),
    );

    expect(await guestsOnPaying(tabId, "12.00")).toBe(3);
    expect(await guestsOnPaying(second, "30.00")).toBe(1);
  });

  it("prints nothing while an emptied split bill stays open", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Invitados 11"), 4);
    await orderForParty(v, partyId, ["Burger", "Vino"], tabId);
    const second = await split(v, partyId, tabId, [2]);
    const [moved] = await linesOf(v, second);
    const command = await commandFor(v, partyId);
    await inTx(v, (tx) =>
      transferItems(tx, v.cfg, second, tabId, [{ lineNo: moved!.lineNo }], command),
    );

    expect(await guestsOnPaying(tabId, "42.00")).toBeUndefined();
  });
});
