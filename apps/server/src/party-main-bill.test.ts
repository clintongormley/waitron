import { abandonHeldOrder } from "./testing/order-writer-fixture.js";
import { expectedDraftEditForTest } from "./testing/draft-command-fixture.js";
import { saveDraftForTest as saveDraft } from "./testing/draft-command-fixture.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { captureError, saleLines, sales, workingOrders } from "@waitron/db";
import { setNeedsClearingInEveryDepartment } from "./testing/needs-clearing.js";
import { listTablesWithState } from "./working-order.js";

import { placeGroups, submitGroups } from "./testing/group-submit-fixture.js";
import {
  finishTable,
  partyZone,
  readPartyBills,
  setPartyName,
} from "./testing/party-close-fixture.js";
import { readDrafts, submitDraft } from "./order-drafts.js";
import { createPartyBill, insertPartyBill } from "./parties.js";
import { moveBill } from "./testing/move-bill-fixture.js";
import { numbersOf } from "./testing/bill-identities.js";
import {
  OPERATOR,
  activeTablesOf,
  billRow,
  billsOfParty,
  floorRow,
  inTx,
  linesOf,
  order,
  orderForParty,
  partyRow,
  pay,
  placeByHand,
  revisionOf,
  seat,
  setupPartyVenue,
  split,
  type PartyVenue,
} from "./testing/party-venue.js";
import "./errors.js";
import { cancelLine } from "./testing/cancel-line.js";

// `resetPerTest: false`: the venue is provisioned once in `setup`, and a per-test reset would empty
// every table it wrote (`packages/db/src/testing/venue-db.ts`, `applyReset`). Each case seats its own
// tables, and the one case that changes a venue setting puts it back.
let v: PartyVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

async function soldLinesOf(billId: string) {
  return inTx(v, (tx) =>
    tx
      .select({ line: saleLines })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(eq(sales.workingOrderId, billId))
      .orderBy(saleLines.lineNo),
  );
}

async function abandon(billId: string): Promise<void> {
  await inTx(v, (tx) =>
    tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, billId)),
  );
}

