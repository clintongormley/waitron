import { saveDraftForTest as saveDraft } from "./testing/draft-command-fixture.js";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createExtraList, createProduct, writeProductModifiers } from "@waitron/catalogue";
import { createPrinter } from "@waitron/printing";
import {
  captureError,
  diningTables,
  floorZones,
  kitchenStations,
  orderGroupEvents,
  orderGroups,
  partyTables,
  printJobs,
  products,
  sales,
  ticketItems,
  workingOrderLines,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { readPartyAllergy, setAllergyLineTicks, writePartyAllergy } from "@waitron/venue-service";
import { decimal, decimalToCents } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import { recallToDraft } from "./draft-recall.js";
import { readBillBalance } from "./bill-payments.js";
import { writeMerge } from "./floor-today-merges.js";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { createCourse } from "./kitchen.js";
import { insertPartyBill } from "./parties.js";
import { splitTable as splitSelection, type SplitSelection } from "./table-actions.js";
import {
  readChangesAfterSending,
  setChangesAfterSending,
} from "./testing/changes-after-sending.js";
import { attachPrinterToStation, detachPrinterFromStation } from "./station-printers.js";
import { printedLines } from "./testing/decode-ticket.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { serveLine } from "./testing/serve-line.js";
import { advanceTicketItem, storedOrderTotal } from "./working-order.js";
import { fireGroup } from "./order-groups.js";
import { takeBillPayment } from "./testing/bill-payment-fixture.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { setNeedsClearingInEveryDepartment } from "./testing/needs-clearing.js";
import { mergeBills, splitBill } from "./testing/bill-action-fixture.js";
import { readDrafts } from "./order-drafts.js";

import { placeGroups } from "./testing/group-submit-fixture.js";
import { VENUE_SERVICE } from "./modules.js";
import { finishTable, readPartyBills, setPartyName } from "./testing/party-close-fixture.js";
import { switchOff } from "./testing/live-table.js";
import { readScopedPassBoard } from "./pass-board.js";
import { boardCards, EVERY } from "./testing/pass-board-probe.js";
import { withMovedSlips } from "./moved-slips.js";
import {
  combineParties,
  joinTables,
  moveGuests,
  splitTable,
  type TableActionOptions,
} from "./testing/table-action-fixture.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  OPERATOR,
  activeTablesOf,
  billRow,
  cashContribution,
  inTx,
  linesOf,
  nextMillisecond,
  order,
  orderForParty,
  partyAt,
  openingBillOfParty,
  partyRow,
  pay,
  paymentsOf,
  placeByHand,
  revisionOf,
  seatWithNoAllergies as seat,
  setupPartyVenue,
  tableRow,
  zoneOf,
  type PartyVenue,
  floorRow,
} from "./testing/party-venue.js";
import { mergeOf, needingMoving, plannedZone } from "./testing/floor-today-venue.js";
import { allocationsOf, numbersOf } from "./testing/bill-identities.js";
import "./errors.js";

// Move guests, join tables and split a table (table actions plan, Task 8; spec §6, §8, §15).
// `resetPerTest: false`: the venue is provisioned once, and each case seats its own tables.
let v: PartyVenue;
/** A second zone of dining tables. */
let terraceZone: string;
/** Offers beyond the venue's menu: a dish with an extra, and prices a bill can cut to the cent. */
let extras: {
  toppedBurger: string;
  toppings: string;
  cheese: string;
  side: string;
  steak: string;
};

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
    extras = await inTx(v, async (tx) => {
      const [burger] = await tx
        .select({ catalogueId: products.catalogueId, categoryId: products.categoryId })
        .from(products)
        .where(eq(products.id, v.productId("Burger")));
      const product = async (name: string, unitPrice: string) =>
        (
          await createProduct(tx, {
            catalogueId: burger!.catalogueId,
            categoryId: burger!.categoryId,
            name,
            customerName: { [v.cfg.locale]: name },
            kitchenName: name.toUpperCase(),
            pricingUnit: "each",
            unitPrice,
            vatClass: "general",
          })
        ).id;
      const cheese = await product("Cheese", "1.00");
      const topped = await product("Topped burger", "12.00");
      const side = await product("Side", "39.99");
      const steak = await product("Steak", "12.01");
      const toppings = (
        await createExtraList(
          tx,
          {
            name: "Toppings",
            customerName: null,
            kitchenName: null,
            minPicks: 0,
            maxPicks: null,
            active: true,
            items: [{ productId: cheese, maxQuantity: 2, preselected: false, price: null }],
          },
          v.cfg.locale,
        )
      ).id;
      await writeProductModifiers(tx, topped, [{ kind: "extras", id: toppings }]);
      const offers = await offerProducts(tx, v.cfg, { zone: "tables" });
      return {
        toppedBurger: offers.offerFor(topped),
        toppings,
        cheese,
        side: offers.offerFor(side),
        steak: offers.offerFor(steak),
      };
    });
    terraceZone = await inTx(v, async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: v.cfg.locationId, name: "Terraza" })
        .returning({ id: floorZones.id });
      return (await offerProducts(tx, v.cfg, { zone: { zoneId: zone!.id }, orderStart: "table" }))
        .zoneId;
    });
  },
});

async function act<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return inTx(v, fn);
}

async function opts(partyId: string, other?: string): Promise<TableActionOptions> {
  return {
    expectedPartyRevision: await revisionOf(v, partyId),
    ...(other === undefined
      ? {}
      : { otherPartyId: other, expectedOtherPartyRevision: await revisionOf(v, other) }),
    operatorId: OPERATOR,
  };
}

/** What Split a table is sent: the party's revision as read now, and who acts. */
async function cmd(partyId: string) {
  return { expectedPartyRevision: await revisionOf(v, partyId), operatorId: OPERATOR };
}

/** Fresh tables labelled `<prefix> <n>` for each n, in the tables zone. */
async function tables(prefix: string, ...numbers: number[]): Promise<string[]> {
  const ids = [];
  for (const n of numbers) ids.push(await v.table(`${prefix} ${n}`));
  return ids;
}

/** Joins a free table to the party, as the till's Join tables does. */
async function joinFree(partyId: string, tableId: string): Promise<void> {
  await nextMillisecond();
  const joining = await opts(partyId);
  await act((tx) => joinTables(tx, v.cfg, partyId, tableId, joining));
}

async function needsClearing(tableId: string): Promise<void> {
  await act((tx) =>
    tx
      .update(diningTables)
      .set({ needsClearingSince: new Date().toISOString() })
      .where(eq(diningTables.id, tableId)),
  );
}

/** Runs `fn` with every department's Needs clearing on, and puts it back off. */
async function withClearing<T>(fn: () => Promise<T>): Promise<T> {
  await act((tx) => setNeedsClearingInEveryDepartment(tx, true));
  try {
    return await fn();
  } finally {
    await act((tx) => setNeedsClearingInEveryDepartment(tx, false));
  }
}

async function splitOff(partyId: string, billId: string, lineNos: number[]): Promise<string> {
  const command = await cmd(partyId);
  const { billId: made } = await act((tx) =>
    splitBill(
      tx,
      v.cfg,
      billId,
      lineNos.map((lineNo) => ({ lineNo })),
      command,
    ),
  );
  return made;
}

/** Sends each group as `placeGroups` does, in one transaction, to `billId` when given. */
async function sendGroups(
  partyId: string,
  groups: { names: string[]; release: "fire" | "hold" }[],
  billId?: string,
): Promise<void> {
  await act((tx) =>
    placeGroups(tx, v.cfg, partyId, {
      groups: groups.map((group) => ({
        lines: group.names.map((name) => ({ menuItemId: v.item(name), quantity: "1" })),
        release: group.release,
      })),
      operatorId: OPERATOR,
      ...(billId === undefined ? {} : { billId }),
    }),
  );
}

/** Every stored column of the bill's lines, in line order. */
async function lineRows(billId: string) {
  return act((tx) =>
    tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(asc(workingOrderLines.lineNo)),
  );
}

/** The kitchen's items for the bill's lines, in line order. */
async function ticketsOf(billId: string) {
  return act((tx) =>
    tx
      .select({
        lineId: ticketItems.workingOrderLineId,
        state: ticketItems.state,
        firedAt: ticketItems.firedAt,
      })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(eq(ticketItems.workingOrderId, billId))
      .orderBy(asc(workingOrderLines.lineNo)),
  );
}

/** The party's kitchen groups in position order. */
async function groupsOf(partyId: string) {
  return act((tx) =>
    tx
      .select({ id: orderGroups.id, state: orderGroups.state, position: orderGroups.position })
      .from(orderGroups)
      .where(eq(orderGroups.partyId, partyId))
      .orderBy(asc(orderGroups.position)),
  );
}

/** The parties, their tables, the tables' rows and each bill's row, lines, payments and zone. */
async function snapshot(partyIds: string[], billIds: string[], tableIds: string[] = []) {
  const read = [];
  for (const id of partyIds) {
    read.push({
      party: await partyRow(v, id),
      tables: await activeTablesOf(v, id),
      groups: await groupsOf(id),
    });
  }
  const bills = [];
  for (const id of billIds) {
    bills.push({
      row: await billRow(v, id),
      lines: await lineRows(id),
      payments: await paymentsOf(v, id),
      zone: await zoneOf(v, id),
    });
  }
  const rows = [];
  for (const id of tableIds) rows.push(await tableRow(v, id));
  return { parties: read, bills, tables: rows };
}

/** Runs `fn`, expecting a refusal that leaves the named parties, bills and tables as they were. */
async function refused(
  partyIds: string[],
  billIds: string[],
  tableIds: string[],
  fn: () => Promise<unknown>,
) {
  const before = await snapshot(partyIds, billIds, tableIds);
  const error = await captureError(fn);
  expect(await snapshot(partyIds, billIds, tableIds)).toEqual(before);
  return error;
}

function noticesOn(billIds: string[]) {
  return v.db.all<{ working_order_id: string; kind: string; line_name: string; moved_to: string }>(
    sql`
      select working_order_id, kind, line_name, moved_to from kitchen_notices
      where working_order_id in (${sql.join(
        billIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      order by rowid`,
  );
}

describe("move guests", () => {
  it("moves the party off all its tables to a free one, and the tables left behind need clearing", async () => {
    await withClearing(async () => {
      const [m4, m5, m9] = await tables("Mesa", 4, 5, 9);
      const ana = await seat(v, m4);
      await joinFree(ana.partyId, m5);

      const moving = await opts(ana.partyId);
      const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m9, moving));

      expect(result).toEqual({ partyId: ana.partyId, billIds: [ana.tabId] });
      expect(await activeTablesOf(v, ana.partyId)).toEqual([m9]);
      for (const left of [m4, m5]) {
        const row = await tableRow(v, left);
        expect(row.needsClearingSince).not.toBeNull();
      }
      expect(await tableRow(v, m9)).toMatchObject({
        needsClearingSince: null,
      });
      expect((await billRow(v, ana.tabId)).partyId).toBe(ana.partyId);
      expect(await openingBillOfParty(v, ana.partyId)).toBe(ana.tabId);
      expect(await partyRow(v, ana.partyId)).toMatchObject({
        state: "open",
        revision: moving.expectedPartyRevision + 1,
      });
    });
  });

  it("leaves the tables behind free when their department has Needs clearing off", async () => {
    const [m4, m9] = await tables("Libre", 4, 9);
    const ana = await seat(v, m4);

    const moving = await opts(ana.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m9, moving));

    expect(await tableRow(v, m4)).toMatchObject({ needsClearingSince: null });
    expect(await partyAt(v, m4)).toBeNull();
    expect(await activeTablesOf(v, ana.partyId)).toEqual([m9]);
  });

  it("gives the party's open and presented bills a free table's zone when it is in another zone", async () => {
    const [m4] = await tables("Zona", 4);
    const terrace = await v.table("Zona T1", terraceZone);
    const ana = await seat(v, m4);
    await order(v, ana.tabId, "Burger");
    const second = await splitOff(ana.partyId, ana.tabId, [1]);
    await placeByHand(v, second);

    const moving = await opts(ana.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, terrace, moving));

    expect(await zoneOf(v, ana.tabId)).toBe(terraceZone);
    expect(await zoneOf(v, second)).toBe(terraceZone);
    expect((await billRow(v, second)).status).toBe("placed");
  });

  it("combines the party into the party at a held table, which keeps its name and its Bill 1, and every bill stays its own", async () => {
    const [m4, m7] = await tables("Uno", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await act((tx) =>
      setPartyName(tx, {
        partyId: luis.partyId,
        name: "Luis",
        expectedPartyRevision: luis.revision,
      }),
    );
    await order(v, ana.tabId, "Burger");
    await order(v, luis.tabId, "Agua");

    const moving = await opts(ana.partyId, luis.partyId);
    const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect(result).toEqual({ partyId: luis.partyId, billIds: [luis.tabId, ana.tabId] });
    expect((await linesOf(v, luis.tabId)).map((l) => l.name)).toEqual(["Agua"]);
    expect((await linesOf(v, ana.tabId)).map((l) => l.name)).toEqual(["Burger"]);
    expect(await billRow(v, ana.tabId)).toMatchObject({ status: "open", partyId: luis.partyId });
    expect(await numbersOf(v, luis.partyId)).toEqual([
      [luis.tabId, 1, null],
      [ana.tabId, 2, null],
    ]);
    expect(await partyRow(v, ana.partyId)).toMatchObject({
      state: "closed",
      mergedIntoPartyId: luis.partyId,
      closedBy: OPERATOR,
    });
    expect(await openingBillOfParty(v, luis.partyId)).toBe(luis.tabId);
    expect(await partyRow(v, luis.partyId)).toMatchObject({
      name: "Luis",
      revision: moving.expectedOtherPartyRevision! + 1,
    });
    expect(await activeTablesOf(v, luis.partyId)).toEqual([m7]);
    expect(await activeTablesOf(v, ana.partyId)).toEqual([]);
  });

  it("keeps both first bills, and the table opens on the receiving one's", async () => {
    const [m4, m7] = await tables("Dos", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await order(v, luis.tabId, "Agua");

    const moving = await opts(ana.partyId, luis.partyId);
    const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect(result).toEqual({ partyId: luis.partyId, billIds: [luis.tabId, ana.tabId] });
    expect(await billRow(v, ana.tabId)).toMatchObject({ status: "open", partyId: luis.partyId });
    expect((await linesOf(v, ana.tabId)).map((l) => l.name)).toEqual(["Burger"]);
    expect((await linesOf(v, luis.tabId)).map((l) => l.name)).toEqual(["Agua"]);
    expect(await openingBillOfParty(v, luis.partyId)).toBe(luis.tabId);
  });

  it("keeps the first bills separate when the moving one has been paid towards", async () => {
    const [m4, m7] = await tables("Tres", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await order(v, luis.tabId, "Agua");
    await cashContribution(v, ana.tabId, "5.00");

    const moving = await opts(ana.partyId, luis.partyId);
    const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect(result).toEqual({ partyId: luis.partyId, billIds: [luis.tabId, ana.tabId] });
    expect(await billRow(v, ana.tabId)).toMatchObject({ status: "open", partyId: luis.partyId });
    expect(await paymentsOf(v, ana.tabId)).toHaveLength(1);
    expect((await linesOf(v, luis.tabId)).map((l) => l.name)).toEqual(["Agua"]);
  });

  it("keeps the first bills separate when their service modes differ, though both are untouched", async () => {
    const [m4, m7] = await tables("Modos", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await order(v, luis.tabId, "Agua");
    // Stands in for the old tab move, which leaves one party's bills in two service modes.
    await act((tx) => VENUE_SERVICE.retargetOrderContext(tx, luis.tabId, v.counter.zoneId));

    const moving = await opts(ana.partyId, luis.partyId);
    const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect(result).toEqual({ partyId: luis.partyId, billIds: [luis.tabId, ana.tabId] });
    expect(await billRow(v, ana.tabId)).toMatchObject({ status: "open", partyId: luis.partyId });
  });

  it("gives the moving party's open and presented bills the receiving party's zone when it sits in another", async () => {
    const [m4] = await tables("Area", 4);
    const terrace = await v.table("Area T7", terraceZone);
    const ana = await seat(v, m4);
    const luis = await seat(v, terrace);
    await order(v, ana.tabId, "Burger", "Agua");
    const presented = await splitOff(ana.partyId, ana.tabId, [2]);
    await placeByHand(v, presented);

    const moving = await opts(ana.partyId, luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, terrace, moving));

    expect(await zoneOf(v, ana.tabId)).toBe(terraceZone);
    expect(await linesOf(v, ana.tabId)).toMatchObject([
      { name: "Burger", unitPriceGross: 1200, vatClass: "general" },
    ]);
    expect(await zoneOf(v, presented)).toBe(terraceZone);
    expect(await billRow(v, presented)).toMatchObject({ status: "placed", partyId: luis.partyId });
  });

  it("moves to one of the party's own tables while it holds two: the other leaves and needs clearing", async () => {
    await withClearing(async () => {
      const [m4, m5] = await tables("Propia", 4, 5);
      const ana = await seat(v, m4);
      await joinFree(ana.partyId, m5);

      const moving = await opts(ana.partyId);
      const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m5, moving));

      expect(result).toEqual({ partyId: ana.partyId, billIds: [ana.tabId] });
      expect(await activeTablesOf(v, ana.partyId)).toEqual([m5]);
      expect((await tableRow(v, m4)).needsClearingSince).not.toBeNull();
      expect((await tableRow(v, m5)).needsClearingSince).toBeNull();
    });
  });

  describe("what it refuses, changing nothing", () => {
    it("refuses a table that needs clearing", async () => {
      const [m4, dirty] = await tables("Sucia", 4, 9);
      const ana = await seat(v, m4);
      await needsClearing(dirty);
      const moving = await opts(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId], [m4, dirty], () =>
        act((tx) => moveGuests(tx, v.cfg, ana.partyId, dirty, moving)),
      );

      expect(error).toMatchObject({ code: "table.needs_clearing", params: { tableId: dirty } });
    });

    it("refuses a table that needs moving", async () => {
      const { tableId, spare } = await needingMoving(v);
      const ana = await seat(v, spare);
      const moving = await opts(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId], [spare, tableId], () =>
        act((tx) => moveGuests(tx, v.cfg, ana.partyId, tableId, moving)),
      );

      expect(error).toMatchObject({ code: "table.needs_moving", params: { tableId } });
    });

    it("refuses the party's own only table", async () => {
      const [m4] = await tables("Sola", 4);
      const ana = await seat(v, m4);
      const moving = await opts(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId], [m4], () =>
        act((tx) => moveGuests(tx, v.cfg, ana.partyId, m4, moving)),
      );

      expect(error).toMatchObject({ code: "table.already_in_party", params: { tableId: m4 } });
    });

    it("refuses a table taken out of use, and one that does not exist", async () => {
      const [m4, retired] = await tables("Retirada", 4, 9);
      const ana = await seat(v, m4);
      await switchOff(v, retired);
      const missing = randomUUID();
      const moving = await opts(ana.partyId);

      const inactive = await refused([ana.partyId], [ana.tabId], [m4, retired], () =>
        act((tx) => moveGuests(tx, v.cfg, ana.partyId, retired, moving)),
      );
      const absent = await refused([ana.partyId], [ana.tabId], [m4], () =>
        act((tx) => moveGuests(tx, v.cfg, ana.partyId, missing, moving)),
      );

      expect(inactive).toMatchObject({ code: "table.inactive", params: { tableId: retired } });
      expect(absent).toMatchObject({ code: "table.not_found", params: { tableId: missing } });
    });

    it("refuses a free table in a zone that seats no one, as seating does", async () => {
      const [m4] = await tables("Barra", 4);
      const counterTable = await v.table("Barra B9", v.counter.zoneId);
      const ana = await seat(v, m4);
      const moving = await opts(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId], [m4, counterTable], () =>
        act((tx) => moveGuests(tx, v.cfg, ana.partyId, counterTable, moving)),
      );

      expect(error).toMatchObject({
        code: "service_zone.mode_incompatible",
        params: { zoneId: v.counter.zoneId, expected: "table_tab" },
      });
      expect(await partyAt(v, counterTable)).toBeNull();
    });

    it("refuses a stale revision of the party at the table", async () => {
      const [m4, m7] = await tables("Vieja", 4, 7);
      const ana = await seat(v, m4);
      const luis = await seat(v, m7);
      const moving = await opts(ana.partyId, luis.partyId);
      await act((tx) =>
        setPartyName(tx, {
          partyId: luis.partyId,
          name: "Luis",
          expectedPartyRevision: moving.expectedOtherPartyRevision!,
        }),
      );

      const error = await refused(
        [ana.partyId, luis.partyId],
        [ana.tabId, luis.tabId],
        [m4, m7],
        () => act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving)),
      );

      expect(error).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: luis.partyId, revision: moving.expectedOtherPartyRevision! + 1 },
      });
    });

    it("refuses a table another party holds when the request carries no revision for it", async () => {
      const [m4, m7] = await tables("Sin", 4, 7);
      const ana = await seat(v, m4);
      const luis = await seat(v, m7);
      const moving = await opts(ana.partyId);

      const error = await refused(
        [ana.partyId, luis.partyId],
        [ana.tabId, luis.tabId],
        [m4, m7],
        () => act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving)),
      );

      expect(error).toMatchObject({
        code: "management.request_invalid",
        params: { field: "expectedOtherPartyRevision" },
      });
    });
  });
});

