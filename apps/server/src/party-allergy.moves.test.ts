import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readPartyAllergy, savePartyAllergy, setAllergyLineTicks } from "@waitron/venue-service";
import { joinTables, splitTable } from "./testing/table-action-fixture.js";
import { mergeBills, transferItems } from "./bill-actions.js";
import {
  OPERATOR,
  commandFor,
  inTx,
  join,
  order,
  revisionOf,
  seat,
  setupPartyVenue,
  split,
  type PartyVenue,
} from "./testing/party-venue.js";

let v: PartyVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});
let number = 0;
async function party() {
  const tableId = await v.table(`Allergy ${++number}`);
  return { ...(await seat(v, tableId)), tableId };
}
function read(id: string) {
  return inTx(v, (tx) => readPartyAllergy(tx, id));
}
async function save(id: string, who: string) {
  const revision = await revisionOf(v, id);
  return inTx(v, async (tx) =>
    savePartyAllergy(
      tx,
      id,
      revision,
      { answer: "allergies", guests: [{ who, allergens: { milk: {} }, note: "Severe" }] },
      OPERATOR,
    ),
  );
}
async function dish(billId: string, name: string) {
  const rows = await v.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId));
  return rows.find((line) => line.name === name)!;
}

it("combining seated parties retains both guest lists and working-line assignments", async () => {
  const a = await party(),
    b = await party();
  await order(v, a.tabId, "Burger");
  await order(v, b.tabId, "Flan");
  const ga = await save(a.partyId, "Window seat"),
    gb = await save(b.partyId, "Blue jumper");
  const lineA = await dish(a.tabId, "Burger"),
    lineB = await dish(b.tabId, "Flan");
  await inTx(v, (tx) =>
    setAllergyLineTicks(tx, a.partyId, [{ guestId: ga.guests[0]!.id, workingLineId: lineA.id }]),
  );
  await inTx(v, (tx) =>
    setAllergyLineTicks(tx, b.partyId, [{ guestId: gb.guests[0]!.id, workingLineId: lineB.id }]),
  );
  const command = await commandFor(v, a.partyId);
  const otherRevision = await revisionOf(v, b.partyId);
  await inTx(v, (tx) =>
    joinTables(tx, v.cfg, a.partyId, b.tableId, {
      ...command,
      bills: "separate",
      otherPartyId: b.partyId,
      expectedOtherPartyRevision: otherRevision,
    }),
  );
  const result = await read(a.partyId);
  expect(result.guests.map((g) => g.who)).toEqual(["Window seat", "Blue jumper"]);
  expect(result.ticks).toEqual(
    expect.arrayContaining([
      { guestId: ga.guests[0]!.id, draftLineId: null, workingLineId: lineA.id },
      { guestId: gb.guests[0]!.id, draftLineId: null, workingLineId: lineB.id },
    ]),
  );
  expect(result.ticks).toHaveLength(2);
});

it.each([true, false])(
  "split a table copies all guests and only the chosen bill's ticks (take bill %s)",
  async (takesBill) => {
    const a = await party();
    const leavingTable = await v.table(`Leaving ${++number}`);
    await join(v, a.partyId, leavingTable);
    await order(v, a.tabId, "Burger", "Flan");
    const bill = await split(v, a.partyId, a.tabId, [2]);
    const state = await save(a.partyId, "Window seat");
    const staying = await dish(a.tabId, "Burger"),
      leaving = await dish(bill, "Flan");
    await inTx(v, (tx) =>
      setAllergyLineTicks(tx, a.partyId, [
        { guestId: state.guests[0]!.id, workingLineId: staying.id },
        { guestId: state.guests[0]!.id, workingLineId: leaving.id },
      ]),
    );
    const command = await commandFor(v, a.partyId);
    const result = await inTx(v, (tx) =>
      splitTable(tx, v.cfg, a.partyId, leavingTable, takesBill ? bill : null, command),
    );
    const source = await read(a.partyId),
      target = await read(result.partyId);
    expect(source.guests.map((g) => g.who)).toEqual(["Window seat"]);
    expect(target.guests.map((g) => g.who)).toEqual(["Window seat"]);
    expect(target.guests[0]!.id).not.toBe(source.guests[0]!.id);
    expect(source.ticks).toHaveLength(takesBill ? 1 : 2);
    expect(target.ticks).toEqual(
      takesBill
        ? [{ guestId: target.guests[0]!.id, draftLineId: null, workingLineId: leaving.id }]
        : [],
    );
  },
);

it("whole dish ticks survive a same-party bill split, transfer and merge", async () => {
  const a = await party();
  await order(v, a.tabId, "Burger", "Flan", "Vino");
  const state = await save(a.partyId, "Red coat");
  const first = await dish(a.tabId, "Burger"),
    second = await dish(a.tabId, "Flan");
  await inTx(v, (tx) =>
    setAllergyLineTicks(tx, a.partyId, [
      { guestId: state.guests[0]!.id, workingLineId: first.id },
      { guestId: state.guests[0]!.id, workingLineId: second.id },
    ]),
  );
  const before = (await read(a.partyId)).ticks;
  const other = await split(v, a.partyId, a.tabId, [1]);
  const transfer = await commandFor(v, a.partyId);
  await inTx(v, (tx) => transferItems(tx, v.cfg, a.tabId, other, [{ lineNo: 2 }], transfer));
  const merge = await commandFor(v, a.partyId);
  await inTx(v, (tx) => mergeBills(tx, v.cfg, a.tabId, other, merge));
  expect((await read(a.partyId)).ticks).toEqual(before);
});
