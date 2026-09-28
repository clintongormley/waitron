import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { captureError, saleLines, sales, workingOrders } from "@waitron/db";
import { writeClearingWorkflow } from "@waitron/venue-service";
import {
  abandonHeldOrder,
  joinTable,
  listTablesWithState,
  mergeTabs,
  moveTab,
  unjoinTable,
  voidTabLine,
} from "./working-order.js";
import { placeGroups } from "./order-groups.js";
import {
  finishTable,
  partyMainBill,
  partyZone,
  readPartyBills,
  setMainBill,
  setPartyName,
} from "./parties.js";
import { readDrafts, saveDraft } from "./order-drafts.js";
import { VENUE_SERVICE } from "./modules.js";
import { createTable } from "./tables.js";
import {
  OPERATOR,
  activeTablesOf,
  billRow,
  billsOfParty,
  commandFor,
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
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import "./errors.js";

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

describe("the main bill", () => {
  it("is the tab seating opens, and a round with no bill named lands on it", async () => {
    const mesa4 = await v.table("Mesa 4");
    const { partyId, tabId } = await seat(v, mesa4);
    expect((await partyRow(v, partyId)).mainBillId).toBe(tabId);

    const { tabId: landed } = await orderForParty(v, partyId, ["Burger"]);

    expect(landed).toBe(tabId);
    expect((await linesOf(v, tabId)).map((line) => line.name)).toEqual(["Burger"]);
  });

  it("is cleared when it is paid, and the next order starts a new, empty main bill on the party", async () => {
    const mesa4 = await v.table("Mesa 4b");
    const { partyId, tabId } = await seat(v, mesa4);
    await order(v, tabId, "Burger");
    await pay(v, tabId, "12.00");
    const saleBefore = await soldLinesOf(tabId);

    expect((await partyRow(v, partyId)).mainBillId).toBeNull();

    const { tabId: dessert } = await orderForParty(v, partyId, ["Flan"]);

    expect(dessert).not.toBe(tabId);
    expect((await partyRow(v, partyId)).mainBillId).toBe(dessert);
    expect((await billRow(v, dessert)).partyId).toBe(partyId);
    expect((await linesOf(v, dessert)).map((line) => line.name)).toEqual(["Flan"]);
    expect((await tableRow(v, mesa4)).tabId).toBe(dessert);
    expect(await billsOfParty(v, partyId)).toEqual([tabId, dessert]);
    expect(await soldLinesOf(tabId)).toEqual(saleBefore);
  });

  it("is cleared when it is presented, and the next order starts a new one while the presented bill stays as it was", async () => {
    const mesa6 = await v.table("Mesa 6");
    const { partyId, tabId } = await seat(v, mesa6);
    await order(v, tabId, "Paella");
    await placeByHand(v, tabId);

    expect((await partyRow(v, partyId)).mainBillId).toBeNull();
    const { tabId: next } = await orderForParty(v, partyId, ["Agua"]);

    expect(next).not.toBe(tabId);
    expect((await partyRow(v, partyId)).mainBillId).toBe(next);
    expect((await billRow(v, next)).partyId).toBe(partyId);
    expect((await linesOf(v, next)).map((line) => line.name)).toEqual(["Agua"]);
    expect((await linesOf(v, tabId)).map((line) => line.name)).toEqual(["Paella"]);
    expect((await billRow(v, tabId)).status).toBe("placed");
  });

  it("is cleared by setMainBill naming none, which moves no table, even one showing a closed bill", async () => {
    const mesa14 = await v.table("Mesa 14");
    const { partyId, tabId } = await seat(v, mesa14);
    await abandon(tabId);

    await inTx(v, (tx) => setMainBill(tx, partyId, null));

    expect((await partyRow(v, partyId)).mainBillId).toBeNull();
    expect((await tableRow(v, mesa14)).tabId).toBe(tabId);
  });

  it("is cleared when it is abandoned", async () => {
    const mesa8 = await v.table("Mesa 8");
    const { partyId, tabId } = await seat(v, mesa8);
    await abandon(tabId);
    expect((await partyRow(v, partyId)).mainBillId).toBeNull();
  });
});

describe("a party at a table in no service zone", () => {
  it("gets a main bill with no service context, and reads a saved draft's lines as unavailable", async () => {
    const { id: bare } = await inTx(v, (tx) => createTable(tx, v.cfg, { label: "Mesa sin zona" }));
    const { partyId, tabId } = await seat(v, bare);
    await abandon(tabId);
    expect(await inTx(v, (tx) => partyZone(tx, v.cfg, partyId))).toBeNull();

    const main = await inTx(v, (tx) => partyMainBill(tx, v.cfg, partyId));

    expect(main).not.toBe(tabId);
    expect((await partyRow(v, partyId)).mainBillId).toBe(main);
    expect((await billRow(v, main)).partyId).toBe(partyId);
    expect(await inTx(v, (tx) => VENUE_SERVICE.findOrderContext(tx, v.cfg, main))).toBeNull();

    await inTx(v, (tx) =>
      saveDraft(tx, v.cfg, partyId, OPERATOR, {
        draftId: null,
        revision: 0,
        lines: [{ menuItemId: v.item("Agua"), quantity: "1" }],
      }),
    );
    const [draft] = await inTx(v, (tx) => readDrafts(tx, v.cfg, partyId));
    expect(draft!.lines.map((line) => line.unavailable)).toEqual([true]);
  });

  it("names no zone for a party that does not exist", async () => {
    expect(await inTx(v, (tx) => partyZone(tx, v.cfg, randomUUID()))).toBeNull();
  });
});

describe("an order sent to a named bill (P5)", () => {
  it("lands on another open bill of the party, and the main bill stays", async () => {
    const mesa9 = await v.table("Mesa 9");
    const { partyId, tabId } = await seat(v, mesa9);
    await order(v, tabId, "Burger", "Vino");
    const checkId = await split(v, partyId, tabId, [2]);
    const revisionBefore = await revisionOf(v, partyId);

    const { tabId: landed, revision } = await orderForParty(v, partyId, ["Agua"], checkId);

    expect(landed).toBe(checkId);
    expect(revision).toBe(revisionBefore);
    expect(await revisionOf(v, partyId)).toBe(revisionBefore);
    expect((await linesOf(v, checkId)).map((line) => line.name)).toEqual(["Vino", "Agua"]);
    expect((await partyRow(v, partyId)).mainBillId).toBe(tabId);
  });

  it.each([
    ["a presented bill", "bill.presented"],
    ["a paid bill", "bill.paid"],
    ["an abandoned bill", "tab.not_open"],
    ["another party's bill", "bill.other_party"],
    ["a bill that does not exist", "tab.not_open"],
  ])("refuses %s with its own code, writing no line", async (kind, code) => {
    const mesa = await v.table(`Mesa ${kind}`);
    const { partyId, tabId } = await seat(v, mesa);
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
    const mesa10 = await v.table("Mesa 10");
    const { partyId, tabId } = await seat(v, mesa10);
    await order(v, tabId, "Burger", "Vino");
    const checkId = await split(v, partyId, tabId, [2]);

    await inTx(v, (tx) => voidTabLine(tx, v.cfg, checkId, 1));

    expect(await linesOf(v, checkId)).toEqual([]);
  });
});

describe("the old merge keeps the main bill in step", () => {
  it("makes the bill merged into main when the merged-away bill was main", async () => {
    const mesa11 = await v.table("Mesa 11");
    const { partyId, tabId } = await seat(v, mesa11);
    await order(v, tabId, "Burger", "Vino");
    const checkId = await split(v, partyId, tabId, [2]);

    const merge = { freeSourceTable: false, ...(await commandFor(v, partyId)) };
    await inTx(v, (tx) => mergeTabs(tx, v.cfg, checkId, tabId, merge));

    expect((await partyRow(v, partyId)).mainBillId).toBe(checkId);
  });
});

describe("the party's name", () => {
  it("is shown instead of its tables, trimmed, and cleared by an empty name", async () => {
    const mesa12 = await v.table("Mesa 12");
    const { partyId, revision } = await seat(v, mesa12);

    const named = await inTx(v, (tx) =>
      setPartyName(tx, { partyId, name: "  Ana ", expectedPartyRevision: revision }),
    );
    const floor = await inTx(v, (tx) => listTablesWithState(tx, v.cfg));

    expect(named).toEqual({ revision: revision + 1, name: "Ana" });
    expect((await partyRow(v, partyId)).name).toBe("Ana");
    expect(floor.find((t) => t.id === mesa12)!.party).toMatchObject({
      name: "Ana",
      displayName: "Ana",
    });

    await inTx(v, (tx) =>
      setPartyName(tx, { partyId, name: "", expectedPartyRevision: revision + 1 }),
    );
    const after = await inTx(v, (tx) => listTablesWithState(tx, v.cfg));
    expect(after.find((t) => t.id === mesa12)!.party).toMatchObject({
      name: null,
      displayName: "Mesa 12",
    });
  });

  it("is refused with a stale revision, changing nothing", async () => {
    const mesa13 = await v.table("Mesa 13");
    const { partyId, revision } = await seat(v, mesa13);
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

// Moved from `parties.test.ts`, where these rounds went through `addTabRound` on the paid tab; a
// round now reaches the party's main bill through `placeGroups`.
describe("pay, then order dessert", () => {
  it("opens a new tab on the same party and leaves the earlier sale untouched", async () => {
    const mesa20 = await v.table("Mesa 20");
    const { partyId, tabId } = await seat(v, mesa20, 2);
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
    expect((await tableRow(v, mesa20)).tabId).toBe(dessertTab);
    expect((await billRow(v, tabId)).status).toBe("settled");
    expect(await soldLinesOf(tabId)).toEqual(soldBefore);
    const bills = await inTx(v, (tx) => readPartyBills(tx, partyId));
    expect(bills.map((bill) => [bill.workingOrderId, bill.total, bill.outstanding])).toEqual([
      [tabId, "12.00", "0.00"],
      [checkId, "30.00", "0.00"],
      [dessertTab, "5.00", "5.00"],
    ]);
    const floor = await floorRow(v, mesa20);
    expect(floor).toMatchObject({ state: "open-tab", hasOpenTab: true, tabId: dessertTab });
  });

  it("names the settled tab as the table's tab until the next round opens one", async () => {
    const mesa21 = await v.table("Mesa 21");
    const { partyId, tabId } = await seat(v, mesa21, 2);
    await order(v, tabId, "Burger");
    await pay(v, tabId, "12.00");

    const floor = await floorRow(v, mesa21);

    expect(floor).toMatchObject({ state: "open-tab", hasOpenTab: false, tabId });
    expect(floor.tabTotal).toBeUndefined();
    expect(floor.party).toEqual({
      id: partyId,
      revision: 0,
      guestCount: 2,
      state: "open",
      name: null,
      displayName: "Mesa 21",
      mainBillId: null,
      outstanding: "0.00",
      billCount: 1,
      tableIds: [mesa21],
      unsentDrafts: [],
      reminder: null,
    });
  });

  it("refuses a round sent to a settled tab the party has already moved on from, or to a settled check", async () => {
    const mesa22 = await v.table("Mesa 22");
    const { partyId, tabId } = await seat(v, mesa22);
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
    expect((await tableRow(v, mesa22)).tabId).toBe(dessertTab);
    expect(await inTx(v, (tx) => readPartyBills(tx, partyId))).toHaveLength(3);
    expect(await revisionOf(v, partyId)).toBe(revisionBefore);
  });

  it("refuses a round for a finished party", async () => {
    await inTx(v, (tx) => writeClearingWorkflow(tx, true));
    try {
      const mesa23 = await v.table("Mesa 23");
      const { partyId, tabId } = await seat(v, mesa23);
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
      await inTx(v, (tx) => writeClearingWorkflow(tx, false));
    }
  });

  it("keeps the party seated when its tab is abandoned, and the next round opens a new tab", async () => {
    const mesa24 = await v.table("Mesa 24");
    const { partyId, tabId } = await seat(v, mesa24);
    await order(v, tabId, "Burger");

    await abandonHeldOrder({ db: v.db }, v.cfg, tabId);

    expect((await partyRow(v, partyId)).state).toBe("open");
    expect(await activeTablesOf(v, partyId)).toEqual([mesa24]);
    expect((await floorRow(v, mesa24)).state).toBe("open-tab");
    const { tabId: next } = await orderForParty(v, partyId, ["Flan"]);
    expect((await billRow(v, next)).partyId).toBe(partyId);
    expect((await tableRow(v, mesa24)).tabId).toBe(next);
    expect((await floorRow(v, mesa24)).party).toMatchObject({
      billCount: 1,
      outstanding: "5.00",
    });
  });
});

describe("the main bill agrees with the old rule on every old path", () => {
  /**
   * A fresh party with two dishes on its tab, after the named old path. For unjoin, the party the
   * unjoined table starts.
   */
  async function afterOldPath(path: string): Promise<{ partyId: string }> {
    const first = await v.table(`Mesa old ${path}`);
    const { partyId, tabId } = await seat(v, first);
    if (path === "unjoin") {
      const second = await v.table(`Mesa old ${path} 2`);
      const joined = await commandFor(v, partyId);
      await inTx(v, (tx) => joinTable(tx, v.cfg, tabId, second, joined));
      await order(v, tabId, "Burger", "Vino");
      const sent = await commandFor(v, partyId);
      const { tabId: newTab } = await inTx(v, (tx) =>
        unjoinTable(tx, v.cfg, tabId, second, [{ lineNo: 2 }], sent),
      );
      return { partyId: (await billRow(v, newTab!)).partyId! };
    }
    await order(v, tabId, "Burger", "Vino");
    if (path === "join") {
      const other = await v.table(`Mesa old ${path} 2`);
      const sent = await commandFor(v, partyId);
      await inTx(v, (tx) => joinTable(tx, v.cfg, tabId, other, sent));
    }
    if (path === "move") {
      const other = await v.table(`Mesa old ${path} 2`);
      const sent = await commandFor(v, partyId);
      await inTx(v, (tx) => moveTab(tx, v.cfg, tabId, other, sent));
    }
    if (path === "merge") {
      const checkId = await split(v, partyId, tabId, [2]);
      const merge = { freeSourceTable: false, ...(await commandFor(v, partyId)) };
      await inTx(v, (tx) => mergeTabs(tx, v.cfg, tabId, checkId, merge));
    }
    return { partyId };
  }

  it.each(["seat", "join", "move", "unjoin", "merge"])(
    "after %s, the main bill is the bill the party's first table points at",
    async (path) => {
      const { partyId } = await afterOldPath(path);
      const [first] = await activeTablesOf(v, partyId);
      const main = (await partyRow(v, partyId)).mainBillId;
      expect(main).not.toBeNull();
      expect(main).toBe((await tableRow(v, first!)).tabId);
    },
  );
});