/** What the floor shows of a table's bills. */
async function floorFigures(tableId: string) {
  const row = await floorRow(v, tableId);
  return {
    state: row.state,
    hasOpenTab: row.hasOpenTab,
    tabLineCount: row.tabLineCount,
    tabTotal: row.tabTotal,
    pendingToServe: row.pendingToServe,
  };
}

describe("the floor reads the bills of the party holding the table", () => {
  it("shows a table the party has left free, with no bill, and the table it moved to with its bill", async () => {
    const [m4, m9] = await tables("Suelo dejada", 4, 9);
    const ana = await seat(v, m4);
    await order(v, ana.tabId, "Burger");
    const moving = await opts(ana.partyId);

    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m9, moving));

    expect(await activeTablesOf(v, ana.partyId)).toEqual([m9]);
    expect(await floorFigures(m4)).toEqual({
      state: "free",
      hasOpenTab: false,
      tabLineCount: undefined,
      tabTotal: undefined,
      pendingToServe: 0,
    });
    expect(await floorFigures(m9)).toEqual({
      state: "open-tab",
      hasOpenTab: true,
      tabLineCount: 1,
      tabTotal: "12.00",
      pendingToServe: 1,
    });
  });

  it("counts a presented bill's dishes still to serve, but not toward the open bill, its lines or its total", async () => {
    const [m4] = await tables("Suelo presentada", 4);
    const ana = await seat(v, m4);
    await order(v, ana.tabId, "Burger", "Vino");
    const presented = await splitOff(ana.partyId, ana.tabId, [2]);
    await placeByHand(v, presented);
    expect((await billRow(v, presented)).status).toBe("placed");

    expect(await floorFigures(m4)).toEqual({
      state: "open-tab",
      hasOpenTab: true,
      tabLineCount: 1,
      tabTotal: "12.00",
      pendingToServe: 2,
    });

    await placeByHand(v, ana.tabId);

    expect(await floorFigures(m4)).toEqual({
      state: "open-tab",
      hasOpenTab: false,
      tabLineCount: undefined,
      tabTotal: undefined,
      pendingToServe: 2,
    });
  });

  it("adds a party's open bills together, and shows every table of the party the same figures", async () => {
    const [m4, m5] = await tables("Suelo suma", 4, 5);
    const ana = await seat(v, m4);
    await joinFree(ana.partyId, m5);
    await order(v, ana.tabId, "Burger", "Vino");
    const second = await splitOff(ana.partyId, ana.tabId, [2]);
    expect((await billRow(v, second)).status).toBe("open");

    const figures = {
      state: "open-tab",
      hasOpenTab: true,
      tabLineCount: 2,
      tabTotal: "42.00",
      pendingToServe: 2,
    };
    expect(await floorFigures(m4)).toEqual(figures);
    expect(await floorFigures(m5)).toEqual(figures);
  });
});

describe("the bills when parties combine", () => {
  it("keeps the incoming open bill as the receiving party's Bill 2, and the table opens on the presented Bill 1, when the receiving one is presented", async () => {
    const [m4, m7] = await tables("Principal", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await order(v, luis.tabId, "Agua");
    await placeByHand(v, luis.tabId);

    const moving = await opts(ana.partyId, luis.partyId);
    const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect(result).toEqual({ partyId: luis.partyId, billIds: [luis.tabId, ana.tabId] });
    expect(await openingBillOfParty(v, luis.partyId)).toBe(luis.tabId);
    expect(await numbersOf(v, luis.partyId)).toEqual([
      [luis.tabId, 1, null],
      [ana.tabId, 2, null],
    ]);
    expect(await billRow(v, ana.tabId)).toMatchObject({ status: "open", partyId: luis.partyId });
    expect(await billRow(v, luis.tabId)).toMatchObject({ status: "placed", partyId: luis.partyId });
  });

  for (const receiving of ["presented", "paid"] as const) {
    it(`opens the combined party on its lowest-numbered owing bill, and the bill the test helper makes for the next order is Bill 3, when the receiving one is ${receiving} and the incoming one presented`, async () => {
      const [m4, m7] = await tables(`Ninguna ${receiving}`, 4, 7);
      const ana = await seat(v, m4);
      const luis = await seat(v, m7);
      await order(v, ana.tabId, "Burger");
      await order(v, luis.tabId, "Agua");
      await placeByHand(v, ana.tabId);
      if (receiving === "presented") await placeByHand(v, luis.tabId);
      else await pay(v, luis.tabId, "2.00");

      const moving = await opts(ana.partyId, luis.partyId);
      const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

      expect(result).toEqual({ partyId: luis.partyId, billIds: [luis.tabId, ana.tabId] });
      expect(await openingBillOfParty(v, luis.partyId)).toBe(
        receiving === "presented" ? luis.tabId : ana.tabId,
      );
      expect(await billRow(v, ana.tabId)).toMatchObject({
        status: "placed",
        partyId: luis.partyId,
      });
      const { tabId } = await orderForParty(v, luis.partyId, ["Flan"]);
      expect([ana.tabId, luis.tabId]).not.toContain(tabId);
      expect(await numbersOf(v, luis.partyId)).toEqual([
        [luis.tabId, 1, null],
        [ana.tabId, 2, null],
        [tabId, 3, null],
      ]);
      expect((await billRow(v, tabId)).status).toBe("open");
      expect((await billRow(v, tabId)).partyId).toBe(luis.partyId);
    });
  }
});

describe("a paid bill stays on its original party", () => {
  it("while the open one moves, and the combined party finishes only once that is paid", async () => {
    const [m4, m7] = await tables("Pagada", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger", "Vino");
    const second = await splitOff(ana.partyId, ana.tabId, [2]);
    await pay(v, ana.tabId, "12.00");
    const before = noticesOn([ana.tabId, second]);

    const moving = await opts(ana.partyId, luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect(await billRow(v, ana.tabId)).toMatchObject({
      status: "settled",
      partyId: ana.partyId,
    });
    expect(noticesOn([ana.tabId, second])).toEqual([
      ...before,
      { working_order_id: ana.tabId, kind: "moved", line_name: "BURG", moved_to: "Pagada 7" },
      { working_order_id: second, kind: "moved", line_name: "TINTO", moved_to: "Pagada 7" },
    ]);
    expect(await billRow(v, second)).toMatchObject({ status: "open", partyId: luis.partyId });
    const bills = await act((tx) => readPartyBills(tx, luis.partyId));
    expect(
      bills.map((bill) => [bill.workingOrderId, bill.partyId, bill.status, bill.billNumber]),
    ).toEqual([
      [luis.tabId, luis.partyId, "open", 1],
      [ana.tabId, ana.partyId, "settled", 2],
      [second, luis.partyId, "open", 3],
    ]);

    const finishing = await cmd(luis.partyId);
    const early = await refused([luis.partyId], [second, luis.tabId], [m7], () =>
      act((tx) => finishTable(tx, { partyId: luis.partyId, ...finishing })),
    );
    expect(early).toMatchObject({
      code: "party.bill_outstanding",
      params: { partyId: luis.partyId },
    });

    await pay(v, second, "30.00");
    const finish = await cmd(luis.partyId);
    await act((tx) => finishTable(tx, { partyId: luis.partyId, ...finish }));
    expect((await partyRow(v, luis.partyId)).state).toBe("closed");
  });
});

describe("A803 a paid bill kept on a party combined away is one of the table's bills", () => {
  /** The bills the party's bills read lists, abandoned ones left out, as the till shows them. */
  async function shownBills(partyId: string) {
    const bills = await act((tx) => readPartyBills(tx, partyId));
    return bills
      .filter((bill) => bill.status !== "abandoned")
      .map((bill) => ({ id: bill.workingOrderId, status: bill.status }));
  }

  /** Ana at `<prefix> 4` pays her only bill; Luis at `<prefix> 7` joins her table. */
  async function luisJoinsPaidAna(prefix: string) {
    const [m4, m7] = await tables(prefix, 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await pay(v, ana.tabId, "12.00");
    const joining = await opts(luis.partyId, ana.partyId);
    const result = await act((tx) => joinTables(tx, v.cfg, luis.partyId, m4, joining));
    return { ana, luis, m4, m7, result };
  }

  it("Move guests onto a seated table answers the moving party's paid bill among the bills", async () => {
    const [m4, m7] = await tables("Family move", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await pay(v, ana.tabId, "12.00");

    const moving = await opts(ana.partyId, luis.partyId);
    const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect(await shownBills(luis.partyId)).toEqual([
      { id: luis.tabId, status: "open" },
      { id: ana.tabId, status: "settled" },
    ]);
    expect(result).toEqual({ partyId: luis.partyId, billIds: [luis.tabId, ana.tabId] });
  });

  it("Join a seated table answers the joined party's paid bill among the bills", async () => {
    const { ana, luis, result } = await luisJoinsPaidAna("Family join");

    expect(await shownBills(luis.partyId)).toEqual([
      { id: luis.tabId, status: "open" },
      { id: ana.tabId, status: "settled" },
    ]);
    expect(result).toEqual({ partyId: luis.partyId, billIds: [luis.tabId, ana.tabId] });
  });

  it("Move guests and Join a free table afterwards still answer that paid bill", async () => {
    const { ana, luis } = await luisJoinsPaidAna("Family free");
    const [m9, m10] = await tables("Family free", 9, 10);

    const moving = await opts(luis.partyId);
    const moved = await act((tx) => moveGuests(tx, v.cfg, luis.partyId, m9, moving));
    await nextMillisecond();
    const joining = await opts(luis.partyId);
    const joined = await act((tx) => joinTables(tx, v.cfg, luis.partyId, m10, joining));

    expect(moved).toEqual({ partyId: luis.partyId, billIds: [luis.tabId, ana.tabId] });
    expect(joined).toEqual({ partyId: luis.partyId, billIds: [luis.tabId, ana.tabId] });
  });

  it("Split a table taking the staying party's last bill of its own makes no new bill while that paid bill is still shown", async () => {
    const { ana, luis, m4, m7 } = await luisJoinsPaidAna("Family split");

    const splitting = await cmd(luis.partyId);
    const result = await act((tx) =>
      splitTable(tx, v.cfg, luis.partyId, m4, luis.tabId, splitting),
    );

    expect(result).toEqual({ partyId: result.partyId, billId: luis.tabId });
    expect(await activeTablesOf(v, luis.partyId)).toEqual([m7]);
    expect(await shownBills(luis.partyId)).toEqual([{ id: ana.tabId, status: "settled" }]);
    expect(await partyRow(v, luis.partyId)).toMatchObject({
      revision: splitting.expectedPartyRevision + 1,
    });
  });

  it("Split a table taking the staying party's last bill gives it a new empty bill when its only other bill was merged away", async () => {
    const [m4, m5] = await tables("Family merged", 4, 5);
    const ana = await seat(v, m4);
    await joinFree(ana.partyId, m5);
    await order(v, ana.tabId, "Burger", "Vino");
    const b2 = await splitOff(ana.partyId, ana.tabId, [2]);
    const merging = await cmd(ana.partyId);
    await act((tx) => mergeBills(tx, v.cfg, b2, ana.tabId, merging));
    expect(await billRow(v, ana.tabId)).toMatchObject({ status: "abandoned" });

    const splitting = await cmd(ana.partyId);
    const result = await act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, b2, splitting));

    expect(result).toEqual({ partyId: result.partyId, billId: b2 });
    expect(await activeTablesOf(v, ana.partyId)).toEqual([m4]);
    const shown = await shownBills(ana.partyId);
    expect(shown).toEqual([{ id: expect.any(String), status: "open" }]);
    expect([ana.tabId, b2]).not.toContain(shown[0]!.id);
    expect(await linesOf(v, shown[0]!.id)).toEqual([]);
    expect(await partyRow(v, ana.partyId)).toMatchObject({
      revision: splitting.expectedPartyRevision + 1,
    });
  });

  it("Move guests answers one new empty bill for a party whose only bill is abandoned", async () => {
    const [m4, m9] = await tables("Family abandoned", 4, 9);
    const ana = await seat(v, m4);
    v.db.run(sql`update working_orders set status = 'abandoned' where id = ${ana.tabId}`);

    const moving = await opts(ana.partyId);
    const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m9, moving));

    const shown = await shownBills(ana.partyId);
    expect(shown).toEqual([{ id: expect.any(String), status: "open" }]);
    expect(shown[0]!.id).not.toBe(ana.tabId);
    expect(await linesOf(v, shown[0]!.id)).toEqual([]);
    expect(result).toEqual({ partyId: ana.partyId, billIds: [shown[0]!.id] });
  });
});

describe("MOVED notices for a paid bill left on a party combined away", () => {
  /** The paid bill's stored row, lines and payments, which combining its party must not change. */
  async function paidBill(billId: string) {
    return {
      row: await billRow(v, billId),
      lines: await lineRows(billId),
      payments: await paymentsOf(v, billId),
    };
  }

  it("tells the kitchen where a paid bill's sent dish went when its guests move to a held table", async () => {
    const [m4, m7] = await tables("PagoM", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await pay(v, ana.tabId, "12.00");
    const paid = await paidBill(ana.tabId);
    expect(paid.row).toMatchObject({ status: "settled", partyId: ana.partyId, label: "PagoM 4" });

    const moving = await opts(ana.partyId, luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect((await partyRow(v, ana.partyId)).mergedIntoPartyId).toBe(luis.partyId);
    expect(noticesOn([ana.tabId])).toEqual([
      { working_order_id: ana.tabId, kind: "moved", line_name: "BURG", moved_to: "PagoM 7" },
    ]);
    const onPass = boardCards(await act((tx) => readScopedPassBoard(tx, EVERY)))
      .flatMap((card) => card.orders)
      .find((entry) => entry.orderId === ana.tabId);
    expect(onPass?.tableLabel).toBe("PagoM 7");
    expect(await paidBill(ana.tabId)).toEqual(paid);
  });

  it("tells the kitchen nothing of a paid bill's sent dish when its table joins another party: it keeps its table and the name", async () => {
    const [m4, m7] = await tables("PagoJ", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await pay(v, ana.tabId, "12.00");
    const paid = await paidBill(ana.tabId);

    await nextMillisecond();
    const joining = await opts(luis.partyId, ana.partyId);
    await act((tx) => joinTables(tx, v.cfg, luis.partyId, m4, joining));

    expect((await partyRow(v, ana.partyId)).mergedIntoPartyId).toBe(luis.partyId);
    expect(noticesOn([ana.tabId])).toEqual([]);
    expect(await paidBill(ana.tabId)).toEqual(paid);
  });

  it("names the tables the guests went to, not the label the bill was paid under", async () => {
    const [m4, m5, m7] = await tables("PagoE", 4, 5, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await pay(v, ana.tabId, "12.00");
    const toFive = await opts(ana.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m5, toFive));
    const earlier = noticesOn([ana.tabId]);
    const paid = await paidBill(ana.tabId);
    // The bill still carries the label it was paid under, though its guests now sit at 5.
    expect(paid.row.label).toBe("PagoE 4");

    const moving = await opts(ana.partyId, luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect(noticesOn([ana.tabId])).toEqual([
      ...earlier,
      { working_order_id: ana.tabId, kind: "moved", line_name: "BURG", moved_to: "PagoE 7" },
    ]);
    expect(await paidBill(ana.tabId)).toEqual(paid);
  });

  it("tells the kitchen again when the party that took the guests moves on", async () => {
    const [m4, m7, m9] = await tables("PagoL", 4, 7, 9);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await pay(v, ana.tabId, "12.00");
    const moving = await opts(ana.partyId, luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));
    const earlier = noticesOn([ana.tabId]);
    const paid = await paidBill(ana.tabId);

    const onward = await opts(luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, luis.partyId, m9, onward));

    expect(noticesOn([ana.tabId])).toEqual([
      ...earlier,
      { working_order_id: ana.tabId, kind: "moved", line_name: "BURG", moved_to: "PagoL 9" },
    ]);
    expect(await paidBill(ana.tabId)).toEqual(paid);
  });

  it("tells the kitchen nothing of the paid bill when the party that took the guests splits off a table it joined", async () => {
    const [m4, m7, m9] = await tables("PagoS", 4, 7, 9);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await pay(v, ana.tabId, "12.00");
    const moving = await opts(ana.partyId, luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));
    const earlier = noticesOn([ana.tabId]);
    const paid = await paidBill(ana.tabId);

    await joinFree(luis.partyId, m9);
    const splitting = await cmd(luis.partyId);
    await act((tx) => splitTable(tx, v.cfg, luis.partyId, m9, null, splitting));

    expect(noticesOn([ana.tabId])).toEqual(earlier);
    expect(await paidBill(ana.tabId)).toEqual(paid);
  });

  it("follows two merges to the party still seated", async () => {
    const [m3, m4, m7, m9] = await tables("PagoC", 3, 4, 7, 9);
    const eva = await seat(v, m3);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, eva.tabId, "Burger");
    await pay(v, eva.tabId, "12.00");
    const first = await opts(eva.partyId, ana.partyId);
    await act((tx) => moveGuests(tx, v.cfg, eva.partyId, m4, first));
    const second = await opts(ana.partyId, luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, second));
    const earlier = noticesOn([eva.tabId]);
    const paid = await paidBill(eva.tabId);

    const onward = await opts(luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, luis.partyId, m9, onward));

    expect(earlier).toEqual([
      { working_order_id: eva.tabId, kind: "moved", line_name: "BURG", moved_to: "PagoC 4" },
      { working_order_id: eva.tabId, kind: "moved", line_name: "BURG", moved_to: "PagoC 7" },
    ]);
    expect(noticesOn([eva.tabId])).toEqual([
      ...earlier,
      { working_order_id: eva.tabId, kind: "moved", line_name: "BURG", moved_to: "PagoC 9" },
    ]);
    expect((await paidBill(eva.tabId)).row.partyId).toBe(eva.partyId);
    expect(await paidBill(eva.tabId)).toEqual(paid);
  });
});

