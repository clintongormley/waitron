import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { mergeBills, splitBill } from "./testing/bill-action-fixture.js";
import { finishTable } from "./testing/party-close-fixture.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import {
  allocationsOf,
  billNumberTables,
  expectEveryPartyBillNumbered,
  numbersOf,
} from "./testing/bill-identities.js";
import {
  OPERATOR,
  commandFor,
  counterOrder,
  inTx,
  order,
  orderForParty,
  partyRow,
  pay,
  seatWithNoAllergies as seat,
  setupPartyVenue,
  split,
  type PartyVenue,
} from "./testing/party-venue.js";
import { splitDraft } from "./order-drafts.js";
import { saveDraftForTest } from "./testing/draft-command-fixture.js";
import { readBillEditState } from "./bill-editing.js";
import "./errors.js";

// A803 slice 2: each bill at a table keeps the number its seated party gave it.
let v: PartyVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

async function everyPartyBillNumbered(): Promise<void> {
  await inTx(v, (tx) => expectEveryPartyBillNumbered(tx));
}

describe("A803 bill numbers: created", () => {
  it("a seated table's first bill is Bill 1, and splitting gives Bill 2 then Bill 3", async () => {
    const { partyId, tabId } = await seat(v, await v.table("N1"));
    await order(v, tabId, "Burger", "Vino", "Agua");
    const second = await split(v, partyId, tabId, [1]);
    const third = await split(v, partyId, tabId, [2]);

    expect(await numbersOf(v, partyId)).toEqual([
      [tabId, 1, null],
      [second, 2, null],
      [third, 3, null],
    ]);
    expect(await allocationsOf(v, partyId)).toEqual([
      [1, tabId],
      [2, second],
      [3, third],
    ]);
    await everyPartyBillNumbered();
  });

  it("merging Bill 2 away leaves Bill 1 and Bill 3, and the next bill is Bill 4", async () => {
    const { partyId, tabId } = await seat(v, await v.table("N2"));
    await order(v, tabId, "Burger", "Vino", "Agua", "Flan");
    const second = await split(v, partyId, tabId, [1]);
    const third = await split(v, partyId, tabId, [2]);
    const command = await commandFor(v, partyId);
    await inTx(v, (tx) => mergeBills(tx, v.cfg, tabId, second, command));
    const fourth = await split(v, partyId, tabId, [3]);

    expect((await numbersOf(v, partyId)).filter(([id]) => id !== second)).toEqual([
      [tabId, 1, null],
      [third, 3, null],
      [fourth, 4, null],
    ]);
    expect(await allocationsOf(v, partyId)).toEqual([
      [1, tabId],
      [2, second],
      [3, third],
      [4, fourth],
    ]);
    await everyPartyBillNumbered();
  });

  it("putting unsent dishes on a new bill takes the next number", async () => {
    const { partyId, tabId } = await seat(v, await v.table("N3"));
    const draft = await inTx(v, (tx) =>
      saveDraftForTest(tx, v.cfg, partyId, OPERATOR, {
        billId: tabId,
        draftId: null,
        revision: 0,
        lines: ["Burger", "Vino"].map((name, index) => ({
          menuItemId: v.item(name),
          variantId: null,
          menuVersionId: null,
          quantity: "1",
          options: [],
          extras: [],
          note: null,
          courseId: null,
          noMerge: false,
          slot: index + 1,
          joinGroupId: null,
          afterGroupId: null,
        })),
      }),
    );
    const command = await commandFor(v, partyId);
    const moved = await inTx(v, async (tx) => {
      const edit = await readBillEditState(tx, tabId);
      return splitDraft(tx, v.cfg, partyId, draft.id, {
        ...command,
        submissionId: randomUUID(),
        expectedEdit: {
          billId: edit.billId,
          editorVersion: edit.editorVersion,
          draftId: edit.draftId,
          draftRevision: edit.draftRevision,
        },
        lineIds: [draft.lines[1]!.id],
      });
    });

    expect(await numbersOf(v, partyId)).toEqual([
      [tabId, 1, null],
      [moved.destination.edit.billId, 2, null],
    ]);
    await everyPartyBillNumbered();
  });

  it("a main bill given to a party whose bills are all paid takes the next number, not Bill 1 again", async () => {
    const { partyId, tabId } = await seat(v, await v.table("N4"));
    await order(v, tabId, "Burger");
    await pay(v, tabId, "12.00");
    expect((await partyRow(v, partyId)).mainBillId).toBeNull();

    const { tabId: next } = await orderForParty(v, partyId, ["Agua"]);

    expect(next).not.toBe(tabId);
    expect(await numbersOf(v, partyId)).toEqual([
      [tabId, 1, null],
      [next, 2, null],
    ]);
    await everyPartyBillNumbered();
  });

  it("finishing the table and seating it again starts at Bill 1", async () => {
    const tableId = await v.table("N5");
    const first = await seat(v, tableId);
    await order(v, first.tabId, "Burger", "Agua");
    const second = await split(v, first.partyId, first.tabId, [1]);
    await pay(v, first.tabId, "2.00");
    await pay(v, second, "12.00");
    const command = await commandFor(v, first.partyId);
    await inTx(v, (tx) => finishTable(tx, { partyId: first.partyId, ...command }));

    const again = await seat(v, tableId);

    expect(await numbersOf(v, again.partyId)).toEqual([[again.tabId, 1, null]]);
    await everyPartyBillNumbered();
  });

  it("a split from a counter order makes no row", async () => {
    const orderId = await counterOrder(v, "Burger", "Agua");
    const before = await billNumberTables(v);

    const { billId } = await inTx(v, (tx) =>
      splitBill(tx, v.cfg, orderId, [{ lineNo: 1 }], { operatorId: OPERATOR }),
    );

    expect(billId).not.toBe(orderId);
    expect(await billNumberTables(v)).toEqual(before);
    await everyPartyBillNumbered();
  });

  it("a split refused after its number was taken gives no number: the next split takes the number it would have", async () => {
    const { partyId, tabId } = await seat(v, await v.table("N6"));
    await order(v, tabId, "Burger");
    await inTx(v, (tx) =>
      addTabRound(tx, v.cfg, tabId, [{ menuItemId: v.item("Flan"), quantity: "1", hold: true }]),
    );
    const before = await billNumberTables(v);

    const command = await commandFor(v, partyId);
    await expect(
      inTx(v, (tx) => splitBill(tx, v.cfg, tabId, [{ lineNo: 2 }], command)),
    ).rejects.toMatchObject({ code: "tab.split_held_line" });
    expect(await billNumberTables(v)).toEqual(before);

    const second = await split(v, partyId, tabId, [1]);
    expect(await numbersOf(v, partyId)).toEqual([
      [tabId, 1, null],
      [second, 2, null],
    ]);
    await everyPartyBillNumbered();
  });

  it("two splits prepared from the same read: the second is refused and adds no history row", async () => {
    const { partyId, tabId } = await seat(v, await v.table("N7"));
    await order(v, tabId, "Burger", "Agua");
    const command = await commandFor(v, partyId);
    const first = await inTx(v, (tx) => splitBill(tx, v.cfg, tabId, [{ lineNo: 1 }], command));

    await expect(
      inTx(v, (tx) => splitBill(tx, v.cfg, tabId, [{ lineNo: 2 }], command)),
    ).rejects.toMatchObject({ code: "party.out_of_date" });

    expect(await allocationsOf(v, partyId)).toEqual([
      [1, tabId],
      [2, first.billId],
    ]);
    await everyPartyBillNumbered();
  });
});
