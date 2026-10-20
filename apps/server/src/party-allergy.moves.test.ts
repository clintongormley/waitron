import { expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  readPartyAllergy,
  savePartyAllergy,
  setAllergyLineTicks,
  writePartyAllergy,
  writeEditSentLines,
} from "@waitron/venue-service";
import { joinTables, splitTable } from "./testing/table-action-fixture.js";
import { mergeBills, transferItems } from "./testing/bill-action-fixture.js";
import { recallToDraft } from "./draft-recall.js";
import { splitDraft } from "./order-drafts.js";
import { readBillEditState } from "./bill-editing.js";
import { readPartyAllergyView } from "./party-allergy.js";
import { VENUE_SERVICE } from "./modules.js";
import { randomUUID } from "node:crypto";
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
  const seated = await seat(v, tableId);
  await inTx(v, (tx) =>
    writePartyAllergy(tx, seated.partyId, { answer: "none", guests: [] }, OPERATOR),
  );
  return { ...seated, tableId };
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
    await inTx(v, (tx) =>
      savePartyAllergy(
        tx,
        result.partyId,
        target.revision,
        { answer: "allergies", guests: [] },
        OPERATOR,
      ),
    );
    expect(await read(a.partyId)).toEqual(source);
    expect(await read(result.partyId)).toMatchObject({
      answer: "allergies",
      guests: [],
      ticks: [],
    });
  },
);

it.each([
  [null, null, null, []],
  [null, "none", null, []],
  ["none", null, null, []],
  ["none", "none", "none", []],
  [null, "allergies", "allergies", ["Joining guest"]],
  ["allergies", null, "allergies", ["Staying guest"]],
  ["none", "allergies", "allergies", ["Joining guest"]],
  ["allergies", "none", "allergies", ["Staying guest"]],
  ["allergies", "allergies", "allergies", ["Staying guest", "Joining guest"]],
] as const)("joining answers %s and %s retains %s", async (left, right, wanted, names) => {
  const a = await party(),
    b = await party();
  for (const [p, answer, who] of [
    [a, left, "Staying guest"],
    [b, right, "Joining guest"],
  ] as const) {
    if (answer === null)
      await v.db.run(sql`delete from party_allergy where party_id = ${p.partyId}`);
    else if (answer === "allergies") await save(p.partyId, who);
  }
  const command = await commandFor(v, a.partyId);
  await inTx(v, async (tx) =>
    joinTables(tx, v.cfg, a.partyId, b.tableId, {
      ...command,
      bills: "separate",
      otherPartyId: b.partyId,
      expectedOtherPartyRevision: (await readPartyAllergy(tx, b.partyId)).revision,
    }),
  );
  const result = await read(a.partyId);
  expect(result.answer).toBe(wanted);
  expect(result.guests.map((g) => g.who)).toEqual(names);
  expect(await read(b.partyId)).toMatchObject({ answer: null, guests: [], ticks: [] });
});

it("splitting one of two recalled dishes keeps both source assignments and their consideration", async () => {
  const a = await party();
  await order(v, a.tabId, "Burger", "Flan");
  const state = await save(a.partyId, "Window seat");
  const first = await dish(a.tabId, "Burger"),
    second = await dish(a.tabId, "Flan");
  await inTx(v, (tx) =>
    setAllergyLineTicks(
      tx,
      a.partyId,
      [first, second].map((line) => ({
        guestId: state.guests[0]!.id,
        workingLineId: line.id,
      })),
    ),
  );
  const oldSetting = await inTx(v, (tx) => VENUE_SERVICE.readEditSentLines(tx));
  try {
    await inTx(v, (tx) => writeEditSentLines(tx, true));
    let recalled;
    for (const line of [first, second]) {
      const command = await commandFor(v, a.partyId);
      recalled = await inTx(v, async (tx) =>
        recallToDraft(tx, v.cfg, a.partyId, line.id, {
          ...command,
          submissionId: randomUUID(),
          expectedEdit: await readBillEditState(tx, a.tabId),
        }),
      );
    }
    const before = await read(a.partyId);
    const chosen = recalled!.draft.lines.find((line) => line.sourceLineId === first.id)!;
    const command = await commandFor(v, a.partyId);
    const result = await inTx(v, async (tx) =>
      splitDraft(tx, v.cfg, a.partyId, recalled!.draft.id, {
        ...command,
        submissionId: randomUUID(),
        expectedEdit: await readBillEditState(tx, a.tabId),
        lineIds: [chosen.id],
      }),
    );
    expect((await read(a.partyId)).ticks).toEqual(before.ticks);
    const view = await inTx(v, (tx) => readPartyAllergyView(tx, v.cfg, a.partyId));
    expect(view.dishes).toHaveLength(2);
    expect(view.dishes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          line: { kind: "working", id: first.id },
          billId: result.billId,
          offeredBefore: true,
        }),
        expect.objectContaining({
          line: { kind: "working", id: second.id },
          billId: a.tabId,
          offeredBefore: true,
        }),
      ]),
    );
  } finally {
    await inTx(v, (tx) => writeEditSentLines(tx, oldSetting));
  }
});

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
