import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { captureError } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { mergeBills, splitBill } from "./testing/bill-action-fixture.js";
import { closingEditsForTest, finishTable } from "./testing/party-close-fixture.js";
import {
  moveBill,
  type MoveBillOptions,
  type MoveBillResult,
  type MoveTarget,
} from "./testing/move-bill-fixture.js";
import { finishPartyService } from "./finish-party-service.js";
import { VENUE_SERVICE } from "./modules.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import {
  allocationsOf,
  billNumberTables,
  expectEveryPartyBillNumbered,
  numbersOf,
} from "./testing/bill-identities.js";
import {
  OPERATOR,
  activeTablesOf,
  billRow,
  commandFor,
  join,
  counterOrder,
  inTx,
  order,
  orderForParty,
  partyRow,
  partyAt,
  pay,
  revisionOf,
  seatWithNoAllergies as seat,
  setupPartyVenue,
  split,
  statusOf,
  type PartyVenue,
} from "./testing/party-venue.js";
import { splitDraft } from "./order-drafts.js";
import { saveDraftForTest } from "./testing/draft-command-fixture.js";
import { readBillEditState } from "./bill-editing.js";
import {
  joinTables,
  moveGuests,
  partyBillEditsForTest,
  splitTable,
} from "./testing/table-action-fixture.js";
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

async function moveTo(
  billId: string,
  to: MoveTarget,
  opts: Partial<MoveBillOptions> = {},
): Promise<MoveBillResult> {
  const own = (await billRow(v, billId)).partyId;
  const target = "tableId" in to ? await partyAt(v, to.tableId) : null;
  const options: MoveBillOptions = {
    bills: "separate",
    operatorId: OPERATOR,
    ...(own === null ? {} : { expectedPartyRevision: await revisionOf(v, own) }),
    ...(target === null || target === own
      ? {}
      : { otherPartyId: target, expectedOtherPartyRevision: await revisionOf(v, target) }),
    ...opts,
  };
  return inTx(v, (tx) => moveBill(tx, v.cfg, billId, to, options));
}

async function nameBill(billId: string, name: string): Promise<void> {
  await inTx(v, (tx) => VENUE_SERVICE.setBillName(tx, billId, name));
}

/** A seated table with Bills 1 to `count`, each holding one Agua. */
async function tableWithBills(label: string, count: number) {
  const seated = await seat(v, await v.table(label));
  await order(v, seated.tabId, ...Array.from({ length: count }, () => "Agua"));
  const bills = [seated.tabId];
  for (let line = 1; line < count; line++)
    bills.push(await split(v, seated.partyId, seated.tabId, [line]));
  return { ...seated, bills };
}