describe("kitchen groups when parties combine", () => {
  it("gives the incoming party's groups, held and fired, to the receiving party after its last, in their own order and state", async () => {
    const [m4, m7] = await tables("Grupos", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await sendGroups(luis.partyId, [{ names: ["Agua"], release: "fire" }]);
    await sendGroups(ana.partyId, [
      { names: ["Burger"], release: "fire" },
      { names: ["Flan"], release: "hold" },
    ]);
    const luisGroups = await groupsOf(luis.partyId);
    const anaGroups = await groupsOf(ana.partyId);
    const anaLines = await linesOf(v, ana.tabId);
    expect(anaGroups.map((group) => group.state)).toEqual(["fired", "held"]);

    const moving = await opts(ana.partyId, luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    const last = luisGroups.at(-1)!.position;
    expect(await groupsOf(luis.partyId)).toEqual([
      ...luisGroups,
      { id: anaGroups[0]!.id, state: "fired", position: last + 1 },
      { id: anaGroups[1]!.id, state: "held", position: last + 2 },
    ]);
    expect(await groupsOf(ana.partyId)).toEqual([]);
    expect(await linesOf(v, ana.tabId)).toEqual(anaLines);
    expect(anaLines[1]!.groupId).toBe(anaGroups[1]!.id);
  });
});

describe("drafts when parties combine", () => {
  it("keeps the operator's draft on each bill, both now on the receiving party", async () => {
    const [m4, m7] = await tables("Borrador", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    for (const [partyId, billId, dish] of [
      [ana.partyId, ana.tabId, "Flan"],
      [luis.partyId, luis.tabId, "Agua"],
    ] as const) {
      await act((tx) =>
        saveDraft(tx, v.cfg, partyId, OPERATOR, {
          billId,
          draftId: null,
          revision: 0,
          lines: [{ menuItemId: v.item(dish), quantity: "1" }],
        }),
      );
    }

    const moving = await opts(ana.partyId, luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    const drafts = await act((tx) => readDrafts(tx, v.cfg, luis.partyId));
    expect(
      drafts
        .map((draft) => ({
          partyId: draft.partyId,
          billId: draft.billId,
          ownerId: draft.ownerId,
          items: draft.lines.map((line) => line.menuItemId),
        }))
        .sort((a, b) => a.billId.localeCompare(b.billId)),
    ).toEqual(
      [
        { partyId: luis.partyId, billId: ana.tabId, ownerId: OPERATOR, items: [v.item("Flan")] },
        { partyId: luis.partyId, billId: luis.tabId, ownerId: OPERATOR, items: [v.item("Agua")] },
      ].sort((a, b) => a.billId.localeCompare(b.billId)),
    );
  });
});

describe("join tables", () => {
  it("joins a free table: both tables stay", async () => {
    const [m4, m5] = await tables("Junta", 4, 5);
    const ana = await seat(v, m4);
    await nextMillisecond();

    const joining = await opts(ana.partyId);
    const result = await act((tx) => joinTables(tx, v.cfg, ana.partyId, m5, joining));

    expect(result).toEqual({ partyId: ana.partyId, billIds: [ana.tabId] });
    expect(await activeTablesOf(v, ana.partyId)).toEqual([m4, m5]);
    expect((await partyRow(v, ana.partyId)).revision).toBe(joining.expectedPartyRevision + 1);
  });

  it("gives the tables it brings in join times in the order they joined the other party", async () => {
    const [m4, m7, m8, m9] = await tables("Orden", 4, 7, 8, 9);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await joinFree(luis.partyId, m8);
    await joinFree(luis.partyId, m9);

    const joining = await opts(ana.partyId, luis.partyId);
    await act((tx) => joinTables(tx, v.cfg, ana.partyId, m8, joining));

    const joinedAt = async (tableId: string) =>
      (
        await act((tx) =>
          tx
            .select({ joinedAt: partyTables.joinedAt })
            .from(partyTables)
            .where(and(eq(partyTables.partyId, ana.partyId), eq(partyTables.tableId, tableId))),
        )
      )[0]!.joinedAt;
    const times = [await joinedAt(m4), await joinedAt(m7), await joinedAt(m8), await joinedAt(m9)];
    expect(times).toEqual([...times].sort());
    expect(new Set(times).size).toBe(times.length);
    expect(await activeTablesOf(v, ana.partyId)).toEqual([m4, m7, m8, m9]);
  });

  it("combines the party at a held table into this one, with all of its tables, and every bill stays its own", async () => {
    const [m4, m7, m8] = await tables("Juntar", 4, 7, 8);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await joinFree(luis.partyId, m8);
    await order(v, ana.tabId, "Burger");
    await order(v, luis.tabId, "Agua");

    const joining = await opts(ana.partyId, luis.partyId);
    const result = await act((tx) => joinTables(tx, v.cfg, ana.partyId, m7, joining));

    expect(result).toEqual({ partyId: ana.partyId, billIds: [ana.tabId, luis.tabId] });
    expect(await activeTablesOf(v, ana.partyId)).toEqual([m4, m7, m8]);
    expect(await activeTablesOf(v, luis.partyId)).toEqual([]);
    expect(await partyRow(v, luis.partyId)).toMatchObject({
      state: "closed",
      mergedIntoPartyId: ana.partyId,
    });
    expect((await linesOf(v, ana.tabId)).map((l) => l.name)).toEqual(["Burger"]);
    expect((await linesOf(v, luis.tabId)).map((l) => l.name)).toEqual(["Agua"]);
    expect(await billRow(v, luis.tabId)).toMatchObject({ status: "open", partyId: ana.partyId });
    expect(await numbersOf(v, ana.partyId)).toEqual([
      [ana.tabId, 1, null],
      [luis.tabId, 2, null],
    ]);
    for (const joined of [m7, m8]) {
      expect(await tableRow(v, joined)).toMatchObject({
        needsClearingSince: null,
      });
    }
  });

  it("keeps the bills separate", async () => {
    const [m4, m7] = await tables("Aparte", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await order(v, luis.tabId, "Agua");

    const joining = await opts(ana.partyId, luis.partyId);
    const result = await act((tx) => joinTables(tx, v.cfg, ana.partyId, m7, joining));

    expect(result).toEqual({ partyId: ana.partyId, billIds: [ana.tabId, luis.tabId] });
    expect(await billRow(v, luis.tabId)).toMatchObject({ status: "open", partyId: ana.partyId });
    expect(await openingBillOfParty(v, ana.partyId)).toBe(ana.tabId);
  });

  describe("what it refuses, changing nothing", () => {
    it("refuses a table in another zone", async () => {
      const [m4] = await tables("Otra zona", 4);
      const terrace = await v.table("Otra zona T5", terraceZone);
      const held = await v.table("Otra zona T6", terraceZone);
      const ana = await seat(v, m4);
      const luis = await seat(v, held);
      const joiningFree = await opts(ana.partyId);
      const joining = await opts(ana.partyId, luis.partyId);

      const free = await refused([ana.partyId], [ana.tabId], [m4, terrace], () =>
        act((tx) => joinTables(tx, v.cfg, ana.partyId, terrace, joiningFree)),
      );
      const other = await refused(
        [ana.partyId, luis.partyId],
        [ana.tabId, luis.tabId],
        [m4, held],
        () => act((tx) => joinTables(tx, v.cfg, ana.partyId, held, joining)),
      );

      for (const [error, tableZone] of [
        [free, terraceZone],
        [other, terraceZone],
      ] as const) {
        expect(error).toMatchObject({
          code: "service_zone.join_mismatch",
          params: { orderZoneId: v.tables.zoneId, tableZoneId: tableZone },
        });
      }
    });

    it("refuses a table the party holds", async () => {
      const [m4, m5] = await tables("Tiene", 4, 5);
      const ana = await seat(v, m4);
      await joinFree(ana.partyId, m5);
      const joining = await opts(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId], [m4, m5], () =>
        act((tx) => joinTables(tx, v.cfg, ana.partyId, m5, joining)),
      );

      expect(error).toMatchObject({ code: "table.already_in_party", params: { tableId: m5 } });
    });

    it("refuses a table that needs clearing", async () => {
      const [m4, dirty] = await tables("Recoger", 4, 5);
      const ana = await seat(v, m4);
      await needsClearing(dirty);
      const joining = await opts(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId], [m4, dirty], () =>
        act((tx) => joinTables(tx, v.cfg, ana.partyId, dirty, joining)),
      );

      expect(error).toMatchObject({ code: "table.needs_clearing", params: { tableId: dirty } });
    });

    it("refuses a table that needs moving", async () => {
      const { tableId, spare } = await needingMoving(v);
      const ana = await seat(v, spare);
      const joining = await opts(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId], [spare, tableId], () =>
        act((tx) => joinTables(tx, v.cfg, ana.partyId, tableId, joining)),
      );

      expect(error).toMatchObject({ code: "table.needs_moving", params: { tableId } });
    });
  });
});

describe("split a table", () => {
  /** Ana at `<prefix> 4` and `<prefix> 5`, her Bill 1 (Burger) and a split bill B2 (Vino). */
  async function anaAtTwo(prefix: string) {
    const [m4, m5] = await tables(prefix, 4, 5);
    const ana = await seat(v, m4);
    await joinFree(ana.partyId, m5);
    await order(v, ana.tabId, "Burger", "Vino");
    const b2 = await splitOff(ana.partyId, ana.tabId, [2]);
    return { ana, m4, m5, b2 };
  }

  it("starts a new unnamed party on the table with the chosen bill as its Bill 1", async () => {
    const { ana, m4, m5, b2 } = await anaAtTwo("Separa");

    const splitting = await cmd(ana.partyId);
    const result = await act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, b2, splitting));

    expect(result.partyId).not.toBe(ana.partyId);
    expect(result).toEqual({ partyId: result.partyId, billId: b2 });
    expect(await numbersOf(v, result.partyId)).toEqual([[b2, 1, null]]);
    expect(await partyRow(v, result.partyId)).toMatchObject({
      name: null,
      state: "open",
    });
    expect(await openingBillOfParty(v, result.partyId)).toBe(b2);
    expect(await activeTablesOf(v, result.partyId)).toEqual([m5]);
    expect(await billRow(v, b2)).toMatchObject({ partyId: result.partyId, status: "open" });
    expect(await activeTablesOf(v, ana.partyId)).toEqual([m4]);
    expect(await openingBillOfParty(v, ana.partyId)).toBe(ana.tabId);
    expect(await partyRow(v, ana.partyId)).toMatchObject({
      revision: splitting.expectedPartyRevision + 1,
    });
    expect(await zoneOf(v, b2)).toBe(v.tables.zoneId);
  });

  it("gives the new party a new, empty Bill 1 at once when no bill is chosen", async () => {
    const { ana, m5 } = await anaAtTwo("Vacia");

    const splitting = await cmd(ana.partyId);
    const result = await act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, null, splitting));

    expect(result).toEqual({ partyId: result.partyId, billId: expect.any(String) });
    const main = await billRow(v, result.billId);
    expect(main).toMatchObject({ partyId: result.partyId, status: "open" });
    expect(await linesOf(v, main.id)).toEqual([]);
    expect(await openingBillOfParty(v, result.partyId)).toBe(main.id);
    expect(await numbersOf(v, result.partyId)).toEqual([[main.id, 1, null]]);
    expect(await zoneOf(v, main.id)).toBe(v.tables.zoneId);
  });

  it("moves a presented bill, still placed with its lines unchanged but for their group, and the new party opens on it", async () => {
    const [m4, m5] = await tables("Presentada", 4, 5);
    const ana = await seat(v, m4);
    await joinFree(ana.partyId, m5);
    await sendGroups(ana.partyId, [{ names: ["Burger", "Vino", "Flan"], release: "fire" }]);
    const b2 = await splitOff(ana.partyId, ana.tabId, [2, 3]);
    await placeByHand(v, b2);
    const lines = await lineRows(b2);
    const tickets = await ticketsOf(b2);
    expect(lines.map((line) => line.groupId)).toEqual([expect.any(String), expect.any(String)]);

    const splitting = await cmd(ana.partyId);
    const result = await act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, b2, splitting));

    expect(result).toEqual({ partyId: result.partyId, billId: b2 });
    expect(await billRow(v, b2)).toMatchObject({ status: "placed", partyId: result.partyId });
    const [arrived] = await groupsOf(result.partyId);
    expect(await lineRows(b2)).toEqual(lines.map((line) => ({ ...line, groupId: arrived!.id })));
    expect(await ticketsOf(b2)).toEqual(tickets);
    expect(await openingBillOfParty(v, result.partyId)).toBe(b2);
    const { tabId } = await orderForParty(v, result.partyId, ["Agua"]);
    expect(tabId).not.toBe(b2);
    expect(await numbersOf(v, result.partyId)).toEqual([
      [b2, 1, null],
      [tabId, 2, null],
    ]);
    expect((await billRow(v, tabId)).status).toBe("open");
  });

  it("takes the party's first bill, once refused as its main, like any other: Bill 1 at the new party", async () => {
    const { ana, m4, m5, b2 } = await anaAtTwo("Principal S");
    const splitting = await cmd(ana.partyId);

    const result = await act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, ana.tabId, splitting));

    expect(result).toEqual({ partyId: result.partyId, billId: ana.tabId });
    expect(await billRow(v, ana.tabId)).toMatchObject({ status: "open", partyId: result.partyId });
    expect(await numbersOf(v, result.partyId)).toEqual([[ana.tabId, 1, null]]);
    expect(await numbersOf(v, ana.partyId)).toEqual([[b2, 2, null]]);
    expect(await activeTablesOf(v, ana.partyId)).toEqual([m4]);
    expect(await activeTablesOf(v, result.partyId)).toEqual([m5]);
  });

  it("takes sent dishes out of their group into one of the new party's, keeping their ticket state", async () => {
    const [m4, m5] = await tables("Enviada", 4, 5);
    const ana = await seat(v, m4);
    await joinFree(ana.partyId, m5);
    await sendGroups(ana.partyId, [{ names: ["Burger", "Vino"], release: "fire" }]);
    const b2 = await splitOff(ana.partyId, ana.tabId, [2]);
    const lines = await lineRows(b2);
    const tickets = await ticketsOf(b2);
    expect(lines[0]!.groupId).not.toBeNull();
    expect(tickets[0]!.firedAt).not.toBeNull();

    const splitting = await cmd(ana.partyId);
    const result = await act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, b2, splitting));

    const [arrived] = await groupsOf(result.partyId);
    expect(await lineRows(b2)).toEqual(lines.map((line) => ({ ...line, groupId: arrived!.id })));
    expect(await ticketsOf(b2)).toEqual(tickets);
  });

  describe("what it refuses, changing nothing", () => {
    it("refuses the party's only table", async () => {
      const [m4] = await tables("Unica", 4);
      const ana = await seat(v, m4);
      const splitting = await cmd(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId], [m4], () =>
        act((tx) => splitTable(tx, v.cfg, ana.partyId, m4, null, splitting)),
      );

      expect(error).toMatchObject({
        code: "table.not_shared",
        params: { tableId: m4, partyId: ana.partyId },
      });
    });

    it("refuses a table not in the party", async () => {
      const { ana, m4, m5, b2 } = await anaAtTwo("Fuera");
      const [elsewhere] = await tables("Fuera otra", 9);
      const splitting = await cmd(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId, b2], [m4, m5, elsewhere], () =>
        act((tx) => splitTable(tx, v.cfg, ana.partyId, elsewhere, b2, splitting)),
      );

      expect(error).toMatchObject({
        code: "table.not_joined",
        params: { tableId: elsewhere, partyId: ana.partyId },
      });
    });

    it("refuses a paid bill", async () => {
      const { ana, m4, m5, b2 } = await anaAtTwo("Cobrada");
      await pay(v, b2, "30.00");
      const splitting = await cmd(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId, b2], [m4, m5], () =>
        act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, b2, splitting)),
      );

      expect(error).toMatchObject({ code: "bill.paid", params: { workingOrderId: b2 } });
    });

    it("refuses another party's bill", async () => {
      const { ana, m4, m5, b2 } = await anaAtTwo("Ajena");
      const [m7] = await tables("Ajena otra", 7);
      const luis = await seat(v, m7);
      const splitting = await cmd(ana.partyId);

      const error = await refused(
        [ana.partyId, luis.partyId],
        [ana.tabId, b2, luis.tabId],
        [m4, m5],
        () => act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, luis.tabId, splitting)),
      );

      expect(error).toMatchObject({
        code: "bill.other_party",
        params: { workingOrderId: luis.tabId },
      });
    });

    it("refuses an abandoned bill, and one that does not exist, as not open", async () => {
      const { ana, m4, m5, b2 } = await anaAtTwo("Abandonada");
      const b3 = await splitOff(ana.partyId, ana.tabId, [1]);
      v.db.run(sql`update working_orders set status = 'abandoned' where id = ${b3}`);
      const missing = randomUUID();
      const splitting = await cmd(ana.partyId);

      const abandoned = await refused([ana.partyId], [ana.tabId, b2, b3], [m4, m5], () =>
        act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, b3, splitting)),
      );
      const absent = await refused([ana.partyId], [ana.tabId, b2], [m4, m5], () =>
        act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, missing, splitting)),
      );

      expect(abandoned).toMatchObject({ code: "tab.not_open", params: { tabId: b3 } });
      expect(absent).toMatchObject({ code: "tab.not_open", params: { tabId: missing } });
    });
  });

  it("A803 waiting copy: Split a table takes a bill holding a dish held for the kitchen, and the new party holds its own copy of the group", async () => {
    const { ana, m5, b2 } = await anaAtTwo("Retenida");
    await sendGroups(ana.partyId, [{ names: ["Flan"], release: "hold" }], b2);
    const flanBefore = (await lineRows(b2)).find((line) => line.lineNo === 2)!;
    const source = flanBefore.groupId!;
    const flanTicket = () =>
      act((tx) =>
        tx.select().from(ticketItems).where(eq(ticketItems.workingOrderLineId, flanBefore.id)),
      );
    const ticketBefore = await flanTicket();
    expect(ticketBefore).toMatchObject([{ firedAt: null }]);
    const splitting = await cmd(ana.partyId);

    const result = await act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, b2, splitting));

    expect(result.billId).toBe(b2);
    expect(result.partyId).not.toBe(ana.partyId);
    expect((await billRow(v, b2)).partyId).toBe(result.partyId);
    const flan = (await lineRows(b2)).find((line) => line.id === flanBefore.id)!;
    expect(flan.groupId).not.toBeNull();
    expect(flan.groupId).not.toBe(source);
    const groupOf = async (id: string) =>
      (await act((tx) => tx.select().from(orderGroups).where(eq(orderGroups.id, id))))[0];
    expect(await groupOf(flan.groupId!)).toMatchObject({
      partyId: result.partyId,
      state: "held",
      firedAt: null,
    });
    expect(await groupOf(source)).toMatchObject({ partyId: ana.partyId, state: "removed" });
    const removed = await act((tx) =>
      tx
        .select({ partyId: orderGroupEvents.partyId, actorId: orderGroupEvents.actorId })
        .from(orderGroupEvents)
        .where(and(eq(orderGroupEvents.groupId, source), eq(orderGroupEvents.kind, "removed"))),
    );
    expect(removed).toEqual([{ partyId: ana.partyId, actorId: OPERATOR }]);
    expect(await flanTicket()).toEqual(ticketBefore);
  });
});