describe("the bill a table opens on", () => {
  it("is the tab seating opens, and a round with no bill named lands on it", async () => {
    const table4 = await v.table("Mesa 4");
    const { partyId, tabId } = await seat(v, table4);
    expect((await floorRow(v, table4)).party!.openingBillId).toBe(tabId);

    const { tabId: landed } = await orderForParty(v, partyId, ["Burger"]);

    expect(landed).toBe(tabId);
    expect((await linesOf(v, tabId)).map((line) => line.name)).toEqual(["Burger"]);
  });

  it("stays the paid bill once it is paid, and moves to the new, empty bill the next order starts on the party", async () => {
    const table4 = await v.table("Mesa 4b");
    const { partyId, tabId } = await seat(v, table4);
    await order(v, tabId, "Burger");
    await pay(v, tabId, "12.00");
    const saleBefore = await soldLinesOf(tabId);

    expect((await floorRow(v, table4)).party!.openingBillId).toBe(tabId);

    const { tabId: dessert } = await orderForParty(v, partyId, ["Flan"]);

    expect(dessert).not.toBe(tabId);
    expect((await floorRow(v, table4)).party!.openingBillId).toBe(dessert);
    expect((await billRow(v, dessert)).partyId).toBe(partyId);
    expect((await linesOf(v, dessert)).map((line) => line.name)).toEqual(["Flan"]);
    expect(await billsOfParty(v, partyId)).toEqual([tabId, dessert]);
    expect(await soldLinesOf(tabId)).toEqual(saleBefore);
  });

  it("stays the presented bill, still owing, when the next order starts a new one while the presented bill stays as it was", async () => {
    const table6 = await v.table("Mesa 6");
    const { partyId, tabId } = await seat(v, table6);
    await order(v, tabId, "Paella");
    await placeByHand(v, tabId);

    expect((await floorRow(v, table6)).party!.openingBillId).toBe(tabId);
    const { tabId: next } = await orderForParty(v, partyId, ["Agua"]);

    expect(next).not.toBe(tabId);
    expect(await numbersOf(v, partyId)).toEqual([
      [tabId, 1, null],
      [next, 2, null],
    ]);
    expect((await billRow(v, next)).status).toBe("open");
    expect((await floorRow(v, table6)).party!.openingBillId).toBe(tabId);
    expect((await billRow(v, next)).partyId).toBe(partyId);
    expect((await linesOf(v, next)).map((line) => line.name)).toEqual(["Agua"]);
    expect((await linesOf(v, tabId)).map((line) => line.name)).toEqual(["Paella"]);
    expect((await billRow(v, tabId)).status).toBe("placed");
  });

  it.each([
    ["a presented bill", "bill.presented"],
    ["another party's open bill", "bill.other_party"],
  ])("refuses an order naming %s, writing nothing", async (kind, code) => {
    const diningTable = await v.table(`Mesa main ${kind}`);
    const { partyId, tabId } = await seat(v, diningTable);
    await order(v, tabId, "Burger");
    let target = tabId;
    if (kind === "a presented bill") await placeByHand(v, tabId);
    else target = (await seat(v, await v.table(`Mesa main other ${kind}`))).tabId;
    const linesBefore = await linesOf(v, target);
    const billsBefore = await billsOfParty(v, partyId);
    const revisionBefore = await revisionOf(v, partyId);

    const error = await captureError(() => orderForParty(v, partyId, ["Agua"], target));

    expect(error).toMatchObject({ code, params: { workingOrderId: target } });
    expect(await linesOf(v, target)).toEqual(linesBefore);
    expect(await billsOfParty(v, partyId)).toEqual(billsBefore);
    expect(await revisionOf(v, partyId)).toBe(revisionBefore);
  });

  it("a group command without a bill creates the next bill and moves the party revision once", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Group main"));
    await order(v, tabId, "Burger");
    await pay(v, tabId, "12.00");
    const revisionBefore = await revisionOf(v, partyId);
    const { tabId: landed, revision } = await inTx(v, (tx) =>
      submitGroups(tx, v.cfg, partyId, {
        submissionId: randomUUID(),
        expectedPartyRevision: revisionBefore,
        operatorId: OPERATOR,
        groups: [{ lines: [{ menuItemId: v.item("Flan"), quantity: "1" }], release: "fire" }],
      }),
    );
    expect(landed).not.toBe(tabId);
    expect(await numbersOf(v, partyId)).toEqual([
      [tabId, 1, null],
      [landed, 2, null],
    ]);
    expect((await billRow(v, landed)).status).toBe("open");
    expect(revision).toBe(revisionBefore + 1);
    expect(await revisionOf(v, partyId)).toBe(revisionBefore + 1);
  });

  it("refuses a paid bill's saved draft without creating the next bill or moving any revision", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Draft main"));
    await order(v, tabId, "Burger");
    const draft = await inTx(v, (tx) =>
      saveDraft(tx, v.cfg, partyId, OPERATOR, {
        billId: tabId,
        draftId: null,
        revision: 0,
        lines: [{ menuItemId: v.item("Flan"), quantity: "1" }],
      }),
    );
    await inTx(v, (tx) =>
      tx
        .update(workingOrders)
        .set({ status: "settled", settledAt: new Date().toISOString() })
        .where(eq(workingOrders.id, tabId)),
    );
    const before = {
      bills: await billsOfParty(v, partyId),
      party: await partyRow(v, partyId),
      lines: await linesOf(v, tabId),
      drafts: await inTx(v, (tx) => readDrafts(tx, v.cfg, partyId)),
    };
    await expect(
      inTx(v, async (tx) =>
        submitDraft(tx, v.cfg, partyId, draft.id, {
          submissionId: randomUUID(),
          operatorId: OPERATOR,
          expectedPartyRevision: before.party.revision,
          expectedEdit: await expectedDraftEditForTest(v.db, draft),
          draftRevision: draft.revision,
          groups: [{ lineIds: draft.lines.map(({ id }) => id), release: "fire" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "bill.paid", params: { workingOrderId: tabId } });
    expect({
      bills: await billsOfParty(v, partyId),
      party: await partyRow(v, partyId),
      lines: await linesOf(v, tabId),
      drafts: await inTx(v, (tx) => readDrafts(tx, v.cfg, partyId)),
    }).toEqual(before);
    expect(before.bills).toEqual([tabId]);
  });

  it("is none when the party's only bill is abandoned", async () => {
    const table8 = await v.table("Mesa 8");
    const { tabId } = await seat(v, table8);
    await abandon(tabId);
    expect((await floorRow(v, table8)).party!.openingBillId).toBeNull();
  });
});

describe("a party service zone", () => {
  it("names no zone for a party that does not exist", async () => {
    expect(await inTx(v, (tx) => partyZone(tx, v.cfg, randomUUID()))).toBeNull();
  });
});

describe("an order sent to a named bill", () => {
  it("lands on another open bill of the party, and the table still opens on Bill 1", async () => {
    const table9 = await v.table("Mesa 9");
    const { partyId, tabId } = await seat(v, table9);
    await order(v, tabId, "Burger", "Vino");
    const checkId = await split(v, partyId, tabId, [2]);
    const revisionBefore = await revisionOf(v, partyId);

    const { tabId: landed, revision } = await orderForParty(v, partyId, ["Agua"], checkId);

    expect(landed).toBe(checkId);
    expect(revision).toBe(revisionBefore);
    expect(await revisionOf(v, partyId)).toBe(revisionBefore);
    expect((await linesOf(v, checkId)).map((line) => line.name)).toEqual(["Vino", "Agua"]);
    expect((await floorRow(v, table9)).party!.openingBillId).toBe(tabId);
  });

  it.each([
    ["a presented bill", "bill.presented"],
    ["a paid bill", "bill.paid"],
    ["an abandoned bill", "tab.not_open"],
    ["another party's bill", "bill.other_party"],
    ["a bill that does not exist", "tab.not_open"],
  ])("refuses %s with its own code, writing no line", async (kind, code) => {
    const diningTable = await v.table(`Mesa ${kind}`);
    const { partyId, tabId } = await seat(v, diningTable);
    await order(v, tabId, "Tarta");
    let target = tabId;
    if (kind === "a presented bill") await placeByHand(v, tabId);
    if (kind === "a paid bill") await pay(v, tabId, "15.00");
    if (kind === "an abandoned bill") await abandon(tabId);
    if (kind === "another party's bill") {
      target = (await seat(v, await v.table(`Mesa other ${kind}`))).tabId;
    }
    if (kind === "a bill that does not exist") target = randomUUID();
    const linesBefore = await linesOf(v, target);
    const revisionBefore = await revisionOf(v, partyId);

    const error = await captureError(() =>
      inTx(v, (tx) =>
        placeGroups(tx, v.cfg, partyId, {
          groups: [{ lines: [{ menuItemId: v.item("Agua"), quantity: "1" }], release: "fire" }],
          operatorId: OPERATOR,
          billId: target,
        }),
      ),
    );

    expect(error).toMatchObject({ code });
    expect(await linesOf(v, target)).toEqual(linesBefore);
    expect(await revisionOf(v, partyId)).toBe(revisionBefore);
  });
});

describe("a split bill is a bill like any other", () => {
  it("can have a line voided", async () => {
    const table10 = await v.table("Mesa 10");
    const { partyId, tabId } = await seat(v, table10);
    await order(v, tabId, "Burger", "Vino");
    const checkId = await split(v, partyId, tabId, [2]);

    await inTx(v, (tx) => cancelLine(tx, v.cfg, checkId, 1));

    expect(await linesOf(v, checkId)).toEqual([]);
  });
});

describe("the party's name", () => {
  it("is shown instead of its tables, trimmed, and cleared by an empty name", async () => {
    const table12 = await v.table("Mesa 12");
    const { partyId, revision } = await seat(v, table12);

    const named = await inTx(v, (tx) =>
      setPartyName(tx, { partyId, name: "  Ana ", expectedPartyRevision: revision }),
    );
    const floor = await inTx(v, (tx) => listTablesWithState(tx, v.cfg));

    expect(named).toEqual({ revision: revision + 1, name: "Ana" });
    expect((await partyRow(v, partyId)).name).toBe("Ana");
    expect(floor.find((t) => t.id === table12)!.party).toMatchObject({
      name: "Ana",
      displayName: "Ana",
    });

    await inTx(v, (tx) =>
      setPartyName(tx, { partyId, name: "", expectedPartyRevision: revision + 1 }),
    );
    const after = await inTx(v, (tx) => listTablesWithState(tx, v.cfg));
    expect(after.find((t) => t.id === table12)!.party).toMatchObject({
      name: null,
      displayName: "Mesa 12",
    });
  });

  it("is refused with a stale revision, changing nothing", async () => {
    const table13 = await v.table("Mesa 13");
    const { partyId, revision } = await seat(v, table13);
    const error = await captureError(() =>
      inTx(v, (tx) =>
        setPartyName(tx, { partyId, name: "Ana", expectedPartyRevision: revision - 1 }),
      ),
    );
    expect(error).toMatchObject({ code: "party.out_of_date" });
    expect((await partyRow(v, partyId)).name).toBeNull();
    expect(await revisionOf(v, partyId)).toBe(revision);
  });
});

describe("pay, then order dessert", () => {
  it("opens a new tab on the same party and leaves the earlier sale untouched", async () => {
    const table20 = await v.table("Mesa 20");
    const { partyId, tabId } = await seat(v, table20, 2);
    await order(v, tabId, "Burger", "Vino");
    const checkId = await split(v, partyId, tabId, [2]);
    await pay(v, tabId, "12.00");
    await pay(v, checkId, "30.00");
    const soldBefore = await soldLinesOf(tabId);
    expect(soldBefore).toHaveLength(1);
    expect((await partyRow(v, partyId)).state).toBe("open");
    const revisionBefore = await revisionOf(v, partyId);

    const { tabId: dessertTab, revision } = await orderForParty(v, partyId, ["Flan"]);

    expect(dessertTab).not.toBe(tabId);
    expect(revision).toBe(revisionBefore + 1);
    expect(await revisionOf(v, partyId)).toBe(revisionBefore + 1);
    expect((await billRow(v, dessertTab)).partyId).toBe(partyId);
    expect((await billRow(v, dessertTab)).status).toBe("open");
    expect(await numbersOf(v, partyId)).toEqual([
      [tabId, 1, null],
      [checkId, 2, null],
      [dessertTab, 3, null],
    ]);
    expect((await billRow(v, tabId)).status).toBe("settled");
    expect(await soldLinesOf(tabId)).toEqual(soldBefore);
    const bills = await inTx(v, (tx) => readPartyBills(tx, partyId));
    expect(bills.map((bill) => [bill.workingOrderId, bill.total, bill.outstanding])).toEqual([
      [tabId, "12.00", "0.00"],
      [checkId, "30.00", "0.00"],
      [dessertTab, "5.00", "5.00"],
    ]);
    const floor = await floorRow(v, table20);
    expect(floor).toMatchObject({
      state: "open-tab",
      hasOpenTab: true,
      party: { openingBillId: dessertTab },
    });
  });

  it("shows the table held with no bill open until the next round opens one", async () => {
    const table21 = await v.table("Mesa 21");
    const { partyId, tabId } = await seat(v, table21, 2);
    await order(v, tabId, "Burger");
    await pay(v, tabId, "12.00");

    const floor = await floorRow(v, table21);

    expect(floor).toMatchObject({ state: "open-tab", hasOpenTab: false });
    expect(floor.tabTotal).toBeUndefined();
    expect(floor.party).toEqual({
      kitchenNote: { note: null, revision: 0, ownerRevision: 0, scope: { partyId } },
      id: partyId,
      revision: 0,
      guestCount: 2,
      state: "open",
      name: null,
      displayName: "Mesa 21",
      openingBillId: tabId,
      outstanding: "0.00",
      billCount: 1,
      tableIds: [table21],
      unsentDrafts: [],
      reminder: null,
    });
  });

  it("refuses a round sent to a settled tab the party has already moved on from, or to a settled check", async () => {
    const table22 = await v.table("Mesa 22");
    const { partyId, tabId } = await seat(v, table22);
    await order(v, tabId, "Burger", "Vino");
    const checkId = await split(v, partyId, tabId, [2]);
    await pay(v, tabId, "12.00");
    await pay(v, checkId, "30.00");
    const { tabId: dessertTab } = await orderForParty(v, partyId, ["Flan"]);
    const revisionBefore = await revisionOf(v, partyId);

    for (const stale of [tabId, checkId]) {
      expect(await captureError(() => orderForParty(v, partyId, ["Agua"], stale))).toMatchObject({
        code: "bill.paid",
        params: { workingOrderId: stale },
      });
    }
    expect((await floorRow(v, table22)).party!.openingBillId).toBe(dessertTab);
    expect(await inTx(v, (tx) => readPartyBills(tx, partyId))).toHaveLength(3);
    expect(await revisionOf(v, partyId)).toBe(revisionBefore);
  });

  it("refuses a round for a finished party", async () => {
    await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, true));
    try {
      const table23 = await v.table("Mesa 23");
      const { partyId, tabId } = await seat(v, table23);
      await order(v, tabId, "Burger");
      await pay(v, tabId, "12.00");
      await inTx(v, (tx) =>
        finishTable(tx, { partyId, expectedPartyRevision: 0, operatorId: OPERATOR }),
      );

      expect(await captureError(() => orderForParty(v, partyId, ["Flan"]))).toMatchObject({
        code: "party.not_open",
        params: { partyId },
      });
      expect(await billsOfParty(v, partyId)).toEqual([tabId]);
    } finally {
      await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, false));
    }
  });

  it("keeps the party seated when its tab is abandoned, and the next round opens a new tab", async () => {
    const table24 = await v.table("Mesa 24");
    const { partyId, tabId } = await seat(v, table24);
    await order(v, tabId, "Burger");

    await abandonHeldOrder({ db: v.db }, v.cfg, tabId);

    expect((await partyRow(v, partyId)).state).toBe("open");
    expect(await activeTablesOf(v, partyId)).toEqual([table24]);
    expect((await floorRow(v, table24)).state).toBe("open-tab");
    const { tabId: next } = await orderForParty(v, partyId, ["Flan"]);
    expect((await billRow(v, next)).partyId).toBe(partyId);
    expect((await floorRow(v, table24)).party!.openingBillId).toBe(next);
    expect((await floorRow(v, table24)).party).toMatchObject({
      billCount: 1,
      outstanding: "5.00",
    });
  });
});