describe("A803 bill numbers: move bill", () => {
  it("a bill moved to a free table is Bill 1 there, and its old table never gives its number again", async () => {
    const from = await tableWithBills("M1", 2);
    const freeTable = await v.table("M1 free");

    const moved = await moveTo(from.bills[1]!, { tableId: freeTable });

    expect(await numbersOf(v, moved.partyId!)).toEqual([[from.bills[1], 1, null]]);
    expect(await numbersOf(v, from.partyId)).toEqual([[from.tabId, 1, null]]);
    const third = await split(v, from.partyId, from.tabId, [2]);
    expect(await numbersOf(v, from.partyId)).toEqual([
      [from.tabId, 1, null],
      [third, 3, null],
    ]);
    await everyPartyBillNumbered();
  });

  it("a bill moved to a table with Bills 1–4 is Bill 5 there and keeps its name", async () => {
    const from = await tableWithBills("M2", 2);
    const to = await tableWithBills("M2 to", 4);
    const toTable = (await activeTablesOf(v, to.partyId))[0]!;
    await nameBill(from.bills[1]!, "Clint");

    await moveTo(from.bills[1]!, { tableId: toTable });

    expect((await numbersOf(v, to.partyId)).at(-1)).toEqual([from.bills[1], 5, "Clint"]);
    await everyPartyBillNumbered();
  });

  it("a bill moved with Merge the bills takes no number there, so the next new bill there is Bill 2, and its old table still never gives its old number again", async () => {
    const from = await tableWithBills("M3", 2);
    const to = await seat(v, await v.table("M3 to"));
    await order(v, to.tabId, "Agua");
    const toTable = (await activeTablesOf(v, to.partyId))[0]!;

    const moved = await moveTo(from.bills[1]!, { tableId: toTable }, { bills: "merge" });

    expect(moved).toMatchObject({ merged: true, billId: to.tabId });
    expect(await allocationsOf(v, to.partyId)).toEqual([[1, to.tabId]]);
    const next = await split(v, to.partyId, to.tabId, [1]);
    expect(await numbersOf(v, to.partyId)).toEqual([
      [to.tabId, 1, null],
      [next, 2, null],
    ]);
    const third = await split(v, from.partyId, from.tabId, [2]);
    expect((await numbersOf(v, from.partyId)).at(-1)).toEqual([third, 3, null]);
    await everyPartyBillNumbered();
  });

  it("a counter order moved to a table takes that table's next number, with no name", async () => {
    const to = await tableWithBills("M4", 2);
    const toTable = (await activeTablesOf(v, to.partyId))[0]!;
    const orderId = await counterOrder(v, "Tarta");

    await moveTo(orderId, { tableId: toTable }, { partyId: null });

    expect((await numbersOf(v, to.partyId)).at(-1)).toEqual([orderId, 3, null]);
    await everyPartyBillNumbered();
  });

  it("a bill moved to the counter loses its number, keeps its name, and coming back to a table takes that table's next number with its name", async () => {
    const from = await tableWithBills("M5", 2);
    const back = await tableWithBills("M5 back", 3);
    const backTable = (await activeTablesOf(v, back.partyId))[0]!;
    const leaving = from.bills[1]!;
    await nameBill(leaving, "Clint");

    await moveTo(leaving, { counter: { zoneId: null } }, { partyId: from.partyId });

    expect(await numbersOf(v, from.partyId)).toEqual([[from.tabId, 1, null]]);
    expect(await inTx(v, (tx) => VENUE_SERVICE.readBillIdentities(tx, [leaving]))).toEqual(
      new Map([[leaving, { number: null, name: "Clint" }]]),
    );
    expect(await allocationsOf(v, from.partyId)).toEqual([
      [1, from.tabId],
      [2, leaving],
    ]);

    await moveTo(leaving, { tableId: backTable }, { partyId: null });

    expect((await numbersOf(v, back.partyId)).at(-1)).toEqual([leaving, 4, "Clint"]);
    await everyPartyBillNumbered();
  });

  it("a paid bill left for collection when its table finishes loses its number and keeps its name", async () => {
    const { partyId, tabId } = await seat(v, await v.table("M6"));
    await order(v, tabId, "Burger");
    await pay(v, tabId, "12.00");
    await nameBill(tabId, "Clint");
    const finishBody = async () => {
      const expectedEdits = await inTx(v, (tx) => closingEditsForTest(tx, partyId));
      return {
        partyId,
        operatorId: OPERATOR,
        expectedPartyRevision: await revisionOf(v, partyId),
        expectedEdits,
        submissionId: randomUUID(),
      };
    };
    const asked = await finishBody();
    const refusal = await captureError(() => inTx(v, (tx) => finishPartyService(tx, v.cfg, asked)));
    expect(refusal).toMatchObject({ code: "party.unserved_dishes" });
    const { dishes } = (refusal as AppError).params as unknown as {
      dishes: { billId: string; billRevision: number }[];
    };
    const collecting = await finishBody();

    await inTx(v, (tx) =>
      finishPartyService(tx, v.cfg, {
        ...collecting,
        collect: {
          bills: [{ billId: tabId, expectedBillRevision: dishes[0]!.billRevision }],
        },
      }),
    );

    expect((await billRow(v, tabId)).partyId).toBeNull();
    expect(await inTx(v, (tx) => VENUE_SERVICE.readBillIdentities(tx, [tabId]))).toEqual(
      new Map([[tabId, { number: null, name: "Clint" }]]),
    );
    expect(await allocationsOf(v, partyId)).toEqual([[1, tabId]]);
    await everyPartyBillNumbered();
  });

  it("a replayed move (same submissionId, the allergy path) numbers the bill once", async () => {
    const to = await tableWithBills("M7", 1);
    const toTable = (await activeTablesOf(v, to.partyId))[0]!;
    const orderId = await counterOrder(v, "Tarta");
    const ask = {
      partyId: null,
      submissionId: randomUUID(),
      allergy: { party: { answer: "none" as const, guests: [] }, ticks: [] },
    };

    const options: MoveBillOptions = {
      bills: "separate",
      operatorId: OPERATOR,
      otherPartyId: to.partyId,
      expectedOtherPartyRevision: await revisionOf(v, to.partyId),
      expectedEdits: await inTx(v, async (tx) => [
        ...(await partyBillEditsForTest(tx, [to.partyId])),
        await readBillEditState(tx, orderId),
      ]),
      ...ask,
    };
    options.expectedEdits!.sort((a, b) => a.billId.localeCompare(b.billId));
    const send = () => inTx(v, (tx) => moveBill(tx, v.cfg, orderId, { tableId: toTable }, options));

    const first = await send();
    const again = await send();

    expect(again).toEqual(first);
    expect(await allocationsOf(v, to.partyId)).toEqual([
      [1, to.tabId],
      [2, orderId],
    ]);
    await everyPartyBillNumbered();
  });

  it("a move refused for a stale revision changes no number or allocation row", async () => {
    const from = await tableWithBills("M8", 2);
    const freeTable = await v.table("M8 free");
    const before = await billNumberTables(v);
    const stale = (await revisionOf(v, from.partyId)) - 1;

    await expect(
      moveTo(from.bills[1]!, { tableId: freeTable }, { expectedPartyRevision: stale }),
    ).rejects.toMatchObject({ code: "party.out_of_date" });

    expect(await billNumberTables(v)).toEqual(before);
    await everyPartyBillNumbered();
  });
});