describe("MOVED notices after a table action", () => {
  it("tells the kitchen nothing of a party that joins a free table, nor of another party's", async () => {
    const [m4, m5, m7] = await tables("AvisoJ", 4, 5, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Paella", "Burger");
    const b2 = await splitOff(ana.partyId, ana.tabId, [2]);
    await order(v, luis.tabId, "Tarta");
    const anaNotices = noticesOn([ana.tabId, b2]);
    const luisNotices = noticesOn([luis.tabId]);

    await joinFree(ana.partyId, m5);

    expect(noticesOn([ana.tabId, b2])).toEqual(anaNotices);
    expect(noticesOn([luis.tabId])).toEqual(luisNotices);
  });

  it("tells the kitchen of the split bill's dishes at the split table, and nothing of the dishes that stayed", async () => {
    const [m4, m5] = await tables("AvisoS", 4, 5);
    const ana = await seat(v, m4);
    await joinFree(ana.partyId, m5);
    await order(v, ana.tabId, "Paella", "Burger");
    const b2 = await splitOff(ana.partyId, ana.tabId, [2]);
    const earlier = noticesOn([ana.tabId, b2]);

    const splitting = await cmd(ana.partyId);
    await act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, b2, splitting));

    expect(noticesOn([ana.tabId, b2])).toEqual([
      ...earlier,
      { working_order_id: b2, kind: "moved", line_name: "BURG", moved_to: "AvisoS 5" },
    ]);
  });

  it("tells the kitchen once of a sent dish when parties combine, on the bill it stays on", async () => {
    const [m4, m7] = await tables("AvisoM", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await order(v, luis.tabId, "Tarta");
    const luisNotices = noticesOn([luis.tabId]);

    const moving = await opts(ana.partyId, luis.partyId);
    const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect(result).toEqual({ partyId: luis.partyId, billIds: [luis.tabId, ana.tabId] });
    expect(await billRow(v, ana.tabId)).toMatchObject({ status: "open", partyId: luis.partyId });
    expect(noticesOn([ana.tabId, luis.tabId])).toEqual([
      ...luisNotices,
      { working_order_id: ana.tabId, kind: "moved", line_name: "BURG", moved_to: "AvisoM 7" },
    ]);
  });
});

describe("two tills at once", () => {
  for (const first of ["move", "join"] as const) {
    it(`refuses the second of a move and a join of one party (${first} first)`, async () => {
      const [m4, m6, m9] = await tables(`Dos tills ${first}`, 4, 6, 9);
      const ana = await seat(v, m4);
      const read = await opts(ana.partyId);
      await nextMillisecond();
      const moveIt = () => act((tx) => moveGuests(tx, v.cfg, ana.partyId, m9, read));
      const joinIt = () => act((tx) => joinTables(tx, v.cfg, ana.partyId, m6, read));
      const [winner, loser] = first === "move" ? [moveIt, joinIt] : [joinIt, moveIt];

      await winner();
      const error = await refused([ana.partyId], [ana.tabId], [m4, m6, m9], loser);

      expect(error).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: ana.partyId, revision: read.expectedPartyRevision + 1 },
      });
      expect(await activeTablesOf(v, ana.partyId)).toEqual(first === "move" ? [m9] : [m4, m6]);
    });
  }

  for (const first of ["move", "split"] as const) {
    it(`refuses the second of a move into a party and a split of that party's table (${first} first)`, async () => {
      const [m4, m7, m8] = await tables(`Dos parties ${first}`, 4, 7, 8);
      const ana = await seat(v, m4);
      const luis = await seat(v, m7);
      await joinFree(luis.partyId, m8);
      const moving = await opts(ana.partyId, luis.partyId);
      const splitting = await cmd(luis.partyId);
      const moveIt = () => act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));
      const splitIt = () => act((tx) => splitTable(tx, v.cfg, luis.partyId, m8, null, splitting));
      const [winner, loser] = first === "move" ? [moveIt, splitIt] : [splitIt, moveIt];

      await winner();
      const error = await refused(
        [ana.partyId, luis.partyId],
        [ana.tabId, luis.tabId],
        [m4, m7, m8],
        loser,
      );

      expect(error).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: luis.partyId, revision: splitting.expectedPartyRevision + 1 },
      });
    });
  }
});

describe("a request read against a party that has since left the target table", () => {
  for (const [name, act_] of [
    ["move guests", moveGuests],
    ["join tables", joinTables],
  ] as const) {
    it(`${name}: refuses it when another party now holds the table, though its revision matches`, async () => {
      const [m4, m7, m9] = await tables(`Extraña ${name}`, 4, 7, 9);
      const source = await seat(v, m4);
      const target = await seat(v, m7);
      await order(v, source.tabId, "Burger");
      const stale = await opts(source.partyId, target.partyId);
      const leaving = await opts(target.partyId);
      await act((tx) => moveGuests(tx, v.cfg, target.partyId, m9, leaving));
      const stranger = await seat(v, m7);
      await order(v, stranger.tabId, "Tarta");
      // The probe: without this the stale revision would be refused whichever party it named.
      expect(await revisionOf(v, stranger.partyId)).toBe(stale.expectedOtherPartyRevision);

      const error = await refused(
        [source.partyId, target.partyId, stranger.partyId],
        [source.tabId, target.tabId, stranger.tabId],
        [m4, m7, m9],
        () => act((tx) => act_(tx, v.cfg, source.partyId, m7, stale)),
      );

      expect(error).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: target.partyId, revision: await revisionOf(v, target.partyId) },
      });
      expect((await linesOf(v, stranger.tabId)).map((l) => l.name)).toEqual(["Tarta"]);
    });

    it(`${name}: refuses it when the table is now free`, async () => {
      const [m4, m7, m9] = await tables(`Vacía ${name}`, 4, 7, 9);
      const source = await seat(v, m4);
      const target = await seat(v, m7);
      const stale = await opts(source.partyId, target.partyId);
      const leaving = await opts(target.partyId);
      await act((tx) => moveGuests(tx, v.cfg, target.partyId, m9, leaving));
      expect(await partyAt(v, m7)).toBeNull();

      const error = await refused(
        [source.partyId, target.partyId],
        [source.tabId, target.tabId],
        [m4, m7, m9],
        () => act((tx) => act_(tx, v.cfg, source.partyId, m7, stale)),
      );

      expect(error).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: target.partyId, revision: await revisionOf(v, target.partyId) },
      });
    });

    it(`${name}: refuses another party's revision sent without naming that party`, async () => {
      const [m4, m7] = await tables(`Sin nombre ${name}`, 4, 7);
      const source = await seat(v, m4);
      const target = await seat(v, m7);
      const { otherPartyId, ...unnamed } = await opts(source.partyId, target.partyId);
      expect(otherPartyId).toBe(target.partyId);

      const error = await refused(
        [source.partyId, target.partyId],
        [source.tabId, target.tabId],
        [m4, m7],
        () => act((tx) => act_(tx, v.cfg, source.partyId, m7, unnamed)),
      );

      expect(error).toMatchObject({
        code: "management.request_invalid",
        params: { field: "otherPartyId" },
      });
    });

    it(`${name}: refuses a table read free that a party now holds, as out of date for that party`, async () => {
      const [m4, m7] = await tables(`Leída libre ${name}`, 4, 7);
      const source = await seat(v, m4);
      const target = await seat(v, m7);
      const readFree = { ...(await opts(source.partyId)), otherPartyId: null };

      const error = await refused(
        [source.partyId, target.partyId],
        [source.tabId, target.tabId],
        [m4, m7],
        () => act((tx) => act_(tx, v.cfg, source.partyId, m7, readFree)),
      );

      expect(error).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: target.partyId, revision: await revisionOf(v, target.partyId) },
      });
    });

    it(`${name}: refuses a table read free sent with another party's revision`, async () => {
      const [m4, m7] = await tables(`Libre con revisión ${name}`, 4, 7);
      const source = await seat(v, m4);
      const contradictory = {
        ...(await opts(source.partyId)),
        otherPartyId: null,
        expectedOtherPartyRevision: 3,
      };

      const error = await refused([source.partyId], [source.tabId], [m4, m7], () =>
        act((tx) => act_(tx, v.cfg, source.partyId, m7, contradictory)),
      );

      expect(error).toMatchObject({
        code: "management.request_invalid",
        params: { field: "otherPartyId" },
      });
    });
  }
});