describe("A803 no main bill:", () => {
  const openingBillOf = async (tableId: string) =>
    (await floorRow(v, tableId)).party!.openingBillId;
  const newBill = (partyId: string) => inTx(v, (tx) => insertPartyBill(tx, v.cfg, partyId));
  const openedLongAgo = (billId: string, openedAt: string) =>
    inTx(v, (tx) => tx.update(workingOrders).set({ openedAt }).where(eq(workingOrders.id, billId)));

  it("a seated table's floor row names Bill 1 as the bill it opens on", async () => {
    const table = await v.table("Mesa no main 1");
    const { partyId, tabId } = await seat(v, table);

    expect(await numbersOf(v, partyId)).toEqual([[tabId, 1, null]]);
    expect(await openingBillOf(table)).toBe(tabId);
  });

  it("after the only bill is paid the floor row names it, and an order needs a bill made with createPartyBill", async () => {
    const table = await v.table("Mesa no main 2");
    const { partyId, tabId } = await seat(v, table);
    await order(v, tabId, "Burger");
    await pay(v, tabId, "12.00");

    expect(await openingBillOf(table)).toBe(tabId);
    expect(await captureError(() => orderForParty(v, partyId, ["Flan"], tabId))).toMatchObject({
      code: "bill.paid",
      params: { workingOrderId: tabId },
    });
    expect(await billsOfParty(v, partyId)).toEqual([tabId]);

    const revisionBefore = await revisionOf(v, partyId);
    const made = await inTx(v, (tx) =>
      createPartyBill(tx, v.cfg, partyId, { expectedPartyRevision: revisionBefore }),
    );
    const { tabId: landed } = await orderForParty(v, partyId, ["Flan"], made.billId);

    expect(made.revision).toBe(revisionBefore + 1);
    expect(landed).toBe(made.billId);
    expect((await linesOf(v, made.billId)).map((line) => line.name)).toEqual(["Flan"]);
    expect(await numbersOf(v, partyId)).toEqual([
      [tabId, 1, null],
      [made.billId, 2, null],
    ]);
    expect(await openingBillOf(table)).toBe(made.billId);
  });

  it("a send naming a bill that has since moved to another party refuses bill.other_party, and no line, draft or bill is written", async () => {
    const table = await v.table("Mesa no main 3");
    const freeTable = await v.table("Mesa no main 3b");
    const { partyId, tabId } = await seat(v, table);
    await order(v, tabId, "Burger", "Vino");
    const second = await split(v, partyId, tabId, [2]);
    const expectedPartyRevision = await revisionOf(v, partyId);
    const moved = await inTx(v, (tx) =>
      moveBill(
        tx,
        v.cfg,
        second,
        { tableId: freeTable },
        { operatorId: OPERATOR, expectedPartyRevision },
      ),
    );
    const otherPartyId = moved.partyId!;
    expect(otherPartyId).not.toBe(partyId);
    const rows = async () => ({
      lines: await linesOf(v, second),
      ours: await billsOfParty(v, partyId),
      theirs: await billsOfParty(v, otherPartyId),
      ourDrafts: await inTx(v, (tx) => readDrafts(tx, v.cfg, partyId)),
      theirDrafts: await inTx(v, (tx) => readDrafts(tx, v.cfg, otherPartyId)),
      revisions: [await revisionOf(v, partyId), await revisionOf(v, otherPartyId)],
    });
    const before = await rows();

    const error = await captureError(() => orderForParty(v, partyId, ["Agua"], second));

    expect(error).toMatchObject({ code: "bill.other_party", params: { workingOrderId: second } });
    expect(await rows()).toEqual(before);
    expect(before.lines.map((line) => line.name)).toEqual(["Vino"]);
  });

  it("a send naming a bill of this party that is not the lowest-numbered lands on exactly that bill", async () => {
    const table = await v.table("Mesa no main 4");
    const { partyId, tabId } = await seat(v, table);
    await order(v, tabId, "Burger", "Vino");
    const second = await split(v, partyId, tabId, [2]);

    const { tabId: landed } = await orderForParty(v, partyId, ["Agua"], second);

    expect(landed).toBe(second);
    expect((await linesOf(v, second)).map((line) => line.name)).toEqual(["Vino", "Agua"]);
    expect((await linesOf(v, tabId)).map((line) => line.name)).toEqual(["Burger"]);
    expect(await numbersOf(v, partyId)).toEqual([
      [tabId, 1, null],
      [second, 2, null],
    ]);
  });

  it("the floor row opens on the lowest-numbered owing bill, else the highest-numbered shown bill", async () => {
    // Opening order is seeded against number order: Bill 3 opened first, then Bill 2, then Bill 1.
    const owingTable = await v.table("Mesa no main 5");
    const owing = await seat(v, owingTable);
    const owing2 = await newBill(owing.partyId);
    const owing3 = await newBill(owing.partyId);
    await openedLongAgo(owing3, "2000-01-01T00:00:00.000Z");
    await openedLongAgo(owing2, "2001-01-01T00:00:00.000Z");
    expect((await numbersOf(v, owing.partyId)).map(([id, n]) => [id, n])).toEqual([
      [owing.tabId, 1],
      [owing2, 2],
      [owing3, 3],
    ]);

    expect(await openingBillOf(owingTable)).toBe(owing.tabId);

    await order(v, owing.tabId, "Burger");
    await pay(v, owing.tabId, "12.00");
    await placeByHand(v, owing2);

    expect(await openingBillOf(owingTable)).toBe(owing2);

    const paidTable = await v.table("Mesa no main 5b");
    const paid = await seat(v, paidTable);
    const paid2 = await newBill(paid.partyId);
    const abandoned = await newBill(paid.partyId);
    await openedLongAgo(paid2, "2000-01-01T00:00:00.000Z");
    for (const billId of [paid.tabId, paid2]) {
      await order(v, billId, "Burger");
      await pay(v, billId, "12.00");
    }
    await abandon(abandoned);

    expect(await openingBillOf(paidTable)).toBe(paid2);
  });
});
