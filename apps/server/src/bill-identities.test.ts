import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { billEditStates, captureError, parties, workingOrders } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { billIdentities } from "@waitron/venue-service";
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
  numberBill,
  numbersOf,
} from "./testing/bill-identities.js";
import {
  OPERATOR,
  activeTablesOf,
  billRow,
  commandFor,
  join,
  counterOrder,
  nameParty,
  inTx,
  order,
  orderForParty,
  openingBillOfParty,
  partyRow,
  partyAt,
  pay,
  placeByHand,
  revisionOf,
  seatWithNoAllergies as seat,
  setupPartyVenue,
  split,
  statusOf,
  type PartyVenue,
} from "./testing/party-venue.js";
import { readUnsentDrafts, splitDraft } from "./order-drafts.js";
import { readBillsOfParties, readPartyBills } from "./parties.js";
import { saveDraftForTest } from "./testing/draft-command-fixture.js";
import { readBillEditState } from "./bill-editing.js";
import { setBillName } from "./bill-identities.js";
import { listHeldOrders } from "./working-order.js";
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

  it("a bill made for a party whose bills are all paid takes the next number, not Bill 1 again", async () => {
    const { partyId, tabId } = await seat(v, await v.table("N4"));
    await order(v, tabId, "Burger");
    await pay(v, tabId, "12.00");
    expect(await openingBillOfParty(v, partyId)).toBe(tabId);

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

  it("a bill moved to another party's table still arrives as its own bill with the next number, so the next new bill there is Bill 3, and its old table still never gives its old number again", async () => {
    const from = await tableWithBills("M3", 2);
    const to = await seat(v, await v.table("M3 to"));
    await order(v, to.tabId, "Agua");
    const toTable = (await activeTablesOf(v, to.partyId))[0]!;

    const moved = await moveTo(from.bills[1]!, { tableId: toTable });

    expect(moved).toEqual({ partyId: to.partyId, billId: from.bills[1] });
    expect(await allocationsOf(v, to.partyId)).toEqual([
      [1, to.tabId],
      [2, from.bills[1]],
    ]);
    const next = await split(v, to.partyId, to.tabId, [1]);
    expect(await numbersOf(v, to.partyId)).toEqual([
      [to.tabId, 1, null],
      [from.bills[1], 2, null],
      [next, 3, null],
    ]);
    const third = await split(v, from.partyId, from.tabId, [2]);
    expect((await numbersOf(v, from.partyId)).at(-1)).toEqual([third, 3, null]);
    await everyPartyBillNumbered();
  });

  it("a bill moved to a table whose main bill is presented stays separate and takes that table's next number", async () => {
    const from = await tableWithBills("M3b", 2);
    const to = await seat(v, await v.table("M3b to"));
    await order(v, to.tabId, "Agua");
    await placeByHand(v, to.tabId);
    const toTable = (await activeTablesOf(v, to.partyId))[0]!;

    const moved = await moveTo(from.bills[1]!, { tableId: toTable });

    expect(moved).toEqual({ partyId: to.partyId, billId: from.bills[1] });
    expect(await numbersOf(v, to.partyId)).toEqual([
      [to.tabId, 1, null],
      [from.bills[1], 2, null],
    ]);
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
      new Map([[leaving, { partyId: null, number: null, name: "Clint" }]]),
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
      new Map([[tabId, { partyId: null, number: null, name: "Clint" }]]),
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

async function tableOptions(partyId: string, other?: string) {
  return {
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
    expect(await numbersOf(v, leaving.partyId)).toEqual([[leaving.billId, 1, null]]);
    await everyPartyBillNumbered();
  });

  it("joining a seated table gives its bills our next numbers in their own number order, names kept", async () => {
    const ours = await tableWithBills("S3 ours", 4);
    // Four bills, so an order by bill id rather than by number shows here nearly every run.
    const theirs = await tableWithBills("S3 theirs", 4);
    const theirTable = (await activeTablesOf(v, theirs.partyId))[0]!;
    await nameBill(theirs.bills[0]!, "Clint");
    const options = await tableOptions(ours.partyId, theirs.partyId);

    await inTx(v, (tx) => joinTables(tx, v.cfg, ours.partyId, theirTable, options));

    expect((await numbersOf(v, ours.partyId)).slice(4)).toEqual([
      [theirs.bills[0], 5, "Clint"],
      [theirs.bills[1], 6, null],
      [theirs.bills[2], 7, null],
      [theirs.bills[3], 8, null],
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

  it("joining another party: no bill merges, and every incoming bill takes the next numbers with no gap", async () => {
    const ours = await seat(v, await v.table("S6 ours"));
    await order(v, ours.tabId, "Agua");
    const theirs = await tableWithBills("S6 theirs", 2);
    const theirTable = (await activeTablesOf(v, theirs.partyId))[0]!;
    const options = await tableOptions(ours.partyId, theirs.partyId);

    const result = await inTx(v, (tx) => joinTables(tx, v.cfg, ours.partyId, theirTable, options));

    expect(result).toEqual({
      partyId: ours.partyId,
      billIds: [ours.tabId, theirs.bills[0], theirs.bills[1]],
    });
    expect(await statusOf(v, theirs.tabId)).toBe("open");
    expect(await numbersOf(v, ours.partyId)).toEqual([
      [ours.tabId, 1, null],
      [theirs.bills[0], 2, null],
      [theirs.bills[1], 3, null],
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

  it("splitting off a table with a presented bill makes it Bill 1 there, and the staying party never gives its number again", async () => {
    const t1 = await v.table("S9 a");
    const t2 = await v.table("S9 b");
    const { partyId, tabId } = await seat(v, t1);
    await join(v, partyId, t2);
    await order(v, tabId, "Agua", "Flan", "Caña");
    const second = await split(v, partyId, tabId, [1]);
    const third = await split(v, partyId, tabId, [2]);
    await placeByHand(v, third);
    const command = await commandFor(v, partyId);

    const leaving = await inTx(v, (tx) => splitTable(tx, v.cfg, partyId, t1, third, command));

    expect(leaving).toEqual({ partyId: leaving.partyId, billId: third });
    expect(await numbersOf(v, leaving.partyId)).toEqual([[third, 1, null]]);
    expect(await numbersOf(v, partyId)).toEqual([
      [tabId, 1, null],
      [second, 2, null],
    ]);
    expect(await allocationsOf(v, partyId)).toEqual([
      [1, tabId],
      [2, second],
      [3, third],
    ]);
    await everyPartyBillNumbered();
  });

  it("a paid bill left on a party merged twice is numbered in the last party that shows it", async () => {
    const aTable = await v.table("S10 a");
    const bTable = await v.table("S10 b");
    const cTable = await v.table("S10 c");
    const a = await seat(v, aTable);
    const b = await seat(v, bTable);
    const c = await seat(v, cTable);
    await order(v, a.tabId, "Burger", "Vino");
    await order(v, b.tabId, "Agua");
    await order(v, c.tabId, "Agua");
    const open = await split(v, a.partyId, a.tabId, [2]);
    await pay(v, a.tabId, "12.00");
    const ontoB = await tableOptions(a.partyId, b.partyId);
    await inTx(v, (tx) => moveGuests(tx, v.cfg, a.partyId, bTable, ontoB));
    const ontoC = await tableOptions(b.partyId, c.partyId);

    await inTx(v, (tx) => moveGuests(tx, v.cfg, b.partyId, cTable, ontoC));

    expect((await billRow(v, a.tabId)).partyId).toBe(a.partyId);
    expect(await numbersOf(v, c.partyId)).toEqual([
      [c.tabId, 1, null],
      [b.tabId, 2, null],
      [a.tabId, 3, null],
      [open, 4, null],
    ]);
    expect(await numbersOf(v, b.partyId)).toEqual([]);
    expect(await numbersOf(v, a.partyId)).toEqual([]);
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

/** Saves the dishes as `OPERATOR`'s unsent order on the bill. */
async function saveUnsent(partyId: string, billId: string, ...names: string[]): Promise<void> {
  await inTx(v, (tx) =>
    saveDraftForTest(tx, v.cfg, partyId, OPERATOR, {
      billId,
      draftId: null,
      revision: 0,
      lines: names.map((name, index) => ({
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
}

/** The party's bills as its list reads them, as `[billId, billNumber, billName, status]`. */
async function listOf(partyId: string): Promise<[string, number | null, string | null, string][]> {
  const bills = await inTx(v, (tx) => readPartyBills(tx, partyId));
  return bills.map((bill) => [bill.workingOrderId, bill.billNumber, bill.billName, bill.status]);
}

/** The floor's unsent orders of the party, as `[billId, billNumber]`, in the order it lists them. */
async function unsentOf(partyId: string): Promise<[string, number | null][]> {
  const unsent = await inTx(v, async (tx) =>
    readUnsentDrafts(tx, [partyId], await readBillsOfParties(tx, [partyId])),
  );
  return unsent.get(partyId)!.map((draft) => [draft.billId, draft.billNumber]);
}

describe("A803 bill list", () => {
  it("the bill list carries each bill's stored number and name", async () => {
    const seated = await tableWithBills("L1", 3);
    await nameBill(seated.bills[1]!, "Clint");

    expect(await listOf(seated.partyId)).toEqual([
      [seated.bills[0], 1, null, "open"],
      [seated.bills[1], 2, "Clint", "open"],
      [seated.bills[2], 3, null, "open"],
    ]);
    const family = await inTx(v, (tx) => readBillsOfParties(tx, [seated.partyId]));
    expect(family.get(seated.partyId)!.map((bill) => [bill.billNumber, bill.billName])).toEqual([
      [1, null],
      [2, "Clint"],
      [3, null],
    ]);
  });

  it("after Bill 2 merges away the list shows Bill 1 and Bill 3, and the floor's unsent order on Bill 3 says Bill 3", async () => {
    const seated = await tableWithBills("L2", 3);
    const command = await commandFor(v, seated.partyId);
    await inTx(v, (tx) => mergeBills(tx, v.cfg, seated.bills[0]!, seated.bills[1]!, command));
    await saveUnsent(seated.partyId, seated.bills[2]!, "Flan");

    expect(await unsentOf(seated.partyId)).toEqual([[seated.bills[2], 3]]);
    expect(
      (await listOf(seated.partyId)).filter(([, , , status]) => status !== "abandoned"),
    ).toEqual([
      [seated.bills[0], 1, null, "open"],
      [seated.bills[2], 3, null, "open"],
    ]);
  });

  it("a bill that arrived shows its new number and is listed after the party's own Bill 1", async () => {
    const ana = await seat(v, await v.table("L3 ana"));
    await order(v, ana.tabId, "Agua", "Flan");
    const anaSecond = await split(v, ana.partyId, ana.tabId, [1]);
    const luis = await seat(v, await v.table("L3 luis"));
    await order(v, luis.tabId, "Agua");
    const luisTable = (await activeTablesOf(v, luis.partyId))[0]!;

    await moveTo(anaSecond, { tableId: luisTable });

    expect(await listOf(luis.partyId)).toEqual([
      [luis.tabId, 1, null, "open"],
      [anaSecond, 2, null, "open"],
    ]);
  });

  it("the floor lists unsent orders in number order", async () => {
    const ana = await seat(v, await v.table("L4 ana"));
    await order(v, ana.tabId, "Agua", "Flan");
    const anaSecond = await split(v, ana.partyId, ana.tabId, [1]);
    const luis = await seat(v, await v.table("L4 luis"));
    await order(v, luis.tabId, "Agua");
    const luisTable = (await activeTablesOf(v, luis.partyId))[0]!;
    await moveTo(anaSecond, { tableId: luisTable });
    await saveUnsent(luis.partyId, anaSecond, "Burger");
    await saveUnsent(luis.partyId, luis.tabId, "Vino");

    expect(await unsentOf(luis.partyId)).toEqual([
      [luis.tabId, 1],
      [anaSecond, 2],
    ]);
  });

  it("after a join, the bills of the survivor's list that are not abandoned hold no number twice", async () => {
    const ours = await tableWithBills("L5 ours", 2);
    const theirs = await tableWithBills("L5 theirs", 3);
    const theirTable = (await activeTablesOf(v, theirs.partyId))[0]!;
    const options = await tableOptions(ours.partyId, theirs.partyId);

    await inTx(v, (tx) => joinTables(tx, v.cfg, ours.partyId, theirTable, options));

    const list = await listOf(ours.partyId);
    expect(list.filter(([, , , status]) => status === "abandoned")).toEqual([]);
    const numbers = list
      .filter(([, , , status]) => status !== "abandoned")
      .map(([, number]) => number);
    expect([...numbers].sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5]);
  });

  it("an abandoned bill is listed with billNumber null, and a counter order moved to the table is listed with the next number", async () => {
    const seated = await tableWithBills("L6", 2);
    const command = await commandFor(v, seated.partyId);
    await inTx(v, (tx) => mergeBills(tx, v.cfg, seated.bills[0]!, seated.bills[1]!, command));
    const counter = await counterOrder(v, "Burger");
    const table = (await activeTablesOf(v, seated.partyId))[0]!;
    await moveTo(counter, { tableId: table });
    expect((await billNumberTables(v)).identities.map((row) => row.workingOrderId)).toContain(
      counter,
    );

    expect(await listOf(seated.partyId)).toEqual([
      [seated.bills[0], 1, null, "open"],
      [counter, 3, null, "open"],
      [seated.bills[1], null, null, "abandoned"],
    ]);
  });

  it("A803 bill order: two abandoned bills are listed last, in id order, not in the order they were opened", async () => {
    const seated = await tableWithBills("L6b", 3);
    const [lowerId, higherId] = [seated.bills[1]!, seated.bills[2]!].sort();
    await inTx(v, async (tx) => {
      await tx
        .update(workingOrders)
        .set({ openedAt: "2026-01-01T00:00:01.000Z" })
        .where(eq(workingOrders.id, lowerId!));
      await tx
        .update(workingOrders)
        .set({ openedAt: "2026-01-01T00:00:00.000Z" })
        .where(eq(workingOrders.id, higherId!));
    });
    const first = await commandFor(v, seated.partyId);
    await inTx(v, (tx) => mergeBills(tx, v.cfg, seated.bills[0]!, seated.bills[1]!, first));
    const second = await commandFor(v, seated.partyId);
    await inTx(v, (tx) => mergeBills(tx, v.cfg, seated.bills[0]!, seated.bills[2]!, second));
    const opened = await inTx(v, (tx) =>
      tx
        .select({ id: workingOrders.id })
        .from(workingOrders)
        .where(inArray(workingOrders.id, [lowerId!, higherId!]))
        .orderBy(asc(workingOrders.openedAt)),
    );
    expect(opened.map((row) => row.id)).toEqual([higherId, lowerId]);

    expect(await listOf(seated.partyId)).toEqual([
      [seated.bills[0], 1, null, "open"],
      [lowerId, null, null, "abandoned"],
      [higherId, null, null, "abandoned"],
    ]);
  });

  it("a bill at a table stored with no row is listed with no number and logged as a fault in Waitron, naming the bill", async () => {
    const seated = await tableWithBills("L7", 2);
    await inTx(v, (tx) =>
      tx.delete(billIdentities).where(eq(billIdentities.workingOrderId, seated.bills[1]!)),
    );
    const logged: unknown[][] = [];

    try {
      const bills = await inTx(v, (tx) =>
        readPartyBills(tx, seated.partyId, (...line) => logged.push(line)),
      );
      expect(bills.map((bill) => [bill.workingOrderId, bill.billNumber])).toEqual([
        [seated.bills[0], 1],
        [seated.bills[1], null],
      ]);
      expect(logged).toEqual([
        ["error", "bill.number_missing", { billId: seated.bills[1], partyId: seated.partyId }],
      ]);
    } finally {
      await inTx(v, (tx) => numberBill(tx, seated.bills[1]!, seated.partyId));
    }
  });

  it("a bill at a table whose row has a null number is listed with no number and logged, and the floor's unsent order on it comes last with no number", async () => {
    const seated = await tableWithBills("L8", 3);
    await saveUnsent(seated.partyId, seated.bills[0]!, "Flan");
    await saveUnsent(seated.partyId, seated.bills[1]!, "Flan");
    await saveUnsent(seated.partyId, seated.bills[2]!, "Flan");
    await inTx(v, (tx) => VENUE_SERVICE.releaseBillNumber(tx, seated.bills[0]!));
    const logged: unknown[][] = [];

    try {
      const unsent = await inTx(v, async (tx) =>
        readUnsentDrafts(
          tx,
          [seated.partyId],
          await readBillsOfParties(tx, [seated.partyId], (...line) => logged.push(line)),
        ),
      );
      expect(unsent.get(seated.partyId)!.map((draft) => [draft.billId, draft.billNumber])).toEqual([
        [seated.bills[1], 2],
        [seated.bills[2], 3],
        [seated.bills[0], null],
      ]);
      expect(logged).toEqual([
        ["error", "bill.number_missing", { billId: seated.bills[0], partyId: seated.partyId }],
      ]);
    } finally {
      await inTx(v, (tx) => numberBill(tx, seated.bills[0]!, seated.partyId));
    }
  });

  it("a paid bill whose row has a null number is listed with no number and logged", async () => {
    const seated = await seat(v, await v.table("L9"));
    await order(v, seated.tabId, "Burger", "Agua");
    const paid = await split(v, seated.partyId, seated.tabId, [2]);
    await pay(v, paid, "2.00");
    expect(await statusOf(v, paid)).toBe("settled");
    await inTx(v, (tx) => VENUE_SERVICE.releaseBillNumber(tx, paid));
    const logged: unknown[][] = [];

    try {
      const bills = await inTx(v, (tx) =>
        readPartyBills(tx, seated.partyId, (...line) => logged.push(line)),
      );
      expect(bills.find((bill) => bill.workingOrderId === paid)!.billNumber).toBeNull();
      expect(logged).toEqual([
        ["error", "bill.number_missing", { billId: paid, partyId: seated.partyId }],
      ]);
    } finally {
      await inTx(v, (tx) => numberBill(tx, paid, seated.partyId));
    }
  });

  it("an abandoned bill with no number is not logged", async () => {
    const seated = await tableWithBills("L10", 2);
    const command = await commandFor(v, seated.partyId);
    await inTx(v, (tx) => mergeBills(tx, v.cfg, seated.bills[0]!, seated.bills[1]!, command));
    await inTx(v, (tx) => VENUE_SERVICE.releaseBillNumber(tx, seated.bills[1]!));
    const logged: unknown[][] = [];

    await inTx(v, (tx) => readPartyBills(tx, seated.partyId, (...line) => logged.push(line)));

    expect(logged).toEqual([]);
  });
});

describe("A803 rename", () => {
  /** Every row a rename could touch, for a before-and-after comparison. */
  async function renameRows() {
    const numbers = await billNumberTables(v);
    return inTx(v, async (tx) => ({
      numbers,
      bills: await tx.select().from(workingOrders).orderBy(asc(workingOrders.id)),
      parties: await tx.select().from(parties).orderBy(asc(parties.id)),
      edits: await tx.select().from(billEditStates).orderBy(asc(billEditStates.billId)),
    }));
  }

  async function rename(
    billId: string,
    name: unknown,
    partyId: string,
    sent: { expectedPartyRevision?: number } = {},
  ) {
    const expectedEdit = await inTx(v, (tx) => readBillEditState(tx, billId));
    const expectedPartyRevision = sent.expectedPartyRevision ?? (await revisionOf(v, partyId));
    return inTx(v, (tx) =>
      setBillName(tx, billId, name, {
        partyId,
        expectedPartyRevision,
        operatorId: OPERATOR,
        expectedEdit,
      }),
    );
  }

  async function refusedRename(run: () => Promise<unknown>, code: string, params?: object) {
    const before = await renameRows();
    const refusal = await captureError(run);
    expect(refusal).toMatchObject({ code, ...(params === undefined ? {} : { params }) });
    expect(await renameRows()).toEqual(before);
  }

  it("names a bill, trimmed, and the bill list shows it", async () => {
    const seated = await tableWithBills("R1", 2);
    const revision = await revisionOf(v, seated.partyId);

    const answer = await rename(seated.bills[1]!, "  Ana  ", seated.partyId);

    expect(answer).toEqual({ revision: revision + 1, billNumber: 2, billName: "Ana" });
    const bills = await inTx(v, (tx) => readPartyBills(tx, seated.partyId));
    expect(bills.map((bill) => [bill.billNumber, bill.billName])).toEqual([
      [1, null],
      [2, "Ana"],
    ]);
  });

  it.each([[""], ["   "], [null]])("the name %j clears it", async (cleared) => {
    const seated = await tableWithBills(`R2 ${randomUUID()}`, 1);
    await rename(seated.tabId, "Ana", seated.partyId);

    const answer = await rename(seated.tabId, cleared, seated.partyId);

    expect(answer.billName).toBeNull();
    expect(await numbersOf(v, seated.partyId)).toEqual([[seated.tabId, 1, null]]);
  });

  it("40 characters are kept and 41 are refused naming the field, with nothing changed", async () => {
    const seated = await tableWithBills("R3", 1);

    expect((await rename(seated.tabId, "a".repeat(40), seated.partyId)).billName).toBe(
      "a".repeat(40),
    );
    await refusedRename(
      () => rename(seated.tabId, "b".repeat(41), seated.partyId),
      "management.request_invalid",
      { field: "name" },
    );
  });

  it.each([[7], [{ name: "Ana" }]])("a name of %j is refused naming the field", async (name) => {
    const seated = await tableWithBills(`R4 ${randomUUID()}`, 1);

    await refusedRename(
      () => rename(seated.tabId, name, seated.partyId),
      "management.request_invalid",
      { field: "name" },
    );
  });

  it("a name like <b>Ana</b> is stored as typed", async () => {
    const seated = await tableWithBills("R5", 1);

    await rename(seated.tabId, "<b>Ana</b>", seated.partyId);

    expect(await numbersOf(v, seated.partyId)).toEqual([[seated.tabId, 1, "<b>Ana</b>"]]);
  });

  it("a stale party revision is party.out_of_date with nothing changed", async () => {
    const seated = await tableWithBills("R6", 1);
    const stale = (await revisionOf(v, seated.partyId)) - 1;

    await refusedRename(
      () => rename(seated.tabId, "Ana", seated.partyId, { expectedPartyRevision: stale }),
      "party.out_of_date",
      { partyId: seated.partyId },
    );
  });

  it("an abandoned bill is tab.not_open", async () => {
    const seated = await tableWithBills("R7", 2);
    const command = await commandFor(v, seated.partyId);
    await inTx(v, (tx) => mergeBills(tx, v.cfg, seated.bills[0]!, seated.bills[1]!, command));

    await refusedRename(() => rename(seated.bills[1]!, "Ana", seated.partyId), "tab.not_open", {
      tabId: seated.bills[1],
    });
  });

  it("a counter order is refused naming billId", async () => {
    const orderId = await counterOrder(v, "Burger");

    await refusedRename(
      () =>
        inTx(v, async (tx) =>
          setBillName(tx, orderId, "Ana", {
            operatorId: OPERATOR,
            expectedEdit: await readBillEditState(tx, orderId),
          }),
        ),
      "management.request_invalid",
      { field: "billId" },
    );
  });

  it("a paid bill may be renamed", async () => {
    const seated = await tableWithBills("R9", 2);
    await pay(v, seated.bills[1]!, "2.00");
    expect(await statusOf(v, seated.bills[1]!)).toBe("settled");

    const answer = await rename(seated.bills[1]!, "Ana", seated.partyId);

    expect(answer).toMatchObject({ billNumber: 2, billName: "Ana" });
  });

  it("a paid bill left on a party merged into this one is renamed with the surviving party's id and revision", async () => {
    const ana = await seat(v, await v.table("R10 ana"));
    const luisTable = await v.table("R10 luis");
    const luis = await seat(v, luisTable);
    await order(v, ana.tabId, "Burger", "Vino");
    await order(v, luis.tabId, "Agua");
    await split(v, ana.partyId, ana.tabId, [2]);
    await pay(v, ana.tabId, "12.00");
    const options = await tableOptions(ana.partyId, luis.partyId);
    await inTx(v, (tx) => moveGuests(tx, v.cfg, ana.partyId, luisTable, options));
    expect(await billRow(v, ana.tabId)).toMatchObject({ partyId: ana.partyId });
    await nameParty(v, luis.partyId, "Luis");
    await nameParty(v, luis.partyId, "Luis y Ana");
    const revision = await revisionOf(v, luis.partyId);
    expect(revision).not.toBe(await revisionOf(v, ana.partyId));

    const answer = await rename(ana.tabId, "Ana", luis.partyId);

    expect(answer).toEqual({ revision: revision + 1, billNumber: 2, billName: "Ana" });
    await refusedRename(() => rename(ana.tabId, "Otra", ana.partyId), "party.out_of_date", {
      partyId: ana.partyId,
    });
  });

  it("a bill of a finished table is party.not_open", async () => {
    const first = await seat(v, await v.table("R11"));
    await order(v, first.tabId, "Agua");
    await pay(v, first.tabId, "2.00");
    const command = await commandFor(v, first.partyId);
    await inTx(v, (tx) => finishTable(tx, { partyId: first.partyId, ...command }));
    expect(await partyRow(v, first.partyId)).toMatchObject({ state: "closed" });
    expect(await numbersOf(v, first.partyId)).toEqual([[first.tabId, 1, null]]);

    await refusedRename(() => rename(first.tabId, "Ana", first.partyId), "party.not_open", {
      partyId: first.partyId,
    });
  });

  it("renaming changes no bill, allocation or editor row, and moves only the party's revision", async () => {
    const seated = await tableWithBills("R12", 2);
    const before = await renameRows();

    await rename(seated.bills[1]!, "Ana", seated.partyId);

    const after = await renameRows();
    expect(after.bills).toEqual(before.bills);
    expect(after.edits).toEqual(before.edits);
    expect(after.numbers.allocations).toEqual(before.numbers.allocations);
    expect(after.parties).toEqual(
      before.parties.map((party) =>
        party.id === seated.partyId ? { ...party, revision: party.revision + 1 } : party,
      ),
    );
  });

  it("a table bill with no number row fails as a fault in Waitron, with nothing changed", async () => {
    const seated = await tableWithBills("R13", 1);
    const [row] = await inTx(v, (tx) =>
      tx.select().from(billIdentities).where(eq(billIdentities.workingOrderId, seated.tabId)),
    );
    await inTx(v, (tx) =>
      tx.delete(billIdentities).where(eq(billIdentities.workingOrderId, seated.tabId)),
    );

    try {
      const before = await renameRows();
      const failure = await captureError(() => rename(seated.tabId, "Ana", seated.partyId));
      expect(failure).not.toBeInstanceOf(AppError);
      expect((failure as Error).message).toContain(seated.tabId);
      expect(await renameRows()).toEqual(before);
    } finally {
      await inTx(v, (tx) => tx.insert(billIdentities).values(row!));
    }
  });
});

describe("A803 parked orders list", () => {
  it("lists a table bill with its stored number and name, and a counter order with neither", async () => {
    const seated = await tableWithBills("P1", 3);
    const command = await commandFor(v, seated.partyId);
    await inTx(v, (tx) => mergeBills(tx, v.cfg, seated.bills[0]!, seated.bills[1]!, command));
    const sam = seated.bills[2]!;
    const expectedPartyRevision = await revisionOf(v, seated.partyId);
    await inTx(v, async (tx) =>
      setBillName(tx, sam, "Sam", {
        partyId: seated.partyId,
        expectedPartyRevision,
        operatorId: OPERATOR,
        expectedEdit: await readBillEditState(tx, sam),
      }),
    );
    const counter = await counterOrder(v, "Burger");
    const leaving = await tableWithBills("P2", 2);
    await nameBill(leaving.bills[1]!, "Clint");
    await moveTo(leaving.bills[1]!, { counter: { zoneId: null } }, { partyId: leaving.partyId });

    const parked = new Map(
      (await listHeldOrders({ db: v.db }, v.cfg)).map((order) => [
        order.id,
        [order.billNumber, order.billName],
      ]),
    );

    expect([seated.bills[0], sam, counter, leaving.bills[1]].map((id) => parked.get(id!))).toEqual([
      [1, null],
      [3, "Sam"],
      [null, null],
      [null, null],
    ]);
  });
});