describe("a party combined into another (Review Focus 3)", () => {
  it("refuses every action on it as not open, even one sent with a stale revision", async () => {
    const [m4, m7, m8, m9] = await tables("Cerrada", 4, 7, 8, 9);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    const stale = await opts(ana.partyId);
    const moving = await opts(ana.partyId, luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));
    const current = await opts(ana.partyId);

    for (const sent of [current, stale]) {
      const attempts: (() => Promise<unknown>)[] = [
        () => act((tx) => moveGuests(tx, v.cfg, ana.partyId, m9, sent)),
        () => act((tx) => joinTables(tx, v.cfg, ana.partyId, m8, sent)),
        () => act((tx) => splitTable(tx, v.cfg, ana.partyId, m4, null, sent)),
        () =>
          act((tx) =>
            setPartyName(tx, {
              partyId: ana.partyId,
              name: "Ana",
              expectedPartyRevision: sent.expectedPartyRevision,
            }),
          ),
      ];
      for (const attempt of attempts) {
        const error = await refused(
          [ana.partyId, luis.partyId],
          [ana.tabId, luis.tabId],
          [m4, m7, m8, m9],
          attempt,
        );
        expect(error).toMatchObject({ code: "party.not_open", params: { partyId: ana.partyId } });
      }
    }
  });
});