async function tableOptions(
  partyId: string,
  other?: string,
  bills: "merge" | "separate" = "separate",
) {
  return {
    bills,
    expectedPartyRevision: await revisionOf(v, partyId),
    ...(other === undefined
      ? {}
      : { otherPartyId: other, expectedOtherPartyRevision: await revisionOf(v, other) }),
    operatorId: OPERATOR,
  };
}

describe("A803 bill numbers: tables", () => {
  it("splitting off the table first seated keeps every staying bill's number and party, and the leaving bill is Bill 1 at its own table", async () => {
    const t1 = await v.table("S1 a");
    const t2 = await v.table("S1 b");
    const { partyId, tabId } = await seat(v, t1);
    await join(v, partyId, t2);
    await order(v, tabId, "Agua", "Flan", "Caña");
    const second = await split(v, partyId, tabId, [1]);
    const third = await split(v, partyId, tabId, [2]);
    const command = await commandFor(v, partyId);

    const leaving = await inTx(v, (tx) => splitTable(tx, v.cfg, partyId, t1, third, command));

    expect(await numbersOf(v, partyId)).toEqual([
      [tabId, 1, null],
      [second, 2, null],
    ]);
    expect(await numbersOf(v, leaving.partyId)).toEqual([[third, 1, null]]);
    expect((await billRow(v, second)).partyId).toBe(partyId);
    await everyPartyBillNumbered();
  });

  it("splitting a table without a bill gives the leaving table Bill 1 and leaves the staying bills as they were", async () => {
    const t1 = await v.table("S2 a");
    const t2 = await v.table("S2 b");
    const { partyId, tabId } = await seat(v, t1);
    await join(v, partyId, t2);
    await order(v, tabId, "Agua", "Flan");
    const second = await split(v, partyId, tabId, [1]);
    const before = await numbersOf(v, partyId);
    const command = await commandFor(v, partyId);

    const leaving = await inTx(v, (tx) => splitTable(tx, v.cfg, partyId, t2, null, command));

    expect(await numbersOf(v, partyId)).toEqual(before);
    expect(before).toEqual([
      [tabId, 1, null],
      [second, 2, null],
    ]);
    expect(await numbersOf(v, leaving.partyId)).toEqual([[leaving.mainBillId, 1, null]]);
    await everyPartyBillNumbered();
  });

  it("joining a seated table gives its bills our next numbers in their own number order, names kept", async () => {
    const ours = await tableWithBills("S3 ours", 4);
    const theirs = await tableWithBills("S3 theirs", 2);
    const theirTable = (await activeTablesOf(v, theirs.partyId))[0]!;
    await nameBill(theirs.bills[0]!, "Clint");
    const options = await tableOptions(ours.partyId, theirs.partyId);

    await inTx(v, (tx) => joinTables(tx, v.cfg, ours.partyId, theirTable, options));

    expect((await numbersOf(v, ours.partyId)).slice(4)).toEqual([
      [theirs.bills[0], 5, "Clint"],
      [theirs.bills[1], 6, null],
    ]);
    expect(await numbersOf(v, theirs.partyId)).toEqual([]);
    await everyPartyBillNumbered();
  });

  it("moving guests onto a seated table gives our bills that table's next numbers, including a paid bill that stays on our closed party", async () => {
    const ana = await seat(v, await v.table("S4 ana"));
    const luisTable = await v.table("S4 luis");
    const luis = await seat(v, luisTable);
    await order(v, ana.tabId, "Burger", "Vino");
    await order(v, luis.tabId, "Agua");
    const second = await split(v, ana.partyId, ana.tabId, [2]);
    await pay(v, ana.tabId, "12.00");
    const options = await tableOptions(ana.partyId, luis.partyId);

    await inTx(v, (tx) => moveGuests(tx, v.cfg, ana.partyId, luisTable, options));

    expect(await billRow(v, ana.tabId)).toMatchObject({ status: "settled", partyId: ana.partyId });
    expect(await numbersOf(v, luis.partyId)).toEqual([
      [luis.tabId, 1, null],
      [ana.tabId, 2, null],
      [second, 3, null],
    ]);
    await everyPartyBillNumbered();
  });

  it("an abandoned bill of the party that closes keeps its row and takes no number", async () => {
    const ours = await tableWithBills("S5 ours", 1);
    const theirs = await tableWithBills("S5 theirs", 3);
    const theirTable = (await activeTablesOf(v, theirs.partyId))[0]!;
    const merge = await commandFor(v, theirs.partyId);
    await inTx(v, (tx) => mergeBills(tx, v.cfg, theirs.bills[0]!, theirs.bills[1]!, merge));
    const options = await tableOptions(ours.partyId, theirs.partyId);

    await inTx(v, (tx) => joinTables(tx, v.cfg, ours.partyId, theirTable, options));

    expect(await statusOf(v, theirs.bills[1]!)).toBe("abandoned");
    expect(await numbersOf(v, theirs.partyId)).toEqual([[theirs.bills[1], 2, null]]);
    expect(await numbersOf(v, ours.partyId)).toEqual([
      [ours.tabId, 1, null],
      [theirs.bills[0], 2, null],
      [theirs.bills[2], 3, null],
    ]);
    await everyPartyBillNumbered();
  });

  it("joining with Merge the bills: the incoming main bill merges and takes no number, and the other incoming bills take the next numbers with no gap", async () => {
    const ours = await seat(v, await v.table("S6 ours"));
    await order(v, ours.tabId, "Agua");
    const theirs = await tableWithBills("S6 theirs", 2);
    const theirTable = (await activeTablesOf(v, theirs.partyId))[0]!;
    const options = await tableOptions(ours.partyId, theirs.partyId, "merge");

    const result = await inTx(v, (tx) => joinTables(tx, v.cfg, ours.partyId, theirTable, options));

    expect(result.merged).toBe(true);
    expect(await statusOf(v, theirs.tabId)).toBe("abandoned");
    expect(await numbersOf(v, ours.partyId)).toEqual([
      [ours.tabId, 1, null],
      [theirs.bills[1], 2, null],
    ]);
    await everyPartyBillNumbered();
  });

  it("joining or moving guests with a free table changes no number", async () => {
    const ours = await tableWithBills("S7", 2);
    const joined = await v.table("S7 joined");
    const moveTo = await v.table("S7 moved");
    const before = await billNumberTables(v);

    await join(v, ours.partyId, joined);
    const options = await tableOptions(ours.partyId);
    await inTx(v, (tx) => moveGuests(tx, v.cfg, ours.partyId, moveTo, options));

    expect(await billNumberTables(v)).toEqual(before);
    await everyPartyBillNumbered();
  });

  it("after a join the surviving party's bills that are not abandoned hold no number twice", async () => {
    const ours = await tableWithBills("S8 ours", 2);
    const theirs = await tableWithBills("S8 theirs", 2);
    const theirTable = (await activeTablesOf(v, theirs.partyId))[0]!;
    const options = await tableOptions(ours.partyId, theirs.partyId);

    await inTx(v, (tx) => joinTables(tx, v.cfg, ours.partyId, theirTable, options));

    const numbers = (await numbersOf(v, ours.partyId)).map(([, number]) => number);
    expect(numbers).toEqual([1, 2, 3, 4]);
    await everyPartyBillNumbered();
  });
});