describe("combineParties", () => {
  it("answers no bill merged away: every bill stays its own", async () => {
    const [m4, m7] = await tables("Combina", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await nextMillisecond();

    const result = await act((tx) =>
      combineParties(tx, v.cfg, {
        from: ana.partyId,
        into: luis.partyId,
        tables: "join",
        operatorId: OPERATOR,
      }),
    );

    expect(result).toBeUndefined();
    expect(await openingBillOfParty(v, luis.partyId)).toBe(luis.tabId);
    expect(await billRow(v, ana.tabId)).toMatchObject({ status: "open", partyId: luis.partyId });
    expect(await numbersOf(v, luis.partyId)).toEqual([
      [luis.tabId, 1, null],
      [ana.tabId, 2, null],
    ]);
    expect(await activeTablesOf(v, luis.partyId)).toEqual([m7, m4]);
  });
});

describe("guest counts when parties combine", () => {
  it.each(["merge", "separate"] as const)(
    "a join adds the joined party's guests to the receiving party's (%s row: both rows send the same request now that no bill choice exists)",
    async (bills) => {
      const [m4, m7] = await tables(`Comensales juntar ${bills}`, 4, 7);
      const ana = await seat(v, m4, 3);
      const luis = await seat(v, m7, 2);

      const joining = await opts(ana.partyId, luis.partyId);
      await act((tx) => joinTables(tx, v.cfg, ana.partyId, m7, joining));

      expect((await partyRow(v, ana.partyId)).guestCount).toBe(5);
      expect((await partyRow(v, luis.partyId)).guestCount).toBe(2);
    },
  );

  it.each(["merge", "separate"] as const)(
    "moving guests onto a seated table adds them to its party's (%s row: both rows send the same request now that no bill choice exists)",
    async (bills) => {
      const [m4, m7] = await tables(`Comensales mover ${bills}`, 4, 7);
      const ana = await seat(v, m4, 2);
      const luis = await seat(v, m7, 3);

      const moving = await opts(ana.partyId, luis.partyId);
      await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

      expect((await partyRow(v, luis.partyId)).guestCount).toBe(5);
      expect((await partyRow(v, ana.partyId)).guestCount).toBe(2);
    },
  );

  it.each([
    [2, null],
    [null, 3],
    [null, null],
    [999, 999],
    [500, 500],
  ])("from %j into %j leaves the receiving party with no count", async (fromCount, intoCount) => {
    const [m4, m7] = await tables(`Comensales ${fromCount} ${intoCount}`, 4, 7);
    const from = await seat(v, m4, fromCount);
    const into = await seat(v, m7, intoCount);

    await act((tx) =>
      combineParties(tx, v.cfg, {
        from: from.partyId,
        into: into.partyId,
        tables: "join",
        operatorId: OPERATOR,
      }),
    );

    expect((await partyRow(v, into.partyId)).guestCount).toBeNull();
    expect((await partyRow(v, from.partyId)).guestCount).toBe(fromCount);
  });

  it("keeps a sum of exactly the largest count", async () => {
    const [m4, m7] = await tables("Comensales tope", 4, 7);
    const from = await seat(v, m4, 499);
    const into = await seat(v, m7, 500);

    await act((tx) =>
      combineParties(tx, v.cfg, {
        from: from.partyId,
        into: into.partyId,
        tables: "leave",
        operatorId: OPERATOR,
      }),
    );

    expect((await partyRow(v, into.partyId)).guestCount).toBe(999);
  });
});

describe("A803 no main bill (join)", () => {
  it("joining a seated table whose party has an untouched bill of the same mode keeps both parties' bills, each with its own number and lines", async () => {
    const [m4, m7] = await tables("A803 Junta", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await order(v, luis.tabId, "Agua");
    const receivingBefore = await lineRows(ana.tabId);
    const incomingBefore = await lineRows(luis.tabId);

    const joining = await opts(ana.partyId, luis.partyId);
    const result = await act((tx) => joinTables(tx, v.cfg, ana.partyId, m7, joining));

    expect(result).toEqual({ partyId: ana.partyId, billIds: [ana.tabId, luis.tabId] });
    for (const billId of [ana.tabId, luis.tabId]) {
      const row = await billRow(v, billId);
      expect({ partyId: row.partyId, status: row.status }).toEqual({
        partyId: ana.partyId,
        status: "open",
      });
    }
    expect(await lineRows(ana.tabId)).toEqual(receivingBefore);
    expect((await lineRows(luis.tabId)).map((line) => [line.id, line.name])).toEqual(
      incomingBefore.map((line) => [line.id, line.name]),
    );
    expect(await numbersOf(v, ana.partyId)).toEqual([
      [ana.tabId, 1, null],
      [luis.tabId, 2, null],
    ]);
    expect(await activeTablesOf(v, ana.partyId)).toEqual([m4, m7]);
  });

  it("Move guests onto a seated table keeps every bill and every payment on its own bill", async () => {
    const [m4, m7] = await tables("A803 Mover", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger", "Vino");
    const second = await splitOff(ana.partyId, ana.tabId, [2]);
    await order(v, luis.tabId, "Agua");
    await cashContribution(v, second, "5.00");
    const bills = [luis.tabId, ana.tabId, second];
    const paymentsBefore = [];
    for (const billId of bills) paymentsBefore.push(await paymentsOf(v, billId));
    expect(paymentsBefore.map((payments) => payments.length)).toEqual([0, 0, 1]);
    const receivingBefore = await lineRows(luis.tabId);

    const moving = await opts(ana.partyId, luis.partyId);
    const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect(result).toEqual({ partyId: luis.partyId, billIds: bills });
    const paymentsAfter = [];
    for (const billId of bills) paymentsAfter.push(await paymentsOf(v, billId));
    expect(paymentsAfter).toEqual(paymentsBefore);
    for (const billId of bills) {
      const row = await billRow(v, billId);
      expect({ partyId: row.partyId, status: row.status }).toEqual({
        partyId: luis.partyId,
        status: "open",
      });
    }
    expect(await lineRows(luis.tabId)).toEqual(receivingBefore);
    expect((await linesOf(v, ana.tabId)).map((l) => l.name)).toEqual(["Burger"]);
    expect((await linesOf(v, second)).map((l) => l.name)).toEqual(["Vino"]);
    expect(await numbersOf(v, luis.partyId)).toEqual([
      [luis.tabId, 1, null],
      [ana.tabId, 2, null],
      [second, 3, null],
    ]);
  });

  it("the kitchen hears only that dishes moved table, never a merge", async () => {
    const [m4, m7] = await tables("A803 Aviso", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await order(v, luis.tabId, "Tarta");
    const before = noticesOn([ana.tabId, luis.tabId]);

    const moving = await opts(ana.partyId, luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect((await billRow(v, ana.tabId)).status).toBe("open");
    expect(noticesOn([ana.tabId, luis.tabId])).toEqual([
      ...before,
      { working_order_id: ana.tabId, kind: "moved", line_name: "BURG", moved_to: "A803 Aviso 7" },
    ]);
  });

  it("a move onto a seated table inside an outer slip window tells the kitchen once", async () => {
    const [m4, m7] = await tables("A803 Outer", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await order(v, luis.tabId, "Tarta");
    const before = noticesOn([ana.tabId, luis.tabId]);

    const moving = await opts(ana.partyId, luis.partyId);
    await act((tx) =>
      withMovedSlips(tx, v.cfg, { parties: [ana.partyId, luis.partyId] }, (slips) =>
        moveGuests(tx, v.cfg, ana.partyId, m7, { ...moving, slipsLater: slips }),
      ),
    );

    expect(noticesOn([ana.tabId, luis.tabId])).toEqual([
      ...before,
      { working_order_id: ana.tabId, kind: "moved", line_name: "BURG", moved_to: "A803 Outer 7" },
    ]);
  });
});

describe("A803 split", () => {
  const whole = (...wholeBillIds: string[]) => ({ wholeBillIds, loose: [] });

  /** Ana at `<prefix> 4` and `<prefix> 5`: Bill 1 Burger, Bill 2 Vino, Bill 3 Flan. */
  async function threeBills(prefix: string) {
    const [m4, m5] = await tables(prefix, 4, 5);
    const ana = await seat(v, m4);
    await joinFree(ana.partyId, m5);
    await order(v, ana.tabId, "Burger", "Vino", "Flan");
    const b2 = await splitOff(ana.partyId, ana.tabId, [2]);
    const b3 = await splitOff(ana.partyId, ana.tabId, [3]);
    return { ana, m4, m5, b1: ana.tabId, b2, b3 };
  }

  /** {@link threeBills} with Bill 2's id sorting after Bill 3's, so ids answer against numbers. */
  async function threeBillsWithIdsAgainstNumbers(prefix: string) {
    for (let attempt = 1; attempt <= 40; attempt++) {
      const bills = await threeBills(`${prefix} ${attempt}`);
      if (bills.b2 > bills.b3) return bills;
    }
    throw new Error("no two bills with ids sorting against their numbers in 40 tries");
  }

  /** Every stored fact of the bill but the lines' group, which a split gives a new one. */
  async function billFacts(billId: string) {
    return {
      row: await billRow(v, billId),
      lines: (await lineRows(billId)).map((line) => ({ ...line, groupId: null })),
      payments: await paymentsOf(v, billId),
      zone: await zoneOf(v, billId),
    };
  }

  async function shownBills(partyId: string) {
    const bills = await act((tx) => readPartyBills(tx, partyId));
    return bills
      .filter((bill) => bill.status !== "abandoned")
      .map((bill) => ({ id: bill.workingOrderId, status: bill.status }));
  }

  const partyCount = () => v.db.all<{ n: number }>(sql`select count(*) as n from parties`)[0]!.n;

  it("two of three whole bills leave together; the third stays", async () => {
    const { ana, m4, m5, b1, b2, b3 } = await threeBillsWithIdsAgainstNumbers("A803 Two");
    const staying = await billFacts(b1);
    const leaving = [await billFacts(b2), await billFacts(b3)];
    const partyBefore = await partyRow(v, ana.partyId);
    const partiesBefore = partyCount();
    const splitting = await cmd(ana.partyId);

    const result = await act((tx) =>
      splitTable(tx, v.cfg, ana.partyId, m5, whole(b3, b2), splitting),
    );

    expect(result.billIds).toEqual([b2, b3]);
    expect(await numbersOf(v, result.partyId)).toEqual([
      [b2, 1, null],
      [b3, 2, null],
    ]);
    expect(await numbersOf(v, ana.partyId)).toEqual([[b1, 1, null]]);
    expect(partyCount()).toBe(partiesBefore + 1);
    expect(await partyAt(v, m5)).toBe(result.partyId);
    expect(await activeTablesOf(v, result.partyId)).toEqual([m5]);
    expect(await activeTablesOf(v, ana.partyId)).toEqual([m4]);
    expect(await partyRow(v, ana.partyId)).toEqual({
      ...partyBefore,
      revision: splitting.expectedPartyRevision + 1,
    });
    expect(await billFacts(b1)).toEqual(staying);
    expect(await billFacts(b2)).toEqual({
      ...leaving[0],
      row: {
        ...leaving[0]!.row,
        partyId: result.partyId,
        revision: leaving[0]!.row.revision + 1,
      },
    });
    expect(await billFacts(b3)).toEqual({
      ...leaving[1],
      row: {
        ...leaving[1]!.row,
        partyId: result.partyId,
        revision: leaving[1]!.row.revision + 1,
      },
    });
  });

  it("any bill can stay and any can go, the first included", async () => {
    const { ana, m4, m5, b1, b2, b3 } = await threeBills("A803 First");
    const splitting = await cmd(ana.partyId);

    const result = await act((tx) =>
      splitTable(tx, v.cfg, ana.partyId, m5, whole(b1, b3), splitting),
    );

    expect(result.billIds).toEqual([b1, b3]);
    expect(await numbersOf(v, result.partyId)).toEqual([
      [b1, 1, null],
      [b3, 2, null],
    ]);
    expect(await numbersOf(v, ana.partyId)).toEqual([[b2, 2, null]]);
    expect(await openingBillOfParty(v, ana.partyId)).toBe(b2);
    expect(await activeTablesOf(v, ana.partyId)).toEqual([m4]);
  });

  it("nothing selected: the leaving table starts with an empty bill, and staying bills are untouched", async () => {
    const { ana, m5, b1, b2, b3 } = await threeBills("A803 Nothing");
    const staying = [await billFacts(b1), await billFacts(b2), await billFacts(b3)];
    const splitting = await cmd(ana.partyId);

    const result = await act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, whole(), splitting));

    expect(result.billIds).toEqual([expect.any(String)]);
    const [empty] = result.billIds;
    expect(staying.map((bill) => bill.row.id)).not.toContain(empty);
    expect(await billRow(v, empty!)).toMatchObject({ partyId: result.partyId, status: "open" });
    expect(await linesOf(v, empty!)).toEqual([]);
    expect(await numbersOf(v, result.partyId)).toEqual([[empty, 1, null]]);
    expect([await billFacts(b1), await billFacts(b2), await billFacts(b3)]).toEqual(staying);
    expect(await numbersOf(v, ana.partyId)).toEqual([
      [b1, 1, null],
      [b2, 2, null],
      [b3, 3, null],
    ]);
  });

  it("everything selected: the staying party gets one empty bill", async () => {
    const { ana, m4, m5, b1, b2, b3 } = await threeBills("A803 Everything");
    const splitting = await cmd(ana.partyId);

    const result = await act((tx) =>
      splitTable(tx, v.cfg, ana.partyId, m5, whole(b1, b2, b3), splitting),
    );

    expect(result.billIds).toEqual([b1, b2, b3]);
    const shown = await shownBills(ana.partyId);
    expect(shown).toEqual([{ id: expect.any(String), status: "open" }]);
    expect([b1, b2, b3]).not.toContain(shown[0]!.id);
    expect(await linesOf(v, shown[0]!.id)).toEqual([]);
    expect(await numbersOf(v, ana.partyId)).toEqual([[shown[0]!.id, 4, null]]);
    expect(await activeTablesOf(v, ana.partyId)).toEqual([m4]);
    expect(await partyRow(v, ana.partyId)).toMatchObject({
      revision: splitting.expectedPartyRevision + 1,
    });
  });

  it("a staying party keeping only a paid bill gets none, because a paid bill is one of the table's bills", async () => {
    const { ana, m4, m5, b1, b2, b3 } = await threeBills("A803 Paid");
    await pay(v, b1, "12.00");
    const splitting = await cmd(ana.partyId);

    const result = await act((tx) =>
      splitTable(tx, v.cfg, ana.partyId, m5, whole(b2, b3), splitting),
    );

    expect(result.billIds).toEqual([b2, b3]);
    expect(await shownBills(ana.partyId)).toEqual([{ id: b1, status: "settled" }]);
    expect(await activeTablesOf(v, ana.partyId)).toEqual([m4]);
  });

  it("sets both guest counts in the one command", async () => {
    const { ana, m5, b2, b3 } = await threeBills("A803 Guests");
    const splitting = await cmd(ana.partyId);

    const result = await act((tx) =>
      splitTable(tx, v.cfg, ana.partyId, m5, whole(b2, b3), {
        ...splitting,
        guestCounts: { staying: 2, leaving: 5 },
      }),
    );

    expect((await partyRow(v, ana.partyId)).guestCount).toBe(2);
    expect((await partyRow(v, result.partyId)).guestCount).toBe(5);
    expect((await partyRow(v, ana.partyId)).revision).toBe(splitting.expectedPartyRevision + 1);
  });

  it("two whole bills sharing a held group get one copy, with both dishes", async () => {
    const [m4, m5] = await tables("A803 Sharing", 4, 5);
    const ana = await seat(v, m4);
    await joinFree(ana.partyId, m5);
    await order(v, ana.tabId, "Burger");
    await sendGroups(ana.partyId, [{ names: ["Flan", "Tarta"], release: "hold" }], ana.tabId);
    const b2 = await splitOff(ana.partyId, ana.tabId, [2]);
    const b3 = await splitOff(ana.partyId, ana.tabId, [3]);
    const source = (await lineRows(b2))[0]!.groupId!;
    expect((await lineRows(b3))[0]!.groupId).toBe(source);
    const splitting = await cmd(ana.partyId);

    const result = await act((tx) =>
      splitTable(tx, v.cfg, ana.partyId, m5, whole(b2, b3), splitting),
    );

    const groups = await groupsOf(result.partyId);
    expect(groups).toEqual([{ id: expect.any(String), state: "held", position: 1 }]);
    const copy = groups[0]!.id;
    expect((await lineRows(b2)).map((line) => line.groupId)).toEqual([copy]);
    expect((await lineRows(b3)).map((line) => line.groupId)).toEqual([copy]);
    const moved = await act((tx) =>
      tx
        .select({ groupId: orderGroupEvents.groupId, partyId: orderGroupEvents.partyId })
        .from(orderGroupEvents)
        .where(
          and(
            eq(orderGroupEvents.kind, "lines_moved"),
            sql`${orderGroupEvents.groupId} in (${source}, ${copy})`,
          ),
        ),
    );
    expect(moved).toHaveLength(2);
    expect(moved).toEqual(
      expect.arrayContaining([
        { groupId: source, partyId: ana.partyId },
        { groupId: copy, partyId: result.partyId },
      ]),
    );
    expect((await ticketsOf(b2))[0]!.firedAt).toBeNull();
    expect((await ticketsOf(b3))[0]!.firedAt).toBeNull();

    const firing = { ...(await cmd(result.partyId)), submissionId: randomUUID() };
    await act((tx) => fireGroup(tx, v.cfg, result.partyId, copy, firing));

    expect((await ticketsOf(b2))[0]!.firedAt).toEqual(expect.any(String));
    expect((await ticketsOf(b3))[0]!.firedAt).toEqual(expect.any(String));
  });

  it("two whole bills with fired dishes make one fired group each, in number order", async () => {
    const { ana, m5, b2, b3 } = await threeBillsWithIdsAgainstNumbers("A803 Fired");
    const splitting = await cmd(ana.partyId);

    const result = await act((tx) =>
      splitTable(tx, v.cfg, ana.partyId, m5, whole(b3, b2), splitting),
    );

    const groups = await groupsOf(result.partyId);
    expect(groups).toEqual([
      { id: expect.any(String), state: "fired", position: 1 },
      { id: expect.any(String), state: "fired", position: 2 },
    ]);
    expect((await lineRows(b2)).map((line) => line.groupId)).toEqual([groups[0]!.id]);
    expect((await lineRows(b3)).map((line) => line.groupId)).toEqual([groups[1]!.id]);
  });

  it("two whole bills sent in their own fired groups keep each bill's own firer", async () => {
    const [m4, m5] = await tables("A803 Firers", 4, 5);
    const ana = await seat(v, m4);
    await joinFree(ana.partyId, m5);
    await sendGroups(
      ana.partyId,
      [
        { names: ["Burger"], release: "fire" },
        { names: ["Vino"], release: "fire" },
        { names: ["Flan"], release: "fire" },
      ],
      ana.tabId,
    );
    const b2 = await splitOff(ana.partyId, ana.tabId, [2]);
    const b3 = await splitOff(ana.partyId, ana.tabId, [3]);
    const firers = [
      [b2, randomUUID()],
      [b3, randomUUID()],
    ] as const;
    for (const [billId, firedBy] of firers) {
      const groupId = (await lineRows(billId))[0]!.groupId!;
      await act((tx) => tx.update(orderGroups).set({ firedBy }).where(eq(orderGroups.id, groupId)));
    }
    const splitting = await cmd(ana.partyId);

    const result = await act((tx) =>
      splitTable(tx, v.cfg, ana.partyId, m5, whole(b2, b3), splitting),
    );

    const arrived = await act((tx) =>
      tx
        .select({ id: orderGroups.id, firedBy: orderGroups.firedBy })
        .from(orderGroups)
        .where(eq(orderGroups.partyId, result.partyId))
        .orderBy(asc(orderGroups.position)),
    );
    expect(arrived).toEqual([
      { id: (await lineRows(b2))[0]!.groupId, firedBy: firers[0][1] },
      { id: (await lineRows(b3))[0]!.groupId, firedBy: firers[1][1] },
    ]);
  });

  it("two whole bills each holding a dish on hold outside a group arrive with one held group each", async () => {
    const [m4, m5] = await tables("A803 No group", 4, 5);
    const ana = await seat(v, m4);
    await joinFree(ana.partyId, m5);
    await order(v, ana.tabId, "Burger", "Vino", "Agua");
    const b2 = await splitOff(ana.partyId, ana.tabId, [2]);
    const b3 = await splitOff(ana.partyId, ana.tabId, [3]);
    const { id: courseId } = await act((tx) =>
      createCourse(tx, { name: "A803 Desserts no group", displayOrder: 3 }),
    );
    for (const [billId, dish] of [
      [b2, "Flan"],
      [b3, "Tarta"],
    ] as const) {
      await act((tx) =>
        addTabRound(tx, v.cfg, billId, [
          { menuItemId: v.item(dish), quantity: "1", courseId, hold: true },
        ]),
      );
    }
    const { printerId, stationId } = await act(async (tx) => {
      const { id: printerId } = await createPrinter(tx, {
        name: "Hold tickets",
        transport: "cloud_poll",
        pollId: `poll-${randomUUID()}`,
      });
      const [station] = await tx
        .select({ id: kitchenStations.id })
        .from(kitchenStations)
        .where(eq(kitchenStations.isDefault, true));
      await attachPrinterToStation(tx, { stationId: station!.id, printerId });
      await setStationPrinting(tx, { printHeldWork: true }, [station!.id]);
      return { printerId, stationId: station!.id };
    });
    onTestFinished(() =>
      act(async (tx) => {
        await detachPrinterFromStation(tx, { stationId, printerId });
        await setStationPrinting(tx, { printHeldWork: false }, [stationId]);
      }),
    );
    const splitting = await cmd(ana.partyId);

    const result = await act((tx) =>
      splitTable(tx, v.cfg, ana.partyId, m5, whole(b2, b3), splitting),
    );

    expect((await groupsOf(result.partyId)).map((group) => group.state)).toEqual([
      "fired",
      "held",
      "fired",
      "held",
    ]);
    const jobs = await act((tx) =>
      tx
        .select({ payload: printJobs.payload })
        .from(printJobs)
        .where(eq(printJobs.printerId, printerId))
        .orderBy(sql`rowid`),
    );
    const printed = jobs.map((job) => printedLines(job.payload).filter((text) => text !== ""));
    expect(
      printed
        .filter((lines) => lines[0] === `*** ${kitchenTicketWords("es").hold} ***`)
        .map((lines) => lines.at(-1)),
    ).toEqual(["1 x FLAN", "1 x TARTA"]);
  });

  it("two whole bills with held dishes move each bill's own open draft with its own expected edit", async () => {
    const { ana, m5, b1, b2, b3 } = await threeBills("A803 Drafts");
    await sendGroups(ana.partyId, [{ names: ["Flan"], release: "hold" }], b2);
    await sendGroups(ana.partyId, [{ names: ["Tarta"], release: "hold" }], b3);
    for (const [billId, dish] of [
      [b1, "Agua"],
      [b2, "Paella"],
      [b3, "Caña"],
    ] as const) {
      await act((tx) =>
        saveDraft(tx, v.cfg, ana.partyId, OPERATOR, {
          billId,
          draftId: null,
          revision: 0,
          lines: [{ menuItemId: v.item(dish), quantity: "1" }],
        }),
      );
    }
    const edits = [
      await act((tx) => readBillEditState(tx, b2)),
      await act((tx) => readBillEditState(tx, b3)),
    ];
    const splitting = await cmd(ana.partyId);

    const result = await act((tx) =>
      splitTable(tx, v.cfg, ana.partyId, m5, whole(b2, b3), splitting),
    );

    const facts = (drafts: Awaited<ReturnType<typeof readDrafts>>) =>
      drafts
        .map((draft) => ({
          billId: draft.billId,
          partyId: draft.partyId,
          revision: draft.revision,
          items: draft.lines.map((line) => line.menuItemId),
        }))
        .sort((a, b) => a.billId.localeCompare(b.billId));
    expect(facts(await act((tx) => readDrafts(tx, v.cfg, result.partyId)))).toEqual(
      [
        { billId: b2, partyId: result.partyId, revision: 1, items: [v.item("Paella")] },
        { billId: b3, partyId: result.partyId, revision: 1, items: [v.item("Caña")] },
      ].sort((a, b) => a.billId.localeCompare(b.billId)),
    );
    expect(facts(await act((tx) => readDrafts(tx, v.cfg, ana.partyId)))).toEqual([
      { billId: b1, partyId: ana.partyId, revision: 0, items: [v.item("Agua")] },
    ]);
    for (const edit of edits) {
      expect(await act((tx) => readBillEditState(tx, edit.billId))).toMatchObject({
        billId: edit.billId,
        editorId: edit.editorId,
        draftId: edit.draftId,
        draftRevision: 1,
        editorVersion: edit.editorVersion + 1,
      });
    }
  });

  it("a whole part-paid bill goes with its payments", async () => {
    const [m4, m5] = await tables("A803 Part", 4, 5);
    const ana = await seat(v, m4);
    await joinFree(ana.partyId, m5);
    await order(v, ana.tabId, "Burger", "Vino", "Agua", "Flan");
    const b2 = await splitOff(ana.partyId, ana.tabId, [2, 3]);
    const b3 = await splitOff(ana.partyId, ana.tabId, [4]);
    await takeBillPayment(
      { admission: testTradingAdmission(), db: v.db, backend: v.backend, clock: v.clock },
      v.cfg,
      b2,
      {
        submissionId: randomUUID(),
        kind: "items",
        lines: [{ lineNo: (await lineRows(b2))[1]!.lineNo }],
        method: "cash",
        tendered: "2.00",
        applied: "2.00",
        tip: "0.00",
      },
      v.operator,
    );
    await cashContribution(v, b3, "1.00");
    const money = async () => ({
      b2: {
        payments: await paymentsOf(v, b2),
        balance: await act((tx) => readBillBalance(tx, b2)),
      },
      b3: {
        payments: await paymentsOf(v, b3),
        balance: await act((tx) => readBillBalance(tx, b3)),
      },
    });
    const before = await money();
    expect(before.b2.balance.paidLines).toHaveLength(1);
    expect(before.b2.payments).toHaveLength(1);
    expect(before.b3.payments).toHaveLength(1);
    const splitting = await cmd(ana.partyId);

    const result = await act((tx) =>
      splitTable(tx, v.cfg, ana.partyId, m5, whole(b2, b3), splitting),
    );

    expect(result.billIds).toEqual([b2, b3]);
    expect(await money()).toEqual(before);
    expect(await billRow(v, b2)).toMatchObject({ partyId: result.partyId, status: "open" });
    expect(await billRow(v, b3)).toMatchObject({ partyId: result.partyId, status: "open" });
    const issued = await act((tx) =>
      tx
        .select({ id: sales.id })
        .from(sales)
        .where(inArray(sales.workingOrderId, [ana.tabId, b2, b3])),
    );
    expect(issued).toEqual([]);
  });

  it("the answer and allergy guests are copied once across both", async () => {
    const { ana, m5, b1, b2, b3 } = await threeBills("A803 Allergies");
    await act((tx) =>
      writePartyAllergy(
        tx,
        ana.partyId,
        { answer: "allergies", guests: [{ who: "Window seat", allergens: { milk: {} } }] },
        OPERATOR,
      ),
    );
    const { guests } = await act((tx) => readPartyAllergy(tx, ana.partyId));
    const tick = async (billId: string) => ({
      guestId: guests[0]!.id,
      workingLineId: (await lineRows(billId))[0]!.id,
    });
    const ticks = [await tick(b1), await tick(b2), await tick(b3)];
    await act((tx) => setAllergyLineTicks(tx, ana.partyId, ticks));
    const splitting = await cmd(ana.partyId);

    const result = await act((tx) =>
      splitTable(tx, v.cfg, ana.partyId, m5, whole(b2, b3), splitting),
    );

    const source = await act((tx) => readPartyAllergy(tx, ana.partyId));
    const target = await act((tx) => readPartyAllergy(tx, result.partyId));
    expect(target.answer).toBe("allergies");
    expect(target.guests.map((guest) => guest.who)).toEqual(["Window seat"]);
    const copy = target.guests[0]!.id;
    expect(copy).not.toBe(guests[0]!.id);
    expect(source.guests.map((guest) => guest.id)).toEqual([guests[0]!.id]);
    expect(source.ticks).toEqual([{ ...ticks[0], draftLineId: null }]);
    expect(target.ticks).toHaveLength(2);
    expect(target.ticks).toEqual(
      expect.arrayContaining([
        { guestId: copy, draftLineId: null, workingLineId: ticks[1]!.workingLineId },
        { guestId: copy, draftLineId: null, workingLineId: ticks[2]!.workingLineId },
      ]),
    );
  });

  it("a split of a joined table leaves the seats and the highest state as a one-bill split does", async () => {
    const { table } = await plannedZone(
      v,
      ["1", "2"].flatMap((twin, row) =>
        ["a", "b", "c"].map((key, column) => ({
          key: `${key}${twin}`,
          label: `A803 Joined ${key}${twin}`,
          place: { x: column * 10, y: row * 10, width: 8, height: 8 },
        })),
      ),
    );
    /** A party on three tables pushed together, 14 seats typed: Bills 1 (Burger), 2 (Vino), 3 (Flan). */
    async function joinedParty(twin: string) {
      const [a, b, c] = [table[`a${twin}`]!, table[`b${twin}`]!, table[`c${twin}`]!];
      for (const movingId of [b, c]) {
        await act((tx) =>
          writeMerge(tx, v.cfg, { movingId, targetId: a, side: "right", seats: 14, free: true }),
        );
      }
      const ana = await seat(v, a);
      await order(v, ana.tabId, "Burger", "Vino", "Flan");
      const b2 = await splitOff(ana.partyId, ana.tabId, [2]);
      const b3 = await splitOff(ana.partyId, ana.tabId, [3]);
      return { ana, a, b, c, b2, b3 };
    }
    /** Each table's floor state, condition, timing, deliveries and signals, and its merge's size. */
    async function floorFacts(tableIds: string[]) {
      const read = [];
      for (const tableId of tableIds) {
        const row = await floorRow(v, tableId);
        const merge = await mergeOf(v, tableId);
        read.push({
          state: row.state,
          hasOpenTab: row.hasOpenTab,
          condition: row.condition,
          timingBand: row.timingBand,
          pendingDeliveries: row.pendingDeliveries,
          signals: row.signals,
          seats: merge?.seats ?? null,
          members: merge?.members.length ?? 0,
        });
      }
      return read;
    }

    const one = await joinedParty("1");
    const two = await joinedParty("2");
    const splittingOne = await cmd(one.ana.partyId);
    const splittingTwo = await cmd(two.ana.partyId);
    const leftOne = await act((tx) =>
      splitTable(tx, v.cfg, one.ana.partyId, one.c, whole(one.b2), splittingOne),
    );
    const leftTwo = await act((tx) =>
      splitTable(tx, v.cfg, two.ana.partyId, two.c, whole(two.b2, two.b3), splittingTwo),
    );

    const oneFacts = await floorFacts([one.a, one.b, one.c]);
    expect(await floorFacts([two.a, two.b, two.c])).toEqual(oneFacts);
    expect(oneFacts.map((table) => [table.seats, table.members])).toEqual([
      [14, 2],
      [14, 2],
      [null, 0],
    ]);
    expect(await activeTablesOf(v, leftOne.partyId)).toEqual([one.c]);
    expect(await activeTablesOf(v, leftTwo.partyId)).toEqual([two.c]);
  });

  describe("what it refuses, changing every row not at all", () => {
    it("refuses a whole id twice", async () => {
      const { ana, m4, m5, b1, b2, b3 } = await threeBills("A803 Twice");
      const splitting = await cmd(ana.partyId);

      const error = await refused([ana.partyId], [b1, b2, b3], [m4, m5], () =>
        act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, whole(b2, b2), splitting)),
      );

      expect(error).toMatchObject({
        code: "management.request_invalid",
        params: { field: "selection" },
      });
    });

    it("refuses a paid bill among them", async () => {
      const { ana, m4, m5, b1, b2, b3 } = await threeBills("A803 Settled");
      await pay(v, b3, "5.00");
      const splitting = await cmd(ana.partyId);

      const error = await refused([ana.partyId], [b1, b2, b3], [m4, m5], () =>
        act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, whole(b2, b3), splitting)),
      );

      expect(error).toMatchObject({ code: "bill.paid", params: { workingOrderId: b3 } });
    });

    it("refuses an abandoned bill among them", async () => {
      const { ana, m4, m5, b1, b2, b3 } = await threeBills("A803 Abandoned");
      v.db.run(sql`update working_orders set status = 'abandoned' where id = ${b3}`);
      const splitting = await cmd(ana.partyId);

      const error = await refused([ana.partyId], [b1, b2, b3], [m4, m5], () =>
        act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, whole(b2, b3), splitting)),
      );

      expect(error).toMatchObject({ code: "tab.not_open", params: { tabId: b3 } });
    });

    it("refuses another party's bill among them", async () => {
      const { ana, m4, m5, b1, b2, b3 } = await threeBills("A803 Foreign");
      const [m7] = await tables("A803 Foreign other", 7);
      const luis = await seat(v, m7!);
      const splitting = await cmd(ana.partyId);

      const error = await refused(
        [ana.partyId, luis.partyId],
        [b1, b2, b3, luis.tabId],
        [m4, m5, m7!],
        () => act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, whole(b2, luis.tabId), splitting)),
      );

      expect(error).toMatchObject({
        code: "bill.other_party",
        params: { workingOrderId: luis.tabId },
      });
    });
  });

  it("allergies are copied before the bills arrive: a bill with a dish that fires on arrival arrives without allergy.unanswered", async () => {
    const [m4, m5] = await tables("A803 Before", 4, 5);
    const ana = await seat(v, m4);
    await joinFree(ana.partyId, m5);
    await order(v, ana.tabId, "Burger", "Vino");
    const b2 = await splitOff(ana.partyId, ana.tabId, [2]);
    await act((tx) =>
      addTabRound(tx, v.cfg, b2, [{ menuItemId: v.item("Flan"), quantity: "1", hold: true }]),
    );
    expect((await ticketsOf(b2)).at(-1)!.firedAt).toBeNull();
    const splitting = await cmd(ana.partyId);

    const result = await act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, whole(b2), splitting));

    expect(result.billIds).toEqual([b2]);
    expect((await ticketsOf(b2)).at(-1)!.firedAt).toEqual(expect.any(String));
    expect((await act((tx) => readPartyAllergy(tx, result.partyId))).answer).toBe("none");
  });

  describe("loose dishes", () => {
    const loose = (billId: string, ...lineIds: string[]) => ({ billId, lineIds });

    /** The real command, which answers what the fixture's does not: `looseSourceIds`. */
    async function splitSelected(
      partyId: string,
      tableId: string,
      selection: SplitSelection,
      cfg: typeof v.cfg = v.cfg,
    ) {
      const splitting = await cmd(partyId);
      const named = [...selection.wholeBillIds, ...selection.loose.map((entry) => entry.billId)];
      const expectedEdits = await act(async (tx) => {
        const edits = [];
        for (const billId of [...new Set(named)].sort())
          edits.push(await readBillEditState(tx, billId));
        return edits;
      });
      return act((tx) =>
        splitSelection(tx, cfg, partyId, tableId, selection, { ...splitting, expectedEdits }),
      );
    }

    const SPLIT_TABLES = [
      "parties",
      "party_tables",
      "working_orders",
      "working_order_lines",
      "ticket_items",
      "order_groups",
      "order_group_events",
      "order_drafts",
      "order_draft_lines",
      "order_draft_recalled_lines",
      "party_allergy",
      "party_allergy_guests",
      "allergy_line_ticks",
      "kitchen_notices",
      "print_jobs",
      "bill_number_allocations",
      "bill_identities",
      "working_order_counters",
      "bill_edit_states",
      "order_service_contexts",
    ];

    /** Every row of {@link SPLIT_TABLES}, whoever's: a refusal may leave a new party behind. */
    function everyRow() {
      return Object.fromEntries(
        SPLIT_TABLES.map((table) => [
          table,
          v.db.all(sql.raw(`select * from ${table} order by rowid`)),
        ]),
      );
    }

    /** Runs `fn`, expecting a refusal that leaves every row of {@link SPLIT_TABLES} as it was. */
    async function refusedWithNoRowChanged(fn: () => Promise<unknown>) {
      const before = everyRow();
      const error = await captureError(fn);
      expect(everyRow()).toEqual(before);
      return error;
    }

    async function lineOn(billId: string, name: string) {
      const line = (await lineRows(billId)).find((row) => row.name === name);
      expect(line, `${name} on the bill`).toBeDefined();
      return line!;
    }

    const namesOn = async (billId: string) => (await lineRows(billId)).map((line) => line.name);

    /** The bill's kitchen items with everything stored, by line id. */
    function kitchenRows(billId: string) {
      return act((tx) =>
        tx
          .select()
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderId, billId))
          .orderBy(asc(ticketItems.workingOrderLineId)),
      );
    }

    /** Ana on `<prefix> 4` and `<prefix> 5` with Bill 1 holding `names`, sent. */
    async function tableFor(prefix: string, ...names: string[]) {
      const [m4, m5] = await tables(prefix, 4, 5);
      const ana = await seat(v, m4);
      await joinFree(ana.partyId, m5);
      await order(v, ana.tabId, ...names);
      return { ana, m4, m5, b1: ana.tabId };
    }

    it("loose dishes from a staying bill and whole bills leave together", async () => {
      const { ana, m4, m5, b1, b2, b3 } = await threeBills("A803 Loose");
      await act((tx) =>
        placeGroups(tx, v.cfg, ana.partyId, {
          groups: [
            {
              lines: [
                {
                  menuItemId: extras.toppedBurger,
                  quantity: "1",
                  extras: [
                    { listId: extras.toppings, picks: [{ productId: extras.cheese, quantity: 1 }] },
                  ],
                },
                { menuItemId: v.item("Tarta"), quantity: "1" },
              ],
              release: "fire",
            },
          ],
          operatorId: OPERATOR,
          billId: b1,
        }),
      );
      const topped = await lineOn(b1, "Topped burger");
      const tarta = await lineOn(b1, "Tarta");
      const preparing = (await kitchenRows(b1)).find(
        (item) => item.workingOrderLineId === topped.id,
      )!;
      await act((tx) => advanceTicketItem(tx, v.cfg, preparing.id, "preparing"));
      await act((tx) => serveLine(tx, v.cfg, b1, tarta.lineNo));
      const leftAsItWas = (line: Awaited<ReturnType<typeof lineRows>>[number]) => ({
        ...line,
        lineNo: 0,
        workingOrderId: "",
        groupId: null,
      });
      const movedIds = [topped.id, tarta.id];
      const family = (await lineRows(b1)).filter(
        (line) => movedIds.includes(line.id) || movedIds.includes(line.parentLineId ?? ""),
      );
      expect(family.map((line) => line.name)).toEqual(["Topped burger", "Cheese", "Tarta"]);
      const tartaServed = (await lineOn(b1, "Tarta")).servedQuantity;
      const sourceOrderNumber = (await billRow(v, b1)).orderNumber;
      const kitchen = (await kitchenRows(b1))
        .filter((item) => movedIds.includes(item.workingOrderLineId!))
        .map((item) => ({
          ...item,
          workingOrderId: null,
          sentOrderNumber: sourceOrderNumber,
        }));
      expect(kitchen.map((item) => item.state)).toContain("preparing");
      const stayingBurger = await lineOn(b1, "Burger");

      const result = await splitSelected(ana.partyId, m5, {
        wholeBillIds: [b2, b3],
        loose: [loose(b1, topped.id, tarta.id)],
      });

      const newBill = result.billIds[2]!;
      expect(result.billIds).toEqual([b2, b3, expect.any(String)]);
      expect([b1, b2, b3]).not.toContain(newBill);
      expect(result.looseSourceIds).toEqual([b1]);
      expect(await numbersOf(v, result.partyId)).toEqual([
        [b2, 1, null],
        [b3, 2, null],
        [newBill, 3, null],
      ]);
      expect(await numbersOf(v, ana.partyId)).toEqual([[b1, 1, null]]);
      expect(await lineRows(b1)).toEqual([stayingBurger]);
      expect(await billRow(v, newBill)).toMatchObject({
        partyId: result.partyId,
        status: "open",
        label: null,
      });
      expect(await zoneOf(v, newBill)).toBe(v.tables.zoneId);
      expect(await activeTablesOf(v, result.partyId)).toEqual([m5]);
      expect(await activeTablesOf(v, ana.partyId)).toEqual([m4]);
      const arrived = await lineRows(newBill);
      expect(arrived.map(leftAsItWas)).toEqual(family.map(leftAsItWas));
      expect((await lineOn(newBill, "Tarta")).servedQuantity).toBe(tartaServed);
      expect(tartaServed).toBeGreaterThan(0);
      expect(
        (await kitchenRows(newBill)).map((item) => ({ ...item, workingOrderId: null })),
      ).toEqual(kitchen);
    });

    it("dishes picked from two bills go on one new bill", async () => {
      const { ana, m5, b2, b3 } = await threeBillsWithIdsAgainstNumbers("A803 Two sources");
      await order(v, b2, "Agua");
      await order(v, b3, "Caña");
      const water = await lineOn(b2, "Agua");
      const cana = await lineOn(b3, "Caña");

      const result = await splitSelected(ana.partyId, m5, {
        wholeBillIds: [],
        loose: [loose(b3, cana.id), loose(b2, water.id)],
      });

      expect(result.billIds).toEqual([expect.any(String)]);
      const newBill = result.billIds[0]!;
      expect(result.looseSourceIds).toEqual([b2, b3]);
      expect(await namesOn(newBill)).toEqual(["Agua", "Caña"]);
      expect(await namesOn(b2)).toEqual(["Vino"]);
      expect(await namesOn(b3)).toEqual(["Flan"]);
      expect(await shownBills(result.partyId)).toEqual([{ id: newBill, status: "open" }]);
      expect(await numbersOf(v, result.partyId)).toEqual([[newBill, 1, null]]);
    });

    it("a loose pick burns no number at the staying table", async () => {
      const { ana, m5, b1 } = await tableFor("A803 No room", "Burger", "Vino");
      const vino = await lineOn(b1, "Vino");

      await splitSelected(ana.partyId, m5, { wholeBillIds: [], loose: [loose(b1, vino.id)] });

      const next = await act((tx) => insertPartyBill(tx, v.cfg, ana.partyId));
      expect(await numbersOf(v, ana.partyId)).toEqual([
        [b1, 1, null],
        [next, 2, null],
      ]);
      expect(await allocationsOf(v, ana.partyId)).toEqual([
        [1, b1],
        [2, next],
      ]);
    });

    describe("a part-paid bill", () => {
      async function partPaid(prefix: string) {
        const bill = await tableFor(prefix, "Burger", "Agua");
        await takeBillPayment(
          { admission: testTradingAdmission(), db: v.db, backend: v.backend, clock: v.clock },
          v.cfg,
          bill.b1,
          {
            submissionId: randomUUID(),
            kind: "items",
            lines: [{ lineNo: (await lineOn(bill.b1, "Burger")).lineNo }],
            method: "cash",
            tendered: "12.00",
            applied: "12.00",
            tip: "0.00",
          },
          v.operator,
        );
        return bill;
      }

      it("a whole part-paid bill stays selectable", async () => {
        const { ana, m5, b1 } = await partPaid("A803 Part whole");
        const payments = await paymentsOf(v, b1);

        const result = await splitSelected(ana.partyId, m5, whole(b1));

        expect(result.billIds).toEqual([b1]);
        expect(await paymentsOf(v, b1)).toEqual(payments);
        expect(payments).toHaveLength(1);
      });

      it("its unpaid dishes can go loose, the payment staying", async () => {
        const { ana, m5, b1 } = await partPaid("A803 Part loose");
        const payments = await paymentsOf(v, b1);
        const water = await lineOn(b1, "Agua");

        const result = await splitSelected(ana.partyId, m5, {
          wholeBillIds: [],
          loose: [loose(b1, water.id)],
        });

        expect(await namesOn(result.billIds[0]!)).toEqual(["Agua"]);
        expect(await namesOn(b1)).toEqual(["Burger"]);
        expect(await paymentsOf(v, b1)).toEqual(payments);
      });

      it("its paid dish refuses bill.line_paid, every row unchanged", async () => {
        const { ana, m5, b1 } = await partPaid("A803 Part paid");
        const burger = await lineOn(b1, "Burger");

        const error = await refusedWithNoRowChanged(() =>
          splitSelected(ana.partyId, m5, { wholeBillIds: [], loose: [loose(b1, burger.id)] }),
        );

        expect(error).toMatchObject({
          code: "bill.line_paid",
          params: { workingOrderId: b1, lineNo: burger.lineNo },
        });
      });
    });

    describe("a contribution", () => {
      it("a loose pick leaving €40.00 of €52.00 with €40.00 received goes", async () => {
        const { ana, m5, b1 } = await tableFor(
          "A803 Exact",
          "Vino",
          "Burger",
          "Agua",
          "Flan",
          "Caña",
        );
        expect(decimalToCents(await act((tx) => storedOrderTotal(tx, b1)))).toBe(5200);
        await cashContribution(v, b1, "40.00");
        const burger = await lineOn(b1, "Burger");

        const result = await splitSelected(ana.partyId, m5, {
          wholeBillIds: [],
          loose: [loose(b1, burger.id)],
        });

        expect(decimalToCents(await act((tx) => storedOrderTotal(tx, b1)))).toBe(4000);
        expect(await namesOn(result.billIds[0]!)).toEqual(["Burger"]);
      });

      it("a loose pick leaving €39.99 of €52.00 with €40.00 received refuses bill.received_exceeds_total", async () => {
        const [m4, m5] = await tables("A803 Short", 4, 5);
        const ana = await seat(v, m4);
        await joinFree(ana.partyId, m5);
        await act((tx) =>
          addTabRound(tx, v.cfg, ana.tabId, [
            { menuItemId: extras.side, quantity: "1" },
            { menuItemId: extras.steak, quantity: "1" },
          ]),
        );
        expect(decimalToCents(await act((tx) => storedOrderTotal(tx, ana.tabId)))).toBe(5200);
        await cashContribution(v, ana.tabId, "40.00");
        const steak = await lineOn(ana.tabId, "Steak");

        const error = await refusedWithNoRowChanged(() =>
          splitSelected(ana.partyId, m5, {
            wholeBillIds: [],
            loose: [loose(ana.tabId, steak.id)],
          }),
        );

        expect(error).toMatchObject({
          code: "bill.received_exceeds_total",
          params: { workingOrderId: ana.tabId, excess: "0.01" },
        });
      });

      it("with two sources, the second left a cent short refuses naming it, the first's dish staying too", async () => {
        const [m4, m5] = await tables("A803 Second short", 4, 5);
        const ana = await seat(v, m4);
        await joinFree(ana.partyId, m5);
        await order(v, ana.tabId, "Burger", "Agua");
        const b2 = await act((tx) => insertPartyBill(tx, v.cfg, ana.partyId));
        await act((tx) =>
          addTabRound(tx, v.cfg, b2, [
            { menuItemId: extras.side, quantity: "1" },
            { menuItemId: extras.steak, quantity: "1" },
          ]),
        );
        expect(decimalToCents(await act((tx) => storedOrderTotal(tx, b2)))).toBe(5200);
        await cashContribution(v, b2, "40.00");
        const water = await lineOn(ana.tabId, "Agua");
        const steak = await lineOn(b2, "Steak");

        const error = await refusedWithNoRowChanged(() =>
          splitSelected(ana.partyId, m5, {
            wholeBillIds: [],
            loose: [loose(b2, steak.id), loose(ana.tabId, water.id)],
          }),
        );

        expect(error).toMatchObject({
          code: "bill.received_exceeds_total",
          params: { workingOrderId: b2, excess: "0.01" },
        });
      });

      it("every sent dish picked off a bill holding €1.00 refuses bill.received_exceeds_total, the person's unsent dish left there or not", async () => {
        const { ana, m5, b1 } = await tableFor("A803 Emptied money", "Burger", "Agua");
        await cashContribution(v, b1, "1.00");
        const picked = loose(b1, (await lineOn(b1, "Burger")).id, (await lineOn(b1, "Agua")).id);
        const refusal = {
          code: "bill.received_exceeds_total",
          params: { workingOrderId: b1, excess: "1.00" },
        };

        const bare = await refusedWithNoRowChanged(() =>
          splitSelected(ana.partyId, m5, { wholeBillIds: [], loose: [picked] }),
        );
        expect(bare).toMatchObject(refusal);

        await act((tx) =>
          saveDraft(tx, v.cfg, ana.partyId, OPERATOR, {
            billId: b1,
            draftId: null,
            revision: 0,
            lines: [{ menuItemId: v.item("Flan"), quantity: "1" }],
          }),
        );
        const drafted = await refusedWithNoRowChanged(() =>
          splitSelected(ana.partyId, m5, { wholeBillIds: [], loose: [picked] }),
        );
        expect(drafted).toMatchObject(refusal);
      });
    });

    it("a held dish loose: the new table gets its own held copy, the staying dish stays held in the source group, and each fires alone", async () => {
      const [m4, m5] = await tables("A803 Held", 4, 5);
      const ana = await seat(v, m4);
      await joinFree(ana.partyId, m5);
      await sendGroups(ana.partyId, [{ names: ["Burger"], release: "fire" }], ana.tabId);
      await sendGroups(ana.partyId, [{ names: ["Flan", "Tarta"], release: "hold" }], ana.tabId);
      const b1 = ana.tabId;
      const burger = await lineOn(b1, "Burger");
      const flan = await lineOn(b1, "Flan");
      const tarta = await lineOn(b1, "Tarta");
      const source = flan.groupId!;
      const firedSource = burger.groupId!;
      const firedBy = randomUUID();
      await act((tx) =>
        tx.update(orderGroups).set({ firedBy }).where(eq(orderGroups.id, firedSource)),
      );
      const before = everyRow();

      const result = await splitSelected(ana.partyId, m5, {
        wholeBillIds: [],
        loose: [loose(b1, burger.id, flan.id)],
      });

      const after = everyRow();
      const newBill = result.billIds[0]!;
      const groups = await groupsOf(result.partyId);
      expect(groups.map((group) => group.state)).toEqual(["fired", "held"]);
      const [fired, copy] = groups;
      expect((await lineOn(newBill, "Burger")).groupId).toBe(fired!.id);
      expect(fired!.id).not.toBe(firedSource);
      expect(
        await act((tx) =>
          tx
            .select({ firedBy: orderGroups.firedBy })
            .from(orderGroups)
            .where(eq(orderGroups.id, fired!.id)),
        ),
      ).toEqual([{ firedBy }]);
      expect((await lineOn(newBill, "Flan")).groupId).toBe(copy!.id);
      expect(copy!.id).not.toBe(source);
      expect((await lineOn(b1, "Tarta")).groupId).toBe(source);
      expect((await groupsOf(ana.partyId)).find((group) => group.id === source)!.state).toBe(
        "held",
      );
      expect(
        SPLIT_TABLES.filter(
          (table) => JSON.stringify(before[table]) !== JSON.stringify(after[table]),
        ),
      ).toEqual([
        "parties",
        "party_tables",
        "working_orders",
        "working_order_lines",
        "ticket_items",
        "order_groups",
        "order_group_events",
        "party_allergy",
        "kitchen_notices",
        "bill_number_allocations",
        "bill_identities",
        "working_order_counters",
        "order_service_contexts",
      ]);
      const firedAt = async (billId: string, lineId: string) =>
        (await ticketsOf(billId)).find((item) => item.lineId === lineId)!.firedAt;
      expect(await firedAt(newBill, flan.id)).toBeNull();
      expect(await firedAt(b1, tarta.id)).toBeNull();

      const firingCopy = { ...(await cmd(result.partyId)), submissionId: randomUUID() };
      await act((tx) => fireGroup(tx, v.cfg, result.partyId, copy!.id, firingCopy));

      expect(await firedAt(newBill, flan.id)).toEqual(expect.any(String));
      expect(await firedAt(b1, tarta.id)).toBeNull();

      const firingSource = { ...(await cmd(ana.partyId)), submissionId: randomUUID() };
      await act((tx) => fireGroup(tx, v.cfg, ana.partyId, source, firingSource));

      expect(await firedAt(b1, tarta.id)).toEqual(expect.any(String));
    });

    it("a dish recalled into a draft refuses draft.out_of_date, naming the source", async () => {
      const [m4, m5] = await tables("A803 Recovered", 4, 5);
      const ana = await seat(v, m4);
      await joinFree(ana.partyId, m5);
      await sendGroups(ana.partyId, [{ names: ["Paella", "Flan"], release: "hold" }], ana.tabId);
      const paella = await lineOn(ana.tabId, "Paella");
      const flan = await lineOn(ana.tabId, "Flan");
      const recalling = await cmd(ana.partyId);
      await act(async (tx) => {
        const stations = await readChangesAfterSending(tx);
        await setChangesAfterSending(tx, "held-or-waiting");
        await recallToDraft(tx, v.cfg, ana.partyId, paella.id, {
          ...recalling,
          expectedEdit: await readBillEditState(tx, ana.tabId),
          submissionId: randomUUID(),
        });
        for (const [stationId, value] of stations)
          await setChangesAfterSending(tx, value, [stationId]);
      });

      const error = await refusedWithNoRowChanged(() =>
        splitSelected(ana.partyId, m5, {
          wholeBillIds: [],
          loose: [loose(ana.tabId, flan.id, paella.id)],
        }),
      );

      expect(error).toMatchObject({
        code: "draft.out_of_date",
        params: { billId: ana.tabId },
      });
    });

    describe("a presented source", () => {
      it("loose, it refuses bill.presented", async () => {
        const { ana, m5, b2 } = await threeBills("A803 Bill loose");
        await placeByHand(v, b2);
        const vino = await lineOn(b2, "Vino");

        const error = await refusedWithNoRowChanged(() =>
          splitSelected(ana.partyId, m5, { wholeBillIds: [], loose: [loose(b2, vino.id)] }),
        );

        expect(error).toMatchObject({
          code: "bill.presented",
          params: { workingOrderId: b2 },
        });
      });

      it("the same bill whole goes", async () => {
        const { ana, m5, b2 } = await threeBills("A803 Bill whole");
        await placeByHand(v, b2);

        const result = await splitSelected(ana.partyId, m5, whole(b2));

        expect(result.billIds).toEqual([b2]);
        expect(await billRow(v, b2)).toMatchObject({ partyId: result.partyId, status: "placed" });
      });
    });

    it("a dish the kitchen holds outside a held group refuses tab.split_held_line", async () => {
      const { ana, m5, b1 } = await tableFor("A803 No group loose", "Burger");
      await act((tx) =>
        addTabRound(tx, v.cfg, b1, [{ menuItemId: v.item("Tarta"), quantity: "1", hold: true }]),
      );
      const tarta = await lineOn(b1, "Tarta");

      const error = await refusedWithNoRowChanged(() =>
        splitSelected(ana.partyId, m5, { wholeBillIds: [], loose: [loose(b1, tarta.id)] }),
      );

      expect(error).toMatchObject({
        code: "tab.split_held_line",
        params: { tabId: b1, lineNo: tarta.lineNo },
      });
    });

    describe("a pending payment", () => {
      const pending = (billId: string) =>
        v.db.run(
          sql`update working_orders set payment_attempt_at = '2026-11-01T10:00:00.000Z' where id = ${billId}`,
        );

      it("on a loose source refuses order.payment_in_flight", async () => {
        const { ana, m5, b1 } = await tableFor("A803 Payment loose", "Burger", "Agua");
        pending(b1);
        const water = await lineOn(b1, "Agua");

        const error = await refusedWithNoRowChanged(() =>
          splitSelected(ana.partyId, m5, { wholeBillIds: [], loose: [loose(b1, water.id)] }),
        );

        expect(error).toMatchObject({
          code: "order.payment_in_flight",
          params: { workingOrderId: b1 },
        });
      });

      it("on a whole bill it goes", async () => {
        const { ana, m5, b2 } = await threeBills("A803 Payment whole");
        pending(b2);

        const result = await splitSelected(ana.partyId, m5, whole(b2));

        expect(result.billIds).toEqual([b2]);
        expect(await billRow(v, b2)).toMatchObject({ partyId: result.partyId });
      });
    });

    it("over the simplified-invoice limit, the new bill refuses sale.total_exceeds_simplified_limit", async () => {
      const { ana, m5, b1, b3 } = await threeBills("A803 Limit");
      const burger = await lineOn(b1, "Burger");
      const flan = await lineOn(b3, "Flan");

      const error = await refusedWithNoRowChanged(() =>
        splitSelected(
          ana.partyId,
          m5,
          { wholeBillIds: [], loose: [loose(b1, burger.id), loose(b3, flan.id)] },
          { ...v.cfg, simplifiedInvoiceLimit: decimal("15.00") },
        ),
      );

      expect(error).toMatchObject({ code: "sale.total_exceeds_simplified_limit" });
    });

    it("an allergy tick on a loose dish moves with it; one on a dish that stayed stays", async () => {
      const { ana, m5, b1, b2 } = await threeBills("A803 Marks");
      await order(v, b1, "Agua");
      await act((tx) =>
        addTabRound(tx, v.cfg, b2, [{ menuItemId: v.item("Tarta"), quantity: "1", hold: true }]),
      );
      await act((tx) =>
        writePartyAllergy(
          tx,
          ana.partyId,
          { answer: "allergies", guests: [{ who: "Window seat", allergens: { milk: {} } }] },
          OPERATOR,
        ),
      );
      const { guests } = await act((tx) => readPartyAllergy(tx, ana.partyId));
      const burger = await lineOn(b1, "Burger");
      const water = await lineOn(b1, "Agua");
      await act((tx) =>
        setAllergyLineTicks(tx, ana.partyId, [
          { guestId: guests[0]!.id, workingLineId: burger.id },
          { guestId: guests[0]!.id, workingLineId: water.id },
        ]),
      );

      // A loose dish cannot fire on arrival; the whole bill's can, and it needs the allergy copy first.
      const result = await splitSelected(ana.partyId, m5, {
        wholeBillIds: [b2],
        loose: [loose(b1, water.id)],
      });

      const source = await act((tx) => readPartyAllergy(tx, ana.partyId));
      const target = await act((tx) => readPartyAllergy(tx, result.partyId));
      expect(source.ticks).toEqual([
        { guestId: guests[0]!.id, draftLineId: null, workingLineId: burger.id },
      ]);
      expect(target.guests.map((guest) => guest.who)).toEqual(["Window seat"]);
      expect(target.ticks).toEqual([
        { guestId: target.guests[0]!.id, draftLineId: null, workingLineId: water.id },
      ]);
    });

    describe("a selection it cannot read", () => {
      it("a bill both whole and loose", async () => {
        const { ana, m5, b2 } = await threeBills("A803 Both");
        const vino = await lineOn(b2, "Vino");

        const error = await refusedWithNoRowChanged(() =>
          splitSelected(ana.partyId, m5, { wholeBillIds: [b2], loose: [loose(b2, vino.id)] }),
        );

        expect(error).toMatchObject({
          code: "management.request_invalid",
          params: { field: "selection" },
        });
      });

      it("one bill in two loose entries", async () => {
        const { ana, m5, b1 } = await tableFor("A803 Two entries", "Burger", "Agua");
        const burger = await lineOn(b1, "Burger");
        const water = await lineOn(b1, "Agua");

        const error = await refusedWithNoRowChanged(() =>
          splitSelected(ana.partyId, m5, {
            wholeBillIds: [],
            loose: [loose(b1, burger.id), loose(b1, water.id)],
          }),
        );

        expect(error).toMatchObject({
          code: "management.request_invalid",
          params: { field: "selection" },
        });
      });

      it("an empty entry", async () => {
        const { ana, m5, b2 } = await threeBills("A803 Empty");

        const error = await refusedWithNoRowChanged(() =>
          splitSelected(ana.partyId, m5, { wholeBillIds: [], loose: [loose(b2)] }),
        );

        expect(error).toMatchObject({
          code: "management.request_invalid",
          params: { field: "selection" },
        });
      });

      it("a line named twice is tab.transfer_duplicate_line", async () => {
        const { ana, m5, b1 } = await tableFor("A803 Repeated", "Burger", "Agua");
        const burger = await lineOn(b1, "Burger");

        const error = await refusedWithNoRowChanged(() =>
          splitSelected(ana.partyId, m5, {
            wholeBillIds: [],
            loose: [loose(b1, burger.id, burger.id)],
          }),
        );

        expect(error).toMatchObject({
          code: "tab.transfer_duplicate_line",
          params: { tabId: b1, lineNo: burger.lineNo },
        });
      });

      it("a line of another bill is tab.line_not_found, and no line of the named bill with that number moves", async () => {
        const { ana, m5, b1, b2 } = await threeBills("A803 Other bill");
        const vino = await lineOn(b2, "Vino");
        expect((await lineRows(b1)).map((line) => line.lineNo)).toContain(vino.lineNo);

        const error = await refusedWithNoRowChanged(() =>
          splitSelected(ana.partyId, m5, { wholeBillIds: [], loose: [loose(b1, vino.id)] }),
        );

        expect(error).toMatchObject({
          code: "tab.line_not_found",
          params: { tabId: b1, lineId: vino.id },
        });
      });
    });
  });
});
