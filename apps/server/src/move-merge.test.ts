import { readWholePortionLines } from "./order-portions.js";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { updateHeldOrder } from "./testing/order-writer-fixture.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql, getTableColumns } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  captureError,
  tableMerges,
  kitchenStations,
  parties,
  partyTables,
  printJobs,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
  diningTables,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { seedNode, seedTenant, seedVenue } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToVenue,
  assignProductUnit,
  createCatalogue,
  createCategory,
  createProduct,
  units,
} from "@waitron/catalogue";
import { centsToDecimal, decimalToCents, nodeId as brandNodeId, jobOrigin } from "@waitron/shared";
import type { OriginConfig } from "./trading-context.js";

import { createTable } from "./testing/live-table.js";
import { listStationQueues, moveOrderLines, storedOrderTotal } from "./working-order.js";
import { createPrinter } from "@waitron/printing";
import {
  kitchenNotices,
  setRoutingCell,
  listZoneOffers,
  recordWorkingLineContexts,
  workingLineContexts,
} from "@waitron/venue-service";
import { createStation, updateStation } from "./kitchen.js";
import { setStationPrinting } from "./testing/station-printing.js";

import { placeGroupedRound, placeGroups } from "./testing/group-submit-fixture.js";
import { attachPrinterToStation } from "./station-printers.js";
import { printedLines } from "./testing/decode-ticket.js";
import {
  OPERATOR,
  activeTablesOf,
  billRow,
  commandFor,
  inTx,
  join,
  nameParty,
  nextMillisecond,
  order,
  orderForParty,
  partyRow,
  pay,
  paymentsOf,
  revisionOf,
  seatWithNoAllergies as seat,
  setupPartyVenue,
  split,
  type PartyVenue,
} from "./testing/party-venue.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import "./errors.js";
import { openPartyTab } from "./testing/serve-line.js";
import {
  joinTables,
  combineParties,
  moveGuests,
  splitTable,
  type SplitSelection,
} from "./testing/table-action-fixture.js";
import { readBillEditState } from "./bill-editing.js";
import { discardDraft, readDrafts, type BillEditExpected } from "./order-drafts.js";
import { saveDraftForTest as saveDraft } from "./testing/draft-command-fixture.js";
import { finishTable } from "./testing/party-close-fixture.js";
import { numbersOf as billNumbersOf } from "./testing/bill-identities.js";
import { moveBill } from "./testing/move-bill-fixture.js";
import { mergeBills, moveDishes, splitBill, transferItems } from "./testing/bill-action-fixture.js";
import { fireGroup } from "./order-groups.js";
import {
  enqueueCorrectionSlips,
  enqueueOrderKitchenNoteChange,
  enqueueMovedSlipsForNamesGone,
  readPartiesSentWork,
  reprintOrderTickets,
} from "./kitchen-print.js";

/** Merge bills of `from` into `into` at `partyId`, in the caller's transaction, as staff do. */
async function mergeInTx(
  tx: Transaction,
  v: PartyVenue,
  partyId: string,
  into: string,
  from: string,
) {
  const [party] = await tx
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  return mergeBills(tx, v.cfg, into, from, {
    partyId,
    expectedPartyRevision: party!.revision,
    operatorId: OPERATOR,
  });
}

const LOCALE = "es-ES";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

interface Seeded {
  cfg: OriginConfig;
  coffeeId: string;
  waterId: string;
  /** "Bacon" — sold only as another dish's extra here, so a child line's product id can never be
   *  mistaken for a dish's. */
  baconId: string;
}

async function setupVenue(): Promise<Seeded> {
  await seedTenant(db);
  // Through the table definition rather than raw SQL: `units.id` is a `$defaultFn` generator a raw insert never reaches.
  await db.insert(units).values([
    {
      staffName: "Staff unit",
      staffAbbreviation: "su",
      seedKey: "each",
      name: { en: "each" },
      abbreviation: { en: "ea" },
      precision: 0,
      hardwareUnit: null,
    },
    {
      staffName: "Staff unit",
      staffAbbreviation: "su",
      seedKey: "kg",
      name: { en: "kg" },
      abbreviation: { en: "kg" },
      precision: 3,
      hardwareUnit: "kg",
    },
  ]);
  await seedVenue(db, {
    name: "Barra",
    invoiceLocales: [LOCALE],
    operationDescription: "Venta en establecimiento",
  });
  const nodeId = await seedNode(db);
  const cfg: OriginConfig = {
    origin: jobOrigin("dashboard"),
    nodeId: brandNodeId(nodeId),
    locale: LOCALE,
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const { coffeeId, waterId, baconId } = await withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Daily menu" });
    const drinksCategory = await createCategory(tx, { name: "Drinks" });
    const coffee = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: drinksCategory.id,
      name: "Café",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const water = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: drinksCategory.id,
      name: "Agua",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    const bacon = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: drinksCategory.id,
      name: "Bacon",
      pricingUnit: "each",
      unitPrice: "0.50",
      vatClass: "reduced",
    });
    await assignCatalogueToVenue(tx, cat.id);
    return { coffeeId: coffee.id, waterId: water.id, baconId: bacon.id };
  });
  offersByCfg.set(
    cfg,
    await withTransaction(db, (tx) => offerProducts(tx, cfg, { zone: "tables" })),
  );
  return { cfg, coffeeId, waterId, baconId };
}

/** Each venue's offers in its tables zone, keyed by the venue's config so call sites pass only `cfg`. */
const offersByCfg = new WeakMap<OriginConfig, ZoneOffers>();
function offersOf(cfg: OriginConfig): ZoneOffers {
  return offersByCfg.get(cfg)!;
}

function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

/** Create one active dining table in the venue's tables zone; returns its id. */
async function seedTable(cfg: OriginConfig, label: string): Promise<string> {
  const zoneId = offersOf(cfg).zoneId;
  return asApp((tx) => createTable(tx, cfg, { label, zoneId }).then((r) => r.id));
}

/** Open a tab on a table with the given lines; returns the tab (working_order) id. */
async function openTabOn(
  cfg: OriginConfig,
  tableId: string,
  lines: { productId: string; quantity: string }[],
): Promise<string> {
  return asApp((tx) =>
    openPartyTab(tx, cfg, { tableId, lines: offersOf(cfg).toOfferLines(lines) }).then(
      (r) => r.tabId,
    ),
  );
}

/** A tab's lines as { lineNo, productId, unitPriceGross }, in line_no order — owner read. */
async function linesOf(
  tabId: string,
): Promise<{ id: string; lineNo: number; productId: string | null; gross: string }[]> {
  const rows = await db
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      productId: workingOrderLines.productId,
      gross: workingOrderLines.unitPriceGross,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);
  // `unit_price_gross` stores a count of whole cents; the helper hands back the locked AMOUNT.
  return rows.map((row) => ({ ...row, gross: centsToDecimal(row.gross) }));
}

describe("moveOrderLines", () => {
  it("moves ALL lines from one open tab to another, appended at the next line_no, source emptied", async () => {
    const { cfg, coffeeId, waterId } = await setupVenue();
    const t1 = await seedTable(cfg, "M1");
    const t2 = await seedTable(cfg, "M2");
    const from = await openTabOn(cfg, t1, [{ productId: coffeeId, quantity: "1" }]);
    const to = await openTabOn(cfg, t2, [{ productId: waterId, quantity: "1" }]);
    const sourceLineId = (await linesOf(from))[0]!.id;

    await asApp((tx) => moveOrderLines(tx, cfg, from, to, undefined));

    const dest = await linesOf(to);
    expect(dest).toHaveLength(2);
    expect(dest.map((l) => l.lineNo)).toEqual([1, 2]);
    expect(dest.find((l) => l.productId === coffeeId)?.gross).toBe("1.50");
    expect(dest.find((l) => l.productId === coffeeId)?.id).toBe(sourceLineId);
    expect(await linesOf(from)).toHaveLength(0);
  });

  it("moves only the NAMED subset (the TS-4 shape), leaving the rest on the source", async () => {
    const { cfg, coffeeId, waterId } = await setupVenue();
    const t1 = await seedTable(cfg, "S1");
    const t2 = await seedTable(cfg, "S2");
    const from = await openTabOn(cfg, t1, [
      { productId: coffeeId, quantity: "1" },
      { productId: waterId, quantity: "1" },
    ]);
    const to = await openTabOn(cfg, t2, []);

    await asApp((tx) => moveOrderLines(tx, cfg, from, to, [2]));

    expect(await linesOf(to)).toHaveLength(1);
    expect((await linesOf(to))[0]!.productId).toBe(waterId);
    const remaining = await linesOf(from);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.productId).toBe(coffeeId);
  });

  it("moving from an EMPTY tab is a no-op (the empty-source guard), no error", async () => {
    const { cfg, waterId } = await setupVenue();
    const t1 = await seedTable(cfg, "E1");
    const t2 = await seedTable(cfg, "E2");
    const from = await openTabOn(cfg, t1, []); // empty tab
    const to = await openTabOn(cfg, t2, [{ productId: waterId, quantity: "1" }]);

    await asApp((tx) => moveOrderLines(tx, cfg, from, to, undefined));
    expect(await linesOf(to)).toHaveLength(1); // unchanged
  });

  it("refuses a non-open source or destination (tab.not_open)", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const t1 = await seedTable(cfg, "N1");
    const t2 = await seedTable(cfg, "N2");
    const from = await openTabOn(cfg, t1, [{ productId: coffeeId, quantity: "1" }]);
    const to = await openTabOn(cfg, t2, []);
    // Abandon the destination (owner write, fixture setup).
    await db.execute(sql`update working_orders set status = 'abandoned' where id = ${to}`);
    await expect(asApp((tx) => moveOrderLines(tx, cfg, from, to, undefined))).rejects.toMatchObject(
      {
        code: "tab.not_open",
        params: { tabId: to },
      },
    );
    await expect(asApp((tx) => moveOrderLines(tx, cfg, to, from, undefined))).rejects.toMatchObject(
      {
        code: "tab.not_open",
        params: { tabId: to },
      },
    );
    expect(await linesOf(from)).toHaveLength(1);
  });

  it("refuses a self-transfer (fromTabId === toTabId) with tab.merge_self and leaves the lines intact", async () => {
    const { cfg, coffeeId, waterId } = await setupVenue();
    const t = await seedTable(cfg, "ST");
    const tab = await openTabOn(cfg, t, [
      { productId: coffeeId, quantity: "1" },
      { productId: waterId, quantity: "1" },
    ]);
    // `mergeBills` guards this at its own top, but `moveOrderLines` is exported and must self-guard:
    // a "move all" onto itself would wipe the tab.
    await expect(asApp((tx) => moveOrderLines(tx, cfg, tab, tab, undefined))).rejects.toMatchObject(
      {
        code: "tab.merge_self",
        params: { tabId: tab },
      },
    );
    // The guard fires BEFORE any read/write, so the tab still holds both original lines.
    expect(await linesOf(tab)).toHaveLength(2);
  });
});

/** The kitchen notices recorded against the bills, oldest first. */
async function noticesOf(billIds: string[]) {
  return db
    .select({
      workingOrderId: kitchenNotices.workingOrderId,
      kind: kitchenNotices.kind,
      lineName: kitchenNotices.lineName,
      movedTo: kitchenNotices.movedTo,
    })
    .from(kitchenNotices)
    .where(inArray(kitchenNotices.workingOrderId, billIds))
    .orderBy(kitchenNotices.createdAt, sql`rowid`);
}

/** Each notice as its dish, bill and destination, sorted by dish, a duplicate kept. */
function byDish(notices: Awaited<ReturnType<typeof noticesOf>>): [string, string, string | null][] {
  return notices
    .map((n): [string, string, string | null] => [n.lineName, n.workingOrderId, n.movedTo])
    .sort(([a], [b]) => a.localeCompare(b));
}

/** One held dish added to the bill: the kitchen has not been sent it. */
async function holdOne(v: PartyVenue, billId: string, name: string): Promise<void> {
  await inTx(v, (tx) =>
    addTabRound(tx, v.cfg, billId, [{ menuItemId: v.item(name), quantity: "1", hold: true }]),
  );
}

/** A printer on the venue's default station; returns its id. */
async function kitchenPrinter(v: PartyVenue): Promise<string> {
  return inTx(v, async (tx) => {
    const [station] = await tx
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(sql`true`);
    const { id } = await createPrinter(tx, {
      name: "Cocina",
      transport: "cloud_poll",
      pollId: `poll-${randomUUID()}`,
    });
    await attachPrinterToStation(tx, {
      stationId: station!.id,
      printerId: id,
    });
    return id;
  });
}

/** Each job the printer was sent, as its printed lines joined, oldest first. */
async function printedBy(printerId: string): Promise<string[]> {
  const jobs = await db
    .select({ payload: printJobs.payload })
    .from(printJobs)
    .where(eq(printJobs.printerId, printerId))
    .orderBy(sql`rowid`);
  return jobs.map((job) => printedLines(job.payload).join("\n"));
}

/**
 * Spec decision 9 and §8: a party's slips name its tables together, so a table action that changes
 * them changes the destination of the sent dishes on every bill of the party.
 */
describe("a table action tells the kitchen of every bill of the party", () => {
  it("tells the kitchen nothing of a party that joins a free table: no bill lost a table or a name", async () => {
    const v = await setupPartyVenue(db);
    const table4 = await v.table("Mesa 4");
    const table5 = await v.table("Mesa 5");
    const { partyId, tabId } = await seat(v, table4);
    await orderForParty(v, partyId, ["Burger"], tabId);
    await orderForParty(v, partyId, ["Red wine bottle"], tabId);
    const checkId = await split(v, partyId, tabId, [2]);
    await holdOne(v, tabId, "Water");
    const before = await noticesOf([tabId, checkId]);

    await join(v, partyId, table5);

    expect((await noticesOf([tabId, checkId])).slice(before.length)).toEqual([]);
  });

  it("tells the kitchen only of the leaving bill when a table leaves the party, naming the tables its dishes had", async () => {
    const v = await setupPartyVenue(db);
    const printerId = await kitchenPrinter(v);
    const table4 = await v.table("Mesa 4");
    const table5 = await v.table("Mesa 5");
    const { partyId, tabId } = await seat(v, table4);
    await join(v, partyId, table5);
    await orderForParty(v, partyId, ["Burger", "Red wine bottle", "Flan"], tabId);
    const checkId = await split(v, partyId, tabId, [2]);
    const newTabId = await split(v, partyId, tabId, [1]);
    const command = await commandFor(v, partyId);
    const before = await noticesOf([tabId, checkId, newTabId]);
    const printed = (await printedBy(printerId)).length;

    await inTx(v, (tx) => splitTable(tx, v.cfg, partyId, table5, newTabId, command));

    const notices = (await noticesOf([tabId, checkId, newTabId])).slice(before.length);
    expect(byDish(notices)).toEqual([["BURG", newTabId, "Mesa 5"]]);
    const slips = (await printedBy(printerId))
      .slice(printed)
      .filter((slip) => slip.includes("*** MOVIDO ***"));
    expect(slips.map((slip) => slip.split("\n").slice(3, 5))).toEqual([
      ["De: Mesa 4, 5", "A:  Mesa 5"],
    ]);
  });

  it("tells the kitchen nothing of the party's sent dishes when an empty table leaves it", async () => {
    const v = await setupPartyVenue(db);
    const table4 = await v.table("Mesa 4");
    const table5 = await v.table("Mesa 5");
    const { partyId, tabId } = await seat(v, table4);
    await join(v, partyId, table5);
    await orderForParty(v, partyId, ["Burger"], tabId);
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) => splitTable(tx, v.cfg, partyId, table5, null, command));

    expect(await noticesOf([tabId])).toEqual([]);
  });

  it("tells the kitchen of every bill of a party whose tab moves to another table", async () => {
    const v = await setupPartyVenue(db);
    const table4 = await v.table("Mesa 4");
    const table5 = await v.table("Mesa 5");
    const table9 = await v.table("Mesa 9");
    const { partyId, tabId } = await seat(v, table4);
    await join(v, partyId, table5);
    await orderForParty(v, partyId, ["Burger", "Red wine bottle"], tabId);
    const checkId = await split(v, partyId, tabId, [2]);
    const command = await commandFor(v, partyId);
    const before = await noticesOf([tabId, checkId]);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, table9, { ...command, otherPartyId: null }),
    );

    const notices = (await noticesOf([tabId, checkId])).slice(before.length);
    expect(byDish(notices)).toEqual([
      ["BURG", tabId, "Mesa 9"],
      ["TINTO", checkId, "Mesa 9"],
    ]);
  });

  it("tells the kitchen nothing of the bills of a party that takes in another party's table, and of the bill merged in only that its dishes are on another order", async () => {
    const v = await setupPartyVenue(db);
    const table4 = await v.table("Mesa 4");
    const table7 = await v.table("Mesa 7");
    const anna = await seat(v, table4);
    await orderForParty(v, anna.partyId, ["Burger", "Red wine bottle"], anna.tabId);
    const checkId = await split(v, anna.partyId, anna.tabId, [2]);
    await nextMillisecond();
    const other = await seat(v, table7);
    await orderForParty(v, other.partyId, ["Flan"], other.tabId);
    const expectedPartyRevision = await revisionOf(v, anna.partyId);
    const expectedOtherPartyRevision = await revisionOf(v, other.partyId);
    const before = await noticesOf([anna.tabId, checkId, other.tabId]);
    await nextMillisecond();

    await inTx(v, async (tx) => {
      await joinTables(tx, v.cfg, anna.partyId, table7, {
        expectedPartyRevision,
        otherPartyId: other.partyId,
        expectedOtherPartyRevision,
        operatorId: OPERATOR,
      });
      await mergeInTx(tx, v, anna.partyId, anna.tabId, other.tabId);
    });

    expect(await noticesOf([anna.tabId, checkId, other.tabId])).toEqual([
      ...before,
      { workingOrderId: anna.tabId, kind: "moved", lineName: "FLAN", movedTo: "Mesa 4, 7" },
    ]);
  });

  it("tells the kitchen nothing of the bills of the party taken in, which all stay their own and keep their table and name", async () => {
    const v = await setupPartyVenue(db);
    const table4 = await v.table("Mesa 4");
    const table7 = await v.table("Mesa 7");
    const anna = await seat(v, table4);
    await nextMillisecond();
    const other = await seat(v, table7);
    await orderForParty(v, other.partyId, ["Flan", "Tarta"], other.tabId);
    const otherCheckId = await split(v, other.partyId, other.tabId, [2]);
    const expectedPartyRevision = await revisionOf(v, anna.partyId);
    const expectedOtherPartyRevision = await revisionOf(v, other.partyId);
    const before = await noticesOf([anna.tabId, other.tabId, otherCheckId]);
    await nextMillisecond();

    await inTx(v, (tx) =>
      joinTables(tx, v.cfg, anna.partyId, table7, {
        expectedPartyRevision,
        otherPartyId: other.partyId,
        expectedOtherPartyRevision,
        operatorId: OPERATOR,
      }),
    );

    expect(await noticesOf([anna.tabId, other.tabId, otherCheckId])).toEqual(before);
    for (const kept of [other.tabId, otherCheckId])
      expect(await billRow(v, kept)).toMatchObject({ status: "open", partyId: anna.partyId });
  });
});

/**
 * A station named `name` with its own printer, taking each of `dishes`; returns the printer's id.
 */
async function stationWithPrinter(v: PartyVenue, name: string, dishes: string[]): Promise<string> {
  return inTx(v, async (tx) => {
    const station = await createStation(tx, { name });
    const { id } = await createPrinter(tx, {
      name: `${name} printer`,
      transport: "cloud_poll",
      pollId: `poll-${randomUUID()}`,
    });
    await attachPrinterToStation(tx, {
      stationId: station.id,
      printerId: id,
    });
    for (const dish of dishes)
      await setRoutingCell(
        tx,
        { row: { kind: "product", productId: v.productId(dish) }, zoneId: null },
        { kind: "station", stationId: station.id },
      );
    return id;
  });
}

/** The id of the active station named `name`. */
async function activeStationId(tx: Transaction, name: string): Promise<string> {
  const [row] = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.name, name), eq(kitchenStations.active, true)));
  return row!.id;
}

describe("a MOVED slip per order per station", () => {
  it("prints one slip for each order at each station, listing that order's dishes there", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    const desserts = await stationWithPrinter(v, "Postres", ["Flan"]);
    const table11 = await v.table("Mesa 11");
    const table12 = await v.table("Mesa 12");
    const { partyId, tabId } = await seat(v, table11);
    await nameParty(v, partyId, "Ana");
    await inTx(v, (tx) =>
      placeGroupedRound(
        tx,
        v.cfg,
        { partyId, tabId },
        {
          lines: [
            { menuItemId: v.item("Burger"), quantity: "2" },
            { menuItemId: v.item("Paella"), quantity: "1" },
            { menuItemId: v.item("Flan"), quantity: "1" },
            { menuItemId: v.item("Burger"), quantity: "1" },
          ],
          release: "fire",
        },
        OPERATOR,
      ),
    );
    const checkId = await split(v, partyId, tabId, [4]);
    const numbers = await db
      .select({ id: workingOrders.id, orderNumber: workingOrders.orderNumber })
      .from(workingOrders)
      .where(inArray(workingOrders.id, [tabId, checkId]));
    const numberOf = (id: string) => numbers.find((row) => row.id === id)!.orderNumber;
    const grillBefore = (await printedBy(grill)).length;
    const dessertsBefore = (await printedBy(desserts)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, table12, { ...command, otherPartyId: null }),
    );

    const slip = (orderNumber: number, dishes: string[], station: string) => [
      "*** MOVIDO ***",
      station,
      `Pedido ${orderNumber} · Ana`,
      "De: Mesa 11",
      "A:  Mesa 12",
      expect.stringMatching(/^\d\d:\d\d$/),
      ...dishes,
      "",
    ];
    const grillSlips = (await printedBy(grill)).slice(grillBefore);
    const dessertsSlips = (await printedBy(desserts)).slice(dessertsBefore);
    expect(grillSlips.map((text) => text.split("\n"))).toEqual(
      expect.arrayContaining([
        slip(numberOf(tabId), ["2 x BURG", "1 x PAELLA"], "Grill"),
        slip(numberOf(checkId), ["1 x BURG"], "Grill"),
      ]),
    );
    expect(grillSlips).toHaveLength(2);
    expect(dessertsSlips.map((text) => text.split("\n"))).toEqual([
      slip(numberOf(tabId), ["1 x FLAN"], "Postres"),
    ]);
  });

  it("lists a station's dishes as its tickets do: group-less ones first, then group by group", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    const table15 = await v.table("Mesa 15");
    const table16 = await v.table("Mesa 16");
    const { partyId, tabId } = await seat(v, table15);
    await orderForParty(v, partyId, ["Burger"], tabId);
    await orderForParty(v, partyId, ["Paella"], tabId);
    await order(v, tabId, "Burger");
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, table16, { ...command, otherPartyId: null }),
    );

    const slips = (await printedBy(grill)).slice(before).map((text) => text.split("\n"));
    expect(slips).toHaveLength(1);
    expect(slips[0]!.slice(6)).toEqual([
      "1 x BURG",
      `${kitchenTicketWords("es").group} 1`,
      "1 x BURG",
      `${kitchenTicketWords("es").group} 2`,
      "1 x PAELLA",
      "",
    ]);
  });

  it("names the party a bill moved to the counter left, and words the counter", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    const table13 = await v.table("Mesa 13");
    const { partyId, tabId } = await seat(v, table13);
    await nameParty(v, partyId, "Ana");
    await order(v, tabId, "Paella", "Burger");
    const second = await split(v, partyId, tabId, [2]);
    const number = (
      await db
        .select({ orderNumber: workingOrders.orderNumber })
        .from(workingOrders)
        .where(eq(workingOrders.id, second))
    )[0]!.orderNumber;
    const before = (await printedBy(grill)).length;
    const expectedPartyRevision = await revisionOf(v, partyId);

    await inTx(v, (tx) =>
      moveBill(
        tx,
        v.cfg,
        second,
        { counter: { zoneId: v.counter.zoneId } },
        { operatorId: OPERATOR, expectedPartyRevision },
      ),
    );

    const slips = (await printedBy(grill)).slice(before).map((text) => text.split("\n"));
    expect(slips.map((lines) => lines.slice(0, 5))).toEqual([
      ["*** MOVIDO ***", "Grill", `Pedido ${number} · Ana`, "De: Mesa 13", "A:  (mostrador)"],
    ]);
  });

  it("names the party a kept bill's party was merged into", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    const table21 = await v.table("Mesa 21");
    const table22 = await v.table("Mesa 22");
    const anna = await seat(v, table21);
    await nameParty(v, anna.partyId, "Ana");
    await nextMillisecond();
    const lewis = await seat(v, table22);
    await nameParty(v, lewis.partyId, "Luis");
    await order(v, anna.tabId, "Burger");
    await pay(v, anna.tabId, "12.00");
    const number = (
      await db
        .select({ orderNumber: workingOrders.orderNumber })
        .from(workingOrders)
        .where(eq(workingOrders.id, anna.tabId))
    )[0]!.orderNumber;
    const before = (await printedBy(grill)).length;
    const expectedPartyRevision = await revisionOf(v, anna.partyId);
    const expectedOtherPartyRevision = await revisionOf(v, lewis.partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, anna.partyId, table22, {
        expectedPartyRevision,
        otherPartyId: lewis.partyId,
        expectedOtherPartyRevision,
        operatorId: OPERATOR,
      }),
    );

    const slips = (await printedBy(grill)).slice(before).map((text) => text.split("\n"));
    expect(slips.map((lines) => lines.slice(0, 5))).toEqual([
      ["*** MOVIDO ***", "Grill", `Pedido ${number} · Luis`, "De: Mesa 21", "A:  Mesa 22"],
    ]);
  });
});

/** Puts the tables into one of today's groups, named `name`. */
async function group(v: PartyVenue, name: string, tableIds: string[]): Promise<void> {
  await inTx(v, async (tx) => {
    const [row] = await tx
      .insert(tableMerges)
      .values({ zoneId: v.tables.zoneId, seats: 8, name })
      .returning({ id: tableMerges.id });
    for (const tableId of tableIds)
      await tx
        .update(diningTables)
        .set({ mergeId: row!.id, mergeBeforeX: 0, mergeBeforeY: 0, mergeBeforeRotation: 0 })
        .where(eq(diningTables.id, tableId));
  });
}

describe("when a MOVED slip prints: a table or a place name lost (§3)", () => {
  it("a free table joined prints nothing and records no notice: no table and no name is lost (row 6)", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    const table71 = await v.table("Mesa 71");
    const table72 = await v.table("Mesa 72");
    const { partyId, tabId } = await seat(v, table71);
    await order(v, tabId, "Burger");
    const before = (await printedBy(grill)).length;
    const notices = await noticesOf([tabId]);

    await join(v, partyId, table72);

    expect((await printedBy(grill)).slice(before)).toEqual([]);
    expect(await noticesOf([tabId])).toEqual(notices);
  });

  it("Split a table with no bill chosen prints nothing for the bills that stay (spec §3.7)", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    const table51 = await v.table("Mesa 51");
    const table52 = await v.table("Mesa 52");
    const { partyId, tabId } = await seat(v, table51);
    await join(v, partyId, table52);
    await order(v, tabId, "Burger", "Burger");
    await split(v, partyId, tabId, [2]);
    const before = (await printedBy(grill)).length;
    expect(before).toBeGreaterThan(0);
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) => splitTable(tx, v.cfg, partyId, table52, null, command));

    expect((await printedBy(grill)).slice(before)).toEqual([]);
  });

  it("a bill moved between two tables of the group Terraza names each side's table in brackets (row 12b)", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    const table77 = await v.table("Mesa 77");
    const table78 = await v.table("Mesa 78");
    const { partyId, tabId } = await seat(v, table77);
    // Seating a grouped table seats the whole group, so the group forms after the party sits.
    await group(v, "Terraza", [table77, table78]);
    await order(v, tabId, "Paella", "Burger");
    const second = await split(v, partyId, tabId, [2]);
    const before = (await printedBy(grill)).length;
    const expectedPartyRevision = await revisionOf(v, partyId);

    await inTx(v, (tx) =>
      moveBill(
        tx,
        v.cfg,
        second,
        { tableId: table78 },
        { operatorId: OPERATOR, expectedPartyRevision },
      ),
    );

    const slips = (await printedBy(grill)).slice(before).map((text) => text.split("\n"));
    expect(slips.map((lines) => lines.slice(3, 5))).toEqual([
      ["De: Terraza (Mesa 77)", "A:  Terraza (Mesa 78)"],
    ]);
    // The first is the split's, on the same tables; the second the move's, the slip's To text.
    expect((await noticesOf([second])).map((n) => n.movedTo)).toEqual([
      "Terraza",
      "Terraza (Mesa 78)",
    ]);
  });
});

/** Each bill's order number, keyed by bill. */
async function numbersOf(billIds: string[]): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: workingOrders.id, orderNumber: workingOrders.orderNumber })
    .from(workingOrders)
    .where(inArray(workingOrders.id, billIds));
  return new Map(rows.map((row) => [row.id, row.orderNumber]));
}

/** The jobs the printer was sent from `from` on, each as its printed lines. */
async function slipsSince(printerId: string, from: number): Promise<string[][]> {
  return (await printedBy(printerId)).slice(from).map((text) => text.split("\n"));
}

/** A MOVED slip's printed lines, its time matched by shape. */
function movedSlip(station: string, orderLine: string, from: string, to: string, dishes: string[]) {
  return [
    "*** MOVIDO ***",
    station,
    orderLine,
    `De: ${from}`,
    `A:  ${to}`,
    expect.stringMatching(/^\d\d:\d\d$/),
    ...dishes,
    "",
  ];
}

describe("when a MOVED slip prints: the dishes are on an order with another number (§3 (c))", () => {
  it("a join of another party's table prints nothing, every order keeping its number; Merge bills afterwards prints the merged-in order's dishes at Mesa 73, 74, and nothing for the surviving order (row 7)", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    const table73 = await v.table("Mesa 73");
    const table74 = await v.table("Mesa 74");
    const anna = await seat(v, table73);
    await order(v, anna.tabId, "Burger");
    await nextMillisecond();
    const lewis = await seat(v, table74);
    await order(v, lewis.tabId, "Paella");
    const numbers = await numbersOf([anna.tabId, lewis.tabId]);
    const before = (await printedBy(grill)).length;
    const expectedPartyRevision = await revisionOf(v, anna.partyId);
    const expectedOtherPartyRevision = await revisionOf(v, lewis.partyId);

    await inTx(v, (tx) =>
      joinTables(tx, v.cfg, anna.partyId, table74, {
        expectedPartyRevision,
        otherPartyId: lewis.partyId,
        expectedOtherPartyRevision,
        operatorId: OPERATOR,
      }),
    );

    expect(await slipsSince(grill, before)).toEqual([]);
    expect(await numbersOf([anna.tabId, lewis.tabId])).toEqual(numbers);

    await inTx(v, (tx) => mergeInTx(tx, v, anna.partyId, anna.tabId, lewis.tabId));

    expect(await slipsSince(grill, before)).toEqual([
      movedSlip(
        "Grill",
        `Pedido ${numbers.get(lewis.tabId)} -> ${numbers.get(anna.tabId)}`,
        "Mesa 73, 74",
        "Mesa 73, 74",
        ["1 x PAELLA"],
      ),
    ]);
  });

  it("Merge bills at Mesa 91 prints the merged-in order's dishes, From and To both Mesa 91, and nothing for the surviving order (row 16a)", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    const { partyId, tabId } = await seat(v, await v.table("Mesa 91"));
    await order(v, tabId, "Burger", "Paella");
    const second = await split(v, partyId, tabId, [2]);
    const numbers = await numbersOf([tabId, second]);
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) => mergeBills(tx, v.cfg, tabId, second, command));

    expect(await slipsSince(grill, before)).toEqual([
      movedSlip(
        "Grill",
        `Pedido ${numbers.get(second)} -> ${numbers.get(tabId)}`,
        "Mesa 91",
        "Mesa 91",
        ["1 x PAELLA"],
      ),
    ]);
  });

  it("Split the bill prints one slip of the dishes split off, at their station, onto the new order (row 16c)", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    const desserts = await stationWithPrinter(v, "Postres", ["Flan"]);
    const { partyId, tabId } = await seat(v, await v.table("Mesa 91"));
    await order(v, tabId, "Burger", "Flan");
    const grillBefore = (await printedBy(grill)).length;
    const dessertsBefore = (await printedBy(desserts)).length;
    const notices = await noticesOf([tabId]);

    const second = await split(v, partyId, tabId, [2]);

    const numbers = await numbersOf([tabId, second]);
    expect(await slipsSince(desserts, dessertsBefore)).toEqual([
      movedSlip(
        "Postres",
        `Pedido ${numbers.get(tabId)} -> ${numbers.get(second)}`,
        "Mesa 91",
        "Mesa 91",
        ["1 x FLAN"],
      ),
    ]);
    expect(await slipsSince(grill, grillBefore)).toEqual([]);
    expect(await noticesOf([tabId])).toEqual(notices);
    expect(byDish(await noticesOf([second]))).toEqual([["FLAN", second, "Mesa 91"]]);
  });

  it("splitting off, or transferring, a dish the kitchen was never sent prints nothing and records no notice", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    await inTx(v, (tx) =>
      setRoutingCell(
        tx,
        { row: { kind: "product", productId: v.productId("Water") }, zoneId: null },
        { kind: "no_preparation" },
      ),
    );
    const { partyId, tabId } = await seat(v, await v.table("Mesa 93"));
    await order(v, tabId, "Burger", "Water", "Water");
    const before = (await printedBy(grill)).length;

    const second = await split(v, partyId, tabId, [2]);
    const command = await commandFor(v, partyId);
    await inTx(v, (tx) => transferItems(tx, v.cfg, tabId, second, [{ lineNo: 3 }], command));

    expect(await slipsSince(grill, before)).toEqual([]);
    expect(await noticesOf([tabId, second])).toEqual([]);
  });

  it("a counter order split prints From and To as the counter (row 16c)", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    const { partyId, tabId } = await seat(v, await v.table("Mesa 94"));
    await order(v, tabId, "Paella", "Burger", "Burger");
    const counter = await split(v, partyId, tabId, [2, 3]);
    const expectedPartyRevision = await revisionOf(v, partyId);
    await inTx(v, (tx) =>
      moveBill(
        tx,
        v.cfg,
        counter,
        { counter: { zoneId: null } },
        { operatorId: OPERATOR, expectedPartyRevision },
      ),
    );
    const before = (await printedBy(grill)).length;

    const { billId: made } = await inTx(v, (tx) =>
      splitBill(tx, v.cfg, counter, [{ lineNo: 2 }], { operatorId: OPERATOR }),
    );

    const numbers = await numbersOf([counter, made]);
    expect(await slipsSince(grill, before)).toEqual([
      movedSlip(
        "Grill",
        `Pedido ${numbers.get(counter)} -> ${numbers.get(made)}`,
        "(mostrador)",
        "(mostrador)",
        ["1 x BURG"],
      ),
    ]);
  });
});

/** A fired Burger in group 1 and a held Paella in group 2 placed on the bill. */
async function burgerAndHeldPaella(v: PartyVenue, partyId: string, billId: string): Promise<void> {
  await inTx(v, (tx) =>
    placeGroups(tx, v.cfg, partyId, {
      groups: [
        { lines: [{ menuItemId: v.item("Burger"), quantity: "1" }], release: "fire" },
        { lines: [{ menuItemId: v.item("Paella"), quantity: "1" }], release: "hold" },
      ],
      operatorId: OPERATOR,
      billId,
    }),
  );
}

describe("A803 split: what the kitchen is told", () => {
  const dishes = ["Burger", "Flan", "Paella", "Red wine bottle"];
  const loose = (billId: string, ...lineIds: string[]) => ({ billId, lineIds });

  /** Ana at Mesa `first` and Mesa `second`, a printing station for every dish. */
  async function twoTables(first: number, second: number) {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", dishes);
    const stay = await v.table(`Mesa ${first}`);
    const leave = await v.table(`Mesa ${second}`);
    const anna = await seat(v, stay);
    await join(v, anna.partyId, leave);
    return { v, grill, stay, leave, ...anna };
  }

  /** The first line of the dish on the bill. */
  async function lineId(v: PartyVenue, billId: string, dish: string): Promise<string> {
    const line = (await linesOf(billId)).find((row) => row.productId === v.productId(dish));
    return line!.id;
  }

  /** `splitTable` with the selection, expecting every bill it names as it reads now. */
  async function splitPicked(
    v: PartyVenue,
    partyId: string,
    tableId: string,
    selection: SplitSelection,
  ) {
    const named = [...selection.wholeBillIds, ...selection.loose.map((entry) => entry.billId)];
    const command = await commandFor(v, partyId);
    const expectedEdits: BillEditExpected[] = [];
    await inTx(v, async (tx) => {
      for (const billId of [...named].sort())
        expectedEdits.push(await readBillEditState(tx, billId));
    });
    return inTx(v, (tx) =>
      splitTable(tx, v.cfg, partyId, tableId, selection, { ...command, expectedEdits }),
    );
  }

  async function orderLine(from: string, to: string): Promise<string> {
    const numbers = await numbersOf([from, to]);
    return `Pedido ${numbers.get(from)} -> ${numbers.get(to)}`;
  }

  it("a loose dish gets a notice and a slip naming only it, the source's other dishes nothing", async () => {
    const { v, grill, leave, partyId, tabId } = await twoTables(51, 52);
    await order(v, tabId, "Burger", "Flan");
    const burger = await lineId(v, tabId, "Burger");
    const before = (await printedBy(grill)).length;
    expect(before).toBeGreaterThan(0);

    const { billId: newBill } = await splitPicked(v, partyId, leave, {
      wholeBillIds: [],
      loose: [loose(tabId, burger)],
    });

    expect(await noticesOf([tabId, newBill])).toEqual([
      { workingOrderId: newBill, kind: "moved", lineName: "BURG", movedTo: "Mesa 52" },
    ]);
    expect(await slipsSince(grill, before)).toEqual([
      movedSlip("Grill", await orderLine(tabId, newBill), "Mesa 51, 52", "Mesa 52", ["1 x BURG"]),
    ]);
  });

  it("a whole bill's dishes are told; a staying bill's are not", async () => {
    const { v, grill, leave, partyId, tabId } = await twoTables(51, 52);
    await order(v, tabId, "Burger", "Flan");
    const second = await split(v, partyId, tabId, [2]);
    const before = (await printedBy(grill)).length;
    expect(before).toBeGreaterThan(0);
    const earlier = (await noticesOf([tabId, second])).length;

    await splitPicked(v, partyId, leave, { wholeBillIds: [second], loose: [] });

    const numbers = await numbersOf([second]);
    expect((await noticesOf([tabId, second])).slice(earlier)).toEqual([
      { workingOrderId: second, kind: "moved", lineName: "FLAN", movedTo: "Mesa 52" },
    ]);
    expect(await slipsSince(grill, before)).toEqual([
      movedSlip("Grill", `Pedido ${numbers.get(second)}`, "Mesa 51, 52", "Mesa 52", ["1 x FLAN"]),
    ]);
  });

  it("two sources give one slip each, each under the order number the dish was sent on", async () => {
    const { v, grill, leave, partyId, tabId } = await twoTables(51, 52);
    await order(v, tabId, "Burger", "Flan", "Paella");
    const second = await split(v, partyId, tabId, [2]);
    const burger = await lineId(v, tabId, "Burger");
    const flan = await lineId(v, second, "Flan");
    const before = (await printedBy(grill)).length;
    expect(before).toBeGreaterThan(0);
    const earlier = (await noticesOf([tabId, second])).length;

    const { billId: newBill } = await splitPicked(v, partyId, leave, {
      wholeBillIds: [],
      loose: [loose(second, flan), loose(tabId, burger)],
    });

    expect((await noticesOf([tabId, second, newBill])).slice(earlier)).toEqual([
      { workingOrderId: newBill, kind: "moved", lineName: "BURG", movedTo: "Mesa 52" },
      { workingOrderId: newBill, kind: "moved", lineName: "FLAN", movedTo: "Mesa 52" },
    ]);
    expect(await slipsSince(grill, before)).toEqual([
      movedSlip("Grill", await orderLine(tabId, newBill), "Mesa 51, 52", "Mesa 52", ["1 x BURG"]),
      movedSlip("Grill", await orderLine(second, newBill), "Mesa 51, 52", "Mesa 52", ["1 x FLAN"]),
    ]);
  });

  it("nothing selected tells the kitchen nothing", async () => {
    const { v, grill, leave, partyId, tabId } = await twoTables(51, 52);
    await order(v, tabId, "Burger");
    const before = (await printedBy(grill)).length;
    expect(before).toBeGreaterThan(0);

    await splitPicked(v, partyId, leave, { wholeBillIds: [], loose: [] });

    expect(await noticesOf([tabId])).toEqual([]);
    expect(await slipsSince(grill, before)).toEqual([]);
  });

  it("a staying dish whose paper's every name has gone is told, from that name to what it now reads", async () => {
    const { v, grill, stay, leave, partyId, tabId } = await twoTables(51, 52);
    await group(v, "Terraza", [stay, leave]);
    await order(v, tabId, "Burger");
    const before = (await printedBy(grill)).length;
    expect(before).toBeGreaterThan(0);

    await splitPicked(v, partyId, leave, { wholeBillIds: [], loose: [] });

    const numbers = await numbersOf([tabId]);
    expect(await noticesOf([tabId])).toEqual([
      { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 51" },
    ]);
    expect(await slipsSince(grill, before)).toEqual([
      movedSlip("Grill", `Pedido ${numbers.get(tabId)}`, "Terraza", "Mesa 51", ["1 x BURG"]),
    ]);
  });

  describe("a staying dish with one name of its paper left is not told", () => {
    it("a group whose name survives the split", async () => {
      const { v, grill, stay, leave, partyId, tabId } = await twoTables(51, 52);
      const third = await v.table("Mesa 53");
      await join(v, partyId, third);
      await group(v, "Terraza", [stay, leave, third]);
      await order(v, tabId, "Burger");
      const before = (await printedBy(grill)).length;
      expect(before).toBeGreaterThan(0);

      await splitPicked(v, partyId, leave, { wholeBillIds: [], loose: [] });

      expect(await noticesOf([tabId])).toEqual([]);
      expect(await slipsSince(grill, before)).toEqual([]);
    });

    it("plain Mesa 51 and 52, down to Mesa 51", async () => {
      const { v, grill, leave, partyId, tabId } = await twoTables(51, 52);
      await order(v, tabId, "Burger");
      const before = (await printedBy(grill)).length;
      expect(before).toBeGreaterThan(0);

      await splitPicked(v, partyId, leave, { wholeBillIds: [], loose: [] });

      expect(await noticesOf([tabId])).toEqual([]);
      expect(await slipsSince(grill, before)).toEqual([]);
    });
  });

  it("a loose source's staying dish is told once when its name has gone, and the dish that left once, on the new bill", async () => {
    const { v, grill, stay, leave, partyId, tabId } = await twoTables(51, 52);
    await group(v, "Terraza", [stay, leave]);
    await order(v, tabId, "Burger", "Flan");
    const burger = await lineId(v, tabId, "Burger");
    const before = (await printedBy(grill)).length;
    expect(before).toBeGreaterThan(0);

    const { billId: newBill } = await splitPicked(v, partyId, leave, {
      wholeBillIds: [],
      loose: [loose(tabId, burger)],
    });

    const numbers = await numbersOf([tabId]);
    expect(await noticesOf([tabId, newBill])).toEqual([
      { workingOrderId: newBill, kind: "moved", lineName: "BURG", movedTo: "Mesa 52" },
      { workingOrderId: tabId, kind: "moved", lineName: "FLAN", movedTo: "Mesa 51" },
    ]);
    expect(await slipsSince(grill, before)).toEqual([
      movedSlip("Grill", await orderLine(tabId, newBill), "Terraza", "Mesa 52", ["1 x BURG"]),
      movedSlip("Grill", `Pedido ${numbers.get(tabId)}`, "Terraza", "Mesa 51", ["1 x FLAN"]),
    ]);
  });

  it("a paper that printed no name is not told", async () => {
    const { v, partyId, tabId } = await twoTables(51, 52);
    await order(v, tabId, "Burger");
    const earlier = await noticesOf([tabId]);

    await inTx(v, async (tx) => {
      const work = (await readPartiesSentWork(tx, [partyId])).get(tabId)!;
      const noName = { ...work, places: { ...work.places, names: [] } };
      await enqueueMovedSlipsForNamesGone(tx, v.cfg, new Map([[tabId, noName]]), new Map());
    });

    expect(earlier).toEqual([]);
    expect(await noticesOf([tabId])).toEqual([]);
  });

  it("a loose source left with no dish, whose name has gone, tells only the dish that left", async () => {
    const { v, grill, stay, leave, partyId, tabId } = await twoTables(51, 52);
    await group(v, "Terraza", [stay, leave]);
    await order(v, tabId, "Burger");
    const burger = await lineId(v, tabId, "Burger");
    const before = (await printedBy(grill)).length;
    expect(before).toBeGreaterThan(0);

    const { billId: newBill } = await splitPicked(v, partyId, leave, {
      wholeBillIds: [],
      loose: [loose(tabId, burger)],
    });

    expect(await noticesOf([tabId, newBill])).toEqual([
      { workingOrderId: newBill, kind: "moved", lineName: "BURG", movedTo: "Mesa 52" },
    ]);
    expect(await slipsSince(grill, before)).toEqual([
      movedSlip("Grill", await orderLine(tabId, newBill), "Terraza", "Mesa 52", ["1 x BURG"]),
    ]);
  });

  it("a loose source whose name has gone, left with only the person's own unsent dish, tells only the dish that left", async () => {
    const { v, grill, stay, leave, partyId, tabId } = await twoTables(51, 52);
    await group(v, "Terraza", [stay, leave]);
    await order(v, tabId, "Burger");
    const burger = await lineId(v, tabId, "Burger");
    await inTx(v, (tx) =>
      saveDraft(tx, v.cfg, partyId, OPERATOR, {
        billId: tabId,
        draftId: null,
        revision: 0,
        lines: [{ menuItemId: v.item("Paella"), quantity: "1" }],
      }),
    );
    const before = (await printedBy(grill)).length;
    expect(before).toBeGreaterThan(0);

    const { billId: newBill } = await splitPicked(v, partyId, leave, {
      wholeBillIds: [],
      loose: [loose(tabId, burger)],
    });

    expect(await linesOf(tabId)).toEqual([]);
    expect(await noticesOf([tabId, newBill])).toEqual([
      { workingOrderId: newBill, kind: "moved", lineName: "BURG", movedTo: "Mesa 52" },
    ]);
    expect(await slipsSince(grill, before)).toEqual([
      movedSlip("Grill", await orderLine(tabId, newBill), "Terraza", "Mesa 52", ["1 x BURG"]),
    ]);
  });

  describe("a staying dish is told by what its own paper printed", () => {
    /** Ana at Mesa `first` alone, a printing station for every dish. */
    async function oneTable(first: number) {
      const v = await setupPartyVenue(db);
      const grill = await stationWithPrinter(v, "Grill", dishes);
      const firstTable = await v.table(`Mesa ${first}`);
      const anna = await seat(v, firstTable);
      return { v, grill, first: firstTable, ...anna };
    }

    const justOrderLine = async (billId: string) =>
      `Pedido ${(await numbersOf([billId])).get(billId)}`;

    it("a dish sent before a table joined is told when the only table on its ticket leaves", async () => {
      const { v, grill, first, partyId, tabId } = await oneTable(201);
      await orderForParty(v, partyId, ["Burger"], tabId);
      const second = await v.table("Mesa 202");
      await join(v, partyId, second);
      const before = (await printedBy(grill)).length;
      expect((await slipsSince(grill, 0))[0]).toContain("Mesa 201");
      expect((await slipsSince(grill, 0))[0]).not.toContain("Mesa 201, 202");

      await splitPicked(v, partyId, first, { wholeBillIds: [], loose: [] });

      expect(await noticesOf([tabId])).toEqual([
        { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 202" },
      ]);
      expect(await slipsSince(grill, before)).toEqual([
        movedSlip("Grill", await justOrderLine(tabId), "Mesa 201, 202", "Mesa 202", ["1 x BURG"]),
      ]);
    });

    it("a dish sent before a table joined is told beside a bill leaving whole with the table on its ticket", async () => {
      const { v, grill, first, partyId, tabId } = await oneTable(205);
      await order(v, tabId, "Burger", "Flan");
      const flans = await split(v, partyId, tabId, [2]);
      await join(v, partyId, await v.table("Mesa 206"));
      const before = (await printedBy(grill)).length;
      expect(before).toBeGreaterThan(0);
      const earlier = (await noticesOf([tabId, flans])).length;

      await splitPicked(v, partyId, first, { wholeBillIds: [flans], loose: [] });

      expect((await noticesOf([tabId, flans])).slice(earlier)).toEqual([
        { workingOrderId: flans, kind: "moved", lineName: "FLAN", movedTo: "Mesa 205" },
        { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 206" },
      ]);
      expect(await slipsSince(grill, before)).toEqual([
        movedSlip("Grill", await justOrderLine(flans), "Mesa 205, 206", "Mesa 205", ["1 x FLAN"]),
        movedSlip("Grill", await justOrderLine(tabId), "Mesa 205, 206", "Mesa 206", ["1 x BURG"]),
      ]);
    });

    it("control: a dish sent after the join is not told, the other table being on its ticket", async () => {
      const { v, grill, first, partyId, tabId } = await oneTable(203);
      await join(v, partyId, await v.table("Mesa 204"));
      await orderForParty(v, partyId, ["Burger"], tabId);
      const before = (await printedBy(grill)).length;
      expect((await slipsSince(grill, 0))[0]).toContain("Mesa 203, 204");

      await splitPicked(v, partyId, first, { wholeBillIds: [], loose: [] });

      expect(await noticesOf([tabId])).toEqual([]);
      expect(await slipsSince(grill, before)).toEqual([]);
    });

    it("a table that left in the same millisecond a floor pass wrote its slip is not on that slip's paper", async () => {
      const { v, grill, first, partyId, tabId } = await oneTable(209);
      await orderForParty(v, partyId, ["Burger"], tabId);
      const second = await v.table("Mesa 210");
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const command = await commandFor(v, partyId);
        await inTx(v, (tx) =>
          moveGuests(tx, v.cfg, partyId, second, { ...command, otherPartyId: null }),
        );
      } finally {
        vi.useRealTimers();
      }
      const [slip] = await db
        .select({ at: kitchenNotices.createdAt })
        .from(kitchenNotices)
        .where(eq(kitchenNotices.workingOrderId, tabId));
      const [left] = await db
        .select({ at: partyTables.leftAt })
        .from(partyTables)
        .where(and(eq(partyTables.partyId, partyId), eq(partyTables.tableId, first)));
      expect(left!.at).toBe(slip!.at);
      expect(await slipsSince(grill, 1)).toEqual([
        movedSlip("Grill", await justOrderLine(tabId), "Mesa 209", "Mesa 210", ["1 x BURG"]),
      ]);
      await join(v, partyId, first);
      const before = (await printedBy(grill)).length;

      await splitPicked(v, partyId, second, { wholeBillIds: [], loose: [] });

      expect(await noticesOf([tabId])).toEqual([
        { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 210" },
        { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 209" },
      ]);
      expect(await slipsSince(grill, before)).toEqual([
        movedSlip("Grill", await justOrderLine(tabId), "Mesa 210, 209", "Mesa 209", ["1 x BURG"]),
      ]);
    });

    it("one bill holding a dish from before a join and one from after tells only the first, on one slip", async () => {
      const { v, grill, first, partyId, tabId } = await oneTable(207);
      await orderForParty(v, partyId, ["Burger"], tabId);
      await join(v, partyId, await v.table("Mesa 208"));
      await nextMillisecond();
      await orderForParty(v, partyId, ["Flan"], tabId);
      const before = (await printedBy(grill)).length;
      expect((await slipsSince(grill, 0)).map((slip) => slip.join(" "))).toEqual([
        expect.stringContaining("Mesa 207"),
        expect.stringContaining("Mesa 207, 208"),
      ]);

      await splitPicked(v, partyId, first, { wholeBillIds: [], loose: [] });

      expect(await noticesOf([tabId])).toEqual([
        { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 208" },
      ]);
      expect(await slipsSince(grill, before)).toEqual([
        movedSlip("Grill", await justOrderLine(tabId), "Mesa 207, 208", "Mesa 208", ["1 x BURG"]),
      ]);
    });

    it("that same bill losing the table that joined tells neither dish", async () => {
      const { v, grill, partyId, tabId } = await oneTable(209);
      await orderForParty(v, partyId, ["Burger"], tabId);
      const second = await v.table("Mesa 210");
      await join(v, partyId, second);
      await nextMillisecond();
      await orderForParty(v, partyId, ["Flan"], tabId);
      const before = (await printedBy(grill)).length;
      expect(before).toBeGreaterThan(0);

      await splitPicked(v, partyId, second, { wholeBillIds: [], loose: [] });

      expect(await noticesOf([tabId])).toEqual([]);
      expect(await slipsSince(grill, before)).toEqual([]);
    });

    it("a table that joined in the same millisecond the dish was sent counts as on its ticket", async () => {
      const { v, grill, first, partyId, tabId } = await oneTable(212);
      await order(v, tabId, "Burger");
      const second = await v.table("Mesa 213");
      await join(v, partyId, second);
      const [{ firedAt }] = (await db
        .select({ firedAt: ticketItems.firedAt })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, tabId))) as [{ firedAt: string }];
      await db
        .update(partyTables)
        .set({ joinedAt: firedAt })
        .where(eq(partyTables.tableId, second));
      const before = (await printedBy(grill)).length;
      expect(before).toBeGreaterThan(0);

      await splitPicked(v, partyId, first, { wholeBillIds: [], loose: [] });

      expect(await noticesOf([tabId])).toEqual([]);
      expect(await slipsSince(grill, before)).toEqual([]);
    });

    it("a table that had left before the dish was sent and came back after is not on its ticket", async () => {
      const { v, grill, first, partyId, tabId } = await oneTable(235);
      const second = await v.table("Mesa 236");
      const long = "2026-01-01T12:00:00.000Z";
      await db.insert(partyTables).values({
        partyId,
        tableId: second,
        joinedAt: long,
        leftAt: long,
      });
      await order(v, tabId, "Burger");
      await join(v, partyId, second);
      const before = (await printedBy(grill)).length;
      expect((await slipsSince(grill, 0))[0]).toContain("Mesa 235");

      await splitPicked(v, partyId, first, { wholeBillIds: [], loose: [] });

      expect(await noticesOf([tabId])).toEqual([
        { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 236" },
      ]);
      expect(await slipsSince(grill, before)).toEqual([
        movedSlip("Grill", await justOrderLine(tabId), "Mesa 235, 236", "Mesa 236", ["1 x BURG"]),
      ]);
    });

    describe("a dish told once goes by what the slip said", () => {
      /** Burger sent at Mesa `first`, Mesa `first + 1` joined, Mesa `first` split off and told. */
      async function toldOnce(first: number) {
        const table = await oneTable(first);
        const { v, partyId, tabId } = table;
        await order(v, tabId, "Burger");
        const kept = await v.table(`Mesa ${first + 1}`);
        await join(v, partyId, kept);
        await splitPicked(v, partyId, table.first, { wholeBillIds: [], loose: [] });
        expect(await noticesOf([tabId])).toHaveLength(1);
        const third = await v.table(`Mesa ${first + 2}`);
        await join(v, partyId, third);
        const before = (await printedBy(table.grill)).length;
        return { ...table, kept, third, before };
      }

      it("is not told again when a later table leaves and the slip's table stays", async () => {
        const { v, grill, partyId, tabId, third, before } = await toldOnce(214);

        await splitPicked(v, partyId, third, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([tabId])).toHaveLength(1);
        expect(await slipsSince(grill, before)).toEqual([]);
      });

      it("is told again when the table the slip named leaves", async () => {
        const { v, grill, partyId, tabId, kept, before } = await toldOnce(217);

        await splitPicked(v, partyId, kept, { wholeBillIds: [], loose: [] });

        expect((await noticesOf([tabId])).map((notice) => notice.movedTo)).toEqual([
          "Mesa 218",
          "Mesa 219",
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip("Grill", await justOrderLine(tabId), "Mesa 218, 219", "Mesa 219", ["1 x BURG"]),
        ]);
      });

      it("a slip for one dish says nothing of another dish on the bill", async () => {
        const { v, grill, first, partyId, tabId } = await oneTable(220);
        await order(v, tabId, "Burger", "Flan");
        const flans = await split(v, partyId, tabId, [2]);
        await join(v, partyId, await v.table("Mesa 221"));
        const flan = await lineId(v, flans, "Flan");
        const command = await commandFor(v, partyId);
        await inTx(v, (tx) => moveDishes(tx, v.cfg, flans, tabId, [flan], { ...command, partyId }));
        expect(await noticesOf([tabId])).toEqual([
          { workingOrderId: tabId, kind: "moved", lineName: "FLAN", movedTo: "Mesa 220, 221" },
        ]);
        const before = (await printedBy(grill)).length;

        await splitPicked(v, partyId, first, { wholeBillIds: [], loose: [] });

        expect((await noticesOf([tabId])).slice(1)).toEqual([
          { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 221" },
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip("Grill", await justOrderLine(tabId), "Mesa 220, 221", "Mesa 221", ["1 x BURG"]),
        ]);
      });
    });

    describe("two parties combined, each bill's ticket naming its own party's table", () => {
      /** Burger sent at Mesa `first`, Flan sent at Mesa `first + 1`; the first party joins the second. */
      async function combined(first: number) {
        const {
          v,
          grill,
          first: burgerTable,
          partyId: from,
          tabId: burgers,
        } = await oneTable(first);
        await orderForParty(v, from, ["Burger"], burgers);
        const flanTable = await v.table(`Mesa ${first + 1}`);
        const { partyId: into, tabId: flans } = await seat(v, flanTable);
        await orderForParty(v, into, ["Flan"], flans);
        await nextMillisecond();
        const command = await commandFor(v, from);
        await inTx(v, async (tx) =>
          combineParties(tx, v.cfg, {
            from,
            into,
            tables: "join",
            operatorId: command.operatorId,
          }),
        );
        const before = (await printedBy(grill)).length;
        return { v, grill, burgerTable, flanTable, into, burgers, flans, before };
      }

      it("the table of the party that was combined away leaves: only its dish is told", async () => {
        const { v, grill, burgerTable, into, burgers, flans, flanTable, before } =
          await combined(222);

        await splitPicked(v, into, burgerTable, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([burgers, flans])).toEqual([
          { workingOrderId: burgers, kind: "moved", lineName: "BURG", movedTo: "Mesa 223" },
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip("Grill", await justOrderLine(burgers), "Mesa 223, 222", "Mesa 223", [
            "1 x BURG",
          ]),
        ]);
        expect(await activeTablesOf(v, into)).toEqual([flanTable]);
      });

      it("the table of the party that took the guests leaves: only its dish is told", async () => {
        const { v, grill, burgerTable, flanTable, into, burgers, flans, before } =
          await combined(224);

        await splitPicked(v, into, flanTable, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([burgers, flans])).toEqual([
          { workingOrderId: flans, kind: "moved", lineName: "FLAN", movedTo: "Mesa 224" },
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip("Grill", await justOrderLine(flans), "Mesa 225, 224", "Mesa 224", ["1 x FLAN"]),
        ]);
        expect(await activeTablesOf(v, into)).toEqual([burgerTable]);
      });
    });

    describe("a dish of a party combined into another is told the first time a table on that party's list leaves", () => {
      /** `partyId` takes `tableId` from the party at it, which combines that party into this one. */
      async function joinTaken(v: PartyVenue, partyId: string, tableId: string, holder: string) {
        await nextMillisecond();
        const command = await commandFor(v, partyId);
        const { expectedPartyRevision } = await commandFor(v, holder);
        await inTx(v, (tx) =>
          joinTables(tx, v.cfg, partyId, tableId, {
            ...command,
            otherPartyId: holder,
            expectedOtherPartyRevision: expectedPartyRevision,
          }),
        );
      }

      /** The last ticket printed has a line reading exactly `names`. */
      async function lastTicketReads(grill: string, names: string) {
        expect((await slipsSince(grill, 0)).at(-1)!).toContain(names);
      }

      /** Mesa `first` splits off `partyId` and its new party finishes, leaving the table free. */
      async function letGoAndFree(v: PartyVenue, partyId: string, tableId: string) {
        const { partyId: theirs } = await splitPicked(v, partyId, tableId, {
          wholeBillIds: [],
          loose: [],
        });
        const closing = await commandFor(v, theirs);
        await inTx(v, (tx) => finishTable(tx, { partyId: theirs, ...closing }));
        await nextMillisecond();
      }

      it("the only table on the ticket leaves, and a table that joined after the send stays: told", async () => {
        const { v, grill, first, partyId: from, tabId } = await oneTable(510);
        await orderForParty(v, from, ["Burger"], tabId);
        await lastTicketReads(grill, "Mesa 510");
        await join(v, from, await v.table("Mesa 511"));
        const { partyId: into } = await seat(v, await v.table("Mesa 512"));
        await joinTaken(v, into, first, from);
        const before = (await printedBy(grill)).length;

        await splitPicked(v, into, first, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([tabId])).toEqual([
          { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 512, 511" },
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip("Grill", await justOrderLine(tabId), "Mesa 512, 510, 511", "Mesa 512, 511", [
            "1 x BURG",
          ]),
        ]);
      });

      it("an accepted extra slip: the table that joined after the send leaves, though the ticket's table stays", async () => {
        const { v, grill, first, partyId: from, tabId } = await oneTable(513);
        await orderForParty(v, from, ["Burger"], tabId);
        await lastTicketReads(grill, "Mesa 513");
        const later = await v.table("Mesa 514");
        await join(v, from, later);
        const { partyId: into } = await seat(v, await v.table("Mesa 515"));
        await joinTaken(v, into, first, from);
        const before = (await printedBy(grill)).length;

        await splitPicked(v, into, later, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([tabId])).toEqual([
          { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 515, 513" },
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip("Grill", await justOrderLine(tabId), "Mesa 515, 513, 514", "Mesa 515, 513", [
            "1 x BURG",
          ]),
        ]);
      });

      it("an accepted extra slip: the ticket named both tables and the earlier leaves, though the later stays", async () => {
        const { v, grill, first, partyId: from, tabId } = await oneTable(520);
        await join(v, from, await v.table("Mesa 521"));
        await orderForParty(v, from, ["Burger"], tabId);
        await lastTicketReads(grill, "Mesa 520, 521");
        const { partyId: into } = await seat(v, await v.table("Mesa 522"));
        await joinTaken(v, into, first, from);
        const before = (await printedBy(grill)).length;

        await splitPicked(v, into, first, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([tabId])).toEqual([
          { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 522, 521" },
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip("Grill", await justOrderLine(tabId), "Mesa 522, 520, 521", "Mesa 522, 521", [
            "1 x BURG",
          ]),
        ]);
      });

      it("an accepted extra slip: the ticket named both tables and the later leaves, though the earlier stays", async () => {
        const { v, grill, first, partyId: from, tabId } = await oneTable(523);
        const later = await v.table("Mesa 524");
        await join(v, from, later);
        await orderForParty(v, from, ["Burger"], tabId);
        await lastTicketReads(grill, "Mesa 523, 524");
        const { partyId: into } = await seat(v, await v.table("Mesa 525"));
        await joinTaken(v, into, first, from);
        const before = (await printedBy(grill)).length;

        await splitPicked(v, into, later, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([tabId])).toEqual([
          { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 525, 523" },
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip("Grill", await justOrderLine(tabId), "Mesa 525, 523, 524", "Mesa 525, 523", [
            "1 x BURG",
          ]),
        ]);
      });

      it("a table let go before the send comes back through another party, the ticket's table leaves: told", async () => {
        const { v, grill, first, partyId: from, tabId } = await oneTable(550);
        const letGo = await v.table("Mesa 551");
        await join(v, from, letGo);
        await splitPicked(v, from, letGo, { wholeBillIds: [], loose: [] });
        const [{ partyId: other }] = (await db
          .select({ partyId: partyTables.partyId })
          .from(partyTables)
          .where(and(eq(partyTables.tableId, letGo), isNull(partyTables.leftAt)))) as [
          { partyId: string },
        ];
        await nextMillisecond();
        await orderForParty(v, from, ["Burger"], tabId);
        await lastTicketReads(grill, "Mesa 550");
        const { partyId: into } = await seat(v, await v.table("Mesa 552"));
        await joinTaken(v, into, first, from);
        await joinTaken(v, into, letGo, other);
        const before = (await printedBy(grill)).length;

        await splitPicked(v, into, first, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([tabId])).toEqual([
          { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 552, 551" },
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip("Grill", await justOrderLine(tabId), "Mesa 552, 550, 551", "Mesa 552, 551", [
            "1 x BURG",
          ]),
        ]);
      });

      it("its first table left before the send, the ticket's table leaves: told, not read from the other party's tables", async () => {
        const { v, grill, first, partyId: from, tabId } = await oneTable(560);
        const ticketed = await v.table("Mesa 561");
        await join(v, from, ticketed);
        await splitPicked(v, from, first, { wholeBillIds: [], loose: [] });
        const { partyId: into } = await seat(v, await v.table("Mesa 562"));
        await nextMillisecond();
        await orderForParty(v, from, ["Burger"], tabId);
        await lastTicketReads(grill, "Mesa 561");
        await joinTaken(v, into, ticketed, from);
        const before = (await printedBy(grill)).length;

        await splitPicked(v, into, ticketed, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([tabId])).toEqual([
          { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 562" },
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip("Grill", await justOrderLine(tabId), "Mesa 562, 561", "Mesa 562", ["1 x BURG"]),
        ]);
      });

      it("control: its first table left before the send, the other party's table leaves and the ticket's table stays: not told", async () => {
        const { v, grill, first, partyId: from, tabId } = await oneTable(563);
        const ticketed = await v.table("Mesa 564");
        await join(v, from, ticketed);
        await splitPicked(v, from, first, { wholeBillIds: [], loose: [] });
        const otherTable = await v.table("Mesa 565");
        const { partyId: into } = await seat(v, otherTable);
        await nextMillisecond();
        await orderForParty(v, from, ["Burger"], tabId);
        await joinTaken(v, into, ticketed, from);
        const before = (await printedBy(grill)).length;

        await splitPicked(v, into, otherTable, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([tabId])).toEqual([]);
        expect(await slipsSince(grill, before)).toEqual([]);
      });

      it("its first table left after the send and before the combine, the ticket's other table leaves: told", async () => {
        const { v, grill, first, partyId: from, tabId } = await oneTable(570);
        const ticketed = await v.table("Mesa 571");
        await join(v, from, ticketed);
        const { partyId: into } = await seat(v, await v.table("Mesa 572"));
        await nextMillisecond();
        await orderForParty(v, from, ["Burger"], tabId);
        await lastTicketReads(grill, "Mesa 570, 571");
        await nextMillisecond();
        await splitPicked(v, from, first, { wholeBillIds: [], loose: [] });
        expect(await noticesOf([tabId])).toEqual([]);
        await joinTaken(v, into, ticketed, from);
        const before = (await printedBy(grill)).length;

        await splitPicked(v, into, ticketed, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([tabId])).toEqual([
          { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 572" },
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip("Grill", await justOrderLine(tabId), "Mesa 572, 571", "Mesa 572", ["1 x BURG"]),
        ]);
      });

      it("a slip is the paper and no third party is needed: its table leaves after the party that split off takes it back", async () => {
        const { v, grill, first, partyId: from, tabId } = await oneTable(811);
        await orderForParty(v, from, ["Burger"], tabId);
        const kept = await v.table("Mesa 812");
        await join(v, from, kept);
        const { partyId: theirs } = await splitPicked(v, from, first, {
          wholeBillIds: [],
          loose: [],
        });
        expect((await noticesOf([tabId])).map((notice) => notice.movedTo)).toEqual(["Mesa 812"]);
        await joinTaken(v, theirs, kept, from);
        const before = (await printedBy(grill)).length;

        await splitPicked(v, theirs, kept, { wholeBillIds: [], loose: [] });

        expect((await noticesOf([tabId])).map((notice) => notice.movedTo)).toEqual([
          "Mesa 812",
          "Mesa 811",
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip("Grill", await justOrderLine(tabId), "Mesa 811, 812", "Mesa 811", ["1 x BURG"]),
        ]);
      });

      it("no split before the send: guests moved to the ticket's table, new guests at the old one take it, it leaves", async () => {
        const { v, grill, first, partyId: from, tabId } = await oneTable(851);
        const ticketed = await v.table("Mesa 852");
        const moving = await commandFor(v, from);
        await inTx(v, (tx) =>
          moveGuests(tx, v.cfg, from, ticketed, { ...moving, otherPartyId: null }),
        );
        await nextMillisecond();
        await orderForParty(v, from, ["Burger"], tabId);
        await lastTicketReads(grill, "Mesa 852");
        const { partyId: into } = await seat(v, first);
        await joinTaken(v, into, ticketed, from);
        const before = (await printedBy(grill)).length;

        await splitPicked(v, into, ticketed, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([tabId])).toEqual([
          { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 851" },
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip("Grill", await justOrderLine(tabId), "Mesa 851, 852", "Mesa 851", ["1 x BURG"]),
        ]);
      });

      it("no third party: the party that split off takes the ticket's table back, and it leaves", async () => {
        const { v, grill, first, partyId: from, tabId } = await oneTable(611);
        const ticketed = await v.table("Mesa 610");
        await join(v, from, ticketed);
        const { partyId: theirs } = await splitPicked(v, from, first, {
          wholeBillIds: [],
          loose: [],
        });
        await nextMillisecond();
        await orderForParty(v, from, ["Burger"], tabId);
        await lastTicketReads(grill, "Mesa 610");
        await joinTaken(v, theirs, ticketed, from);
        const before = (await printedBy(grill)).length;

        await splitPicked(v, theirs, ticketed, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([tabId])).toEqual([
          { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 611" },
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip("Grill", await justOrderLine(tabId), "Mesa 611, 610", "Mesa 611", ["1 x BURG"]),
        ]);
      });

      it("a table let go before the send, rejoined by the party's own join, then combined: the ticket's table leaves: told", async () => {
        const { v, grill, first, partyId: from, tabId } = await oneTable(621);
        const ticketed = await v.table("Mesa 620");
        await join(v, from, ticketed);
        await letGoAndFree(v, from, first);
        await orderForParty(v, from, ["Burger"], tabId);
        await lastTicketReads(grill, "Mesa 620");
        await join(v, from, first);
        const { partyId: into } = await seat(v, await v.table("Mesa 622"));
        await joinTaken(v, into, ticketed, from);
        const before = (await printedBy(grill)).length;

        await splitPicked(v, into, ticketed, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([tabId])).toEqual([
          { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 622, 621" },
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip("Grill", await justOrderLine(tabId), "Mesa 622, 620, 621", "Mesa 622, 621", [
            "1 x BURG",
          ]),
        ]);
      });

      it("a table let go before the send, joined back free by the party it was combined into: the ticket's table leaves: told", async () => {
        const { v, grill, first, partyId: from, tabId } = await oneTable(631);
        const ticketed = await v.table("Mesa 630");
        await join(v, from, ticketed);
        await letGoAndFree(v, from, first);
        await orderForParty(v, from, ["Burger"], tabId);
        await lastTicketReads(grill, "Mesa 630");
        const { partyId: into } = await seat(v, await v.table("Mesa 632"));
        await joinTaken(v, into, ticketed, from);
        await join(v, into, first);
        const before = (await printedBy(grill)).length;

        await splitPicked(v, into, ticketed, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([tabId])).toEqual([
          { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 632, 631" },
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip("Grill", await justOrderLine(tabId), "Mesa 632, 630, 631", "Mesa 632, 631", [
            "1 x BURG",
          ]),
        ]);
      });

      it("a table not on the list leaves: not told, whether it is the other party's or joined after the combine", async () => {
        const { v, grill, first, partyId: from, tabId } = await oneTable(535);
        await orderForParty(v, from, ["Burger"], tabId);
        const otherPartys = await v.table("Mesa 536");
        const { partyId: into } = await seat(v, otherPartys);
        await joinTaken(v, into, first, from);
        const joinedAfter = await v.table("Mesa 537");
        await join(v, into, joinedAfter);
        const before = (await printedBy(grill)).length;

        await splitPicked(v, into, joinedAfter, { wholeBillIds: [], loose: [] });
        await splitPicked(v, into, otherPartys, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([tabId])).toEqual([]);
        expect(await slipsSince(grill, before)).toEqual([]);
      });

      it("a listed table leaves and the group it sat in keeps its name: told, its ticket naming the table alone", async () => {
        const { v, grill, first, partyId: from, tabId } = await oneTable(540);
        await orderForParty(v, from, ["Burger"], tabId);
        await lastTicketReads(grill, "Mesa 540");
        const second = await v.table("Mesa 541");
        const { partyId: into } = await seat(v, second);
        const third = await v.table("Mesa 542");
        await join(v, into, third);
        await joinTaken(v, into, first, from);
        await group(v, "Terraza", [first, second, third]);
        const before = (await printedBy(grill)).length;

        await splitPicked(v, into, first, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([tabId])).toEqual([
          {
            workingOrderId: tabId,
            kind: "moved",
            lineName: "BURG",
            movedTo: "Terraza (Mesa 541, 542)",
          },
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip(
            "Grill",
            await justOrderLine(tabId),
            "Terraza (Mesa 541, 542, 540)",
            "Terraza (Mesa 541, 542)",
            ["1 x BURG"],
          ),
        ]);
      });

      it("told once for the same paper: after that a table on the slip goes by the slip, and a table not on it tells nothing", async () => {
        const { v, grill, first, partyId: from, tabId } = await oneTable(530);
        await orderForParty(v, from, ["Burger"], tabId);
        const listed = await v.table("Mesa 531");
        await join(v, from, listed);
        const survivors = await v.table("Mesa 532");
        const { partyId: into } = await seat(v, survivors);
        await joinTaken(v, into, first, from);
        await splitPicked(v, into, listed, { wholeBillIds: [], loose: [] });
        expect((await noticesOf([tabId])).map((notice) => notice.movedTo)).toEqual([
          "Mesa 532, 530",
        ]);
        const notOnSlip = await v.table("Mesa 533");
        await join(v, into, notOnSlip);
        const before = (await printedBy(grill)).length;

        await splitPicked(v, into, notOnSlip, { wholeBillIds: [], loose: [] });
        await splitPicked(v, into, first, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([tabId])).toHaveLength(1);
        expect(await slipsSince(grill, before)).toEqual([]);

        await join(v, into, await v.table("Mesa 534"));

        await splitPicked(v, into, survivors, { wholeBillIds: [], loose: [] });

        expect((await noticesOf([tabId])).map((notice) => notice.movedTo)).toEqual([
          "Mesa 532, 530",
          "Mesa 534",
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip("Grill", await justOrderLine(tabId), "Mesa 532, 534", "Mesa 534", ["1 x BURG"]),
        ]);
      });

      it("told once, the dish goes by the slip and is not told when another table leaves", async () => {
        const { v, grill, first, partyId: from, tabId } = await oneTable(590);
        await orderForParty(v, from, ["Burger"], tabId);
        const later = await v.table("Mesa 591");
        await join(v, from, later);
        const { partyId: into } = await seat(v, await v.table("Mesa 592"));
        await joinTaken(v, into, first, from);
        await splitPicked(v, into, first, { wholeBillIds: [], loose: [] });
        expect(await noticesOf([tabId])).toHaveLength(1);
        const before = (await printedBy(grill)).length;

        await splitPicked(v, into, later, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([tabId])).toHaveLength(1);
        expect(await slipsSince(grill, before)).toEqual([]);
      });
    });

    it("a dish its combined-away party held and fired after the combine goes by the tables at that firing", async () => {
      const { v, grill, first, partyId: from, tabId } = await oneTable(233);
      await burgerAndHeldPaella(v, from, tabId);
      const flanTable = await v.table("Mesa 234");
      const { partyId: into } = await seat(v, flanTable);
      await nextMillisecond();
      const combining = await commandFor(v, from);
      await inTx(v, (tx) =>
        combineParties(tx, v.cfg, {
          from,
          into,
          tables: "join",
          operatorId: combining.operatorId,
        }),
      );
      const [{ groupId }] = (await db
        .select({ groupId: workingOrderLines.groupId })
        .from(workingOrderLines)
        .where(
          and(
            eq(workingOrderLines.workingOrderId, tabId),
            eq(workingOrderLines.productId, v.productId("Paella")),
          ),
        )) as [{ groupId: string }];
      await nextMillisecond();
      const firing = await commandFor(v, into);
      await inTx(v, (tx) =>
        fireGroup(tx, v.cfg, into, groupId, { ...firing, submissionId: randomUUID() }),
      );
      const before = (await printedBy(grill)).length;
      expect((await slipsSince(grill, before - 1))[0]!.join(" ")).toContain("Mesa 234, 233");

      await splitPicked(v, into, first, { wholeBillIds: [], loose: [] });

      expect(await noticesOf([tabId])).toEqual([
        { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 234" },
      ]);
    });

    describe("held work", () => {
      afterEach(() =>
        withTransaction(db, (tx) => setStationPrinting(tx, { printHeldWork: false })),
      );

      /** Burger sent and Paella on HOLD paper at Mesa `first`, then Mesa `first + 1` joined. */
      async function heldThenJoined(first: number) {
        const v = await setupPartyVenue(db);
        const grill = await stationWithPrinter(v, "Grill", dishes);
        await inTx(v, async (tx) =>
          setStationPrinting(tx, { printHeldWork: true }, [await activeStationId(tx, "Grill")]),
        );
        const firstTable = await v.table(`Mesa ${first}`);
        const { partyId, tabId } = await seat(v, firstTable);
        await burgerAndHeldPaella(v, partyId, tabId);
        await join(v, partyId, await v.table(`Mesa ${first + 1}`));
        return { v, grill, firstTable, partyId, tabId };
      }

      it("a dish still on HOLD paper from before a join is told, under HOLD", async () => {
        const { v, grill, firstTable, partyId, tabId } = await heldThenJoined(226);
        const before = (await printedBy(grill)).length;
        expect(before).toBeGreaterThan(0);

        await splitPicked(v, partyId, firstTable, { wholeBillIds: [], loose: [] });

        expect(byDish(await noticesOf([tabId]))).toEqual([
          ["BURG", tabId, "Mesa 227"],
          ["PAELLA", tabId, "Mesa 227"],
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip("Grill", await justOrderLine(tabId), "Mesa 226, 227", "Mesa 227", [
            "1 x BURG",
            kitchenTicketWords("es").hold,
            `${kitchenTicketWords("es").group} 2`,
            "1 x PAELLA",
          ]),
        ]);
      });

      it("a held dish fired after the join is not told, its fire ticket naming the other table", async () => {
        const { v, grill, firstTable, partyId, tabId } = await heldThenJoined(228);
        const [{ groupId }] = (await db
          .select({ groupId: workingOrderLines.groupId })
          .from(workingOrderLines)
          .where(
            and(
              eq(workingOrderLines.workingOrderId, tabId),
              eq(workingOrderLines.productId, v.productId("Paella")),
            ),
          )) as [{ groupId: string }];
        await nextMillisecond();
        const command = await commandFor(v, partyId);
        await inTx(v, (tx) =>
          fireGroup(tx, v.cfg, partyId, groupId, { ...command, submissionId: randomUUID() }),
        );
        const before = (await printedBy(grill)).length;
        expect((await slipsSince(grill, before - 1))[0]!.join(" ")).toContain("Mesa 228, 229");

        await splitPicked(v, partyId, firstTable, { wholeBillIds: [], loose: [] });

        expect(await noticesOf([tabId])).toEqual([
          { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 229" },
        ]);
        expect(await slipsSince(grill, before)).toEqual([
          movedSlip("Grill", await justOrderLine(tabId), "Mesa 228, 229", "Mesa 229", ["1 x BURG"]),
        ]);
      });
    });

    it("a dish whose ticket printed a joined table's own group name goes by that name", async () => {
      const { v, grill, first, partyId, tabId } = await oneTable(230);
      const second = await v.table("Mesa 231");
      const third = await v.table("Mesa 232");
      await group(v, "Terraza", [first, second]);
      await order(v, tabId, "Burger");
      expect((await slipsSince(grill, 0))[0]).toContain("Terraza");
      await join(v, partyId, second);
      await join(v, partyId, third);
      const before = (await printedBy(grill)).length;

      await splitPicked(v, partyId, third, { wholeBillIds: [], loose: [] });

      expect(await noticesOf([tabId])).toEqual([]);
      expect(await slipsSince(grill, before)).toEqual([]);
    });
  });

  describe("every sent dish picked off a bill whose name stays", () => {
    /** Mesa 51 + 52 with Burger and Flan sent on one bill. */
    async function bothSent() {
      const table = await twoTables(51, 52);
      await order(table.v, table.tabId, "Burger", "Flan");
      const picked = loose(
        table.tabId,
        await lineId(table.v, table.tabId, "Burger"),
        await lineId(table.v, table.tabId, "Flan"),
      );
      const printedBefore = (await printedBy(table.grill)).length;
      expect(printedBefore).toBeGreaterThan(0);
      return { ...table, picked, printedBefore };
    }

    /** What both tables and the kitchen hold after the split: the bill stays, the dishes left. */
    async function expectOnlyTheDishesLeft(
      table: Awaited<ReturnType<typeof bothSent>>,
      moved: { partyId: string; billId: string },
    ) {
      const { v, grill, stay, leave, partyId, tabId, printedBefore } = table;
      expect(await billRow(v, tabId)).toMatchObject({ partyId, status: "open" });
      expect(await linesOf(tabId)).toEqual([]);
      expect(
        await db
          .select({
            ...getTableColumns(ticketItems),
            workingOrderId: workingOrderLines.workingOrderId,
          })
          .from(ticketItems)
          .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
          .where(eq(workingOrderLines.workingOrderId, tabId)),
      ).toEqual([]);
      expect(decimalToCents(await inTx(v, (tx) => storedOrderTotal(tx, tabId)))).toBe(0);
      expect(await paymentsOf(v, tabId)).toEqual([]);
      expect(await activeTablesOf(v, partyId)).toEqual([stay]);
      expect(await billNumbersOf(v, partyId)).toEqual([[tabId, 1, null]]);

      expect((await linesOf(moved.billId)).map((line) => line.productId)).toEqual([
        v.productId("Burger"),
        v.productId("Flan"),
      ]);
      expect(await billRow(v, moved.billId)).toMatchObject({
        partyId: moved.partyId,
        status: "open",
      });
      expect(await activeTablesOf(v, moved.partyId)).toEqual([leave]);
      expect(await billNumbersOf(v, moved.partyId)).toEqual([[moved.billId, 1, null]]);

      expect(await noticesOf([tabId, moved.billId])).toEqual([
        { workingOrderId: moved.billId, kind: "moved", lineName: "BURG", movedTo: "Mesa 52" },
        { workingOrderId: moved.billId, kind: "moved", lineName: "FLAN", movedTo: "Mesa 52" },
      ]);
      expect(await slipsSince(grill, printedBefore)).toEqual([
        movedSlip("Grill", await orderLine(tabId, moved.billId), "Mesa 51, 52", "Mesa 52", [
          "1 x BURG",
          "1 x FLAN",
        ]),
      ]);
    }

    it("with the person's own unsent dish left there, the unsent dish stays and Finish table refuses until it is dealt with", async () => {
      const table = await bothSent();
      const { v, partyId, tabId, leave, picked } = table;
      const draft = await inTx(v, (tx) =>
        saveDraft(tx, v.cfg, partyId, OPERATOR, {
          billId: tabId,
          draftId: null,
          revision: 0,
          lines: [{ menuItemId: v.item("Paella"), quantity: "1" }],
        }),
      );

      const moved = await splitPicked(v, partyId, leave, { wholeBillIds: [], loose: [picked] });

      await expectOnlyTheDishesLeft(table, moved);
      const drafts = await inTx(v, (tx) => readDrafts(tx, v.cfg, partyId));
      expect(
        drafts.map((row) => [row.id, row.billId, row.lines.map((line) => line.menuItemId)]),
      ).toEqual([[draft.id, tabId, [v.item("Paella")]]]);

      const finishing = await commandFor(v, partyId);
      const refused = await captureError(() =>
        inTx(v, (tx) => finishTable(tx, { partyId, ...finishing })),
      );
      expect(refused).toMatchObject({ code: "bill.unsent_dishes", params: { billId: tabId } });
      expect((await partyRow(v, partyId)).state).toBe("open");

      const [current] = await inTx(v, (tx) => readDrafts(tx, v.cfg, partyId));
      const discarding = {
        admission: testTradingAdmission(),
        submissionId: randomUUID(),
        revision: current!.revision,
        expectedRevision: (await billRow(v, tabId)).revision,
        expectedEdit: await inTx(v, (tx) => readBillEditState(tx, tabId)),
        note: null,
      };
      await inTx(v, (tx) => discardDraft(tx, v.cfg, partyId, draft.id, OPERATOR, discarding));
      const closing = await commandFor(v, partyId);
      await inTx(v, (tx) => finishTable(tx, { partyId, ...closing }));

      expect((await partyRow(v, partyId)).state).toBe("closed");
      expect((await billRow(v, tabId)).status).toBe("abandoned");
      expect((await partyRow(v, moved.partyId)).state).toBe("open");
      expect((await billRow(v, moved.billId)).status).toBe("open");
    });

    it("with nothing left there, the bill takes a new order, and Finish table waits for it to be paid", async () => {
      const table = await bothSent();
      const { v, partyId, tabId, leave, picked } = table;

      const moved = await splitPicked(v, partyId, leave, { wholeBillIds: [], loose: [picked] });

      await expectOnlyTheDishesLeft(table, moved);

      await order(v, tabId, "Water");
      const finishing = await commandFor(v, partyId);
      const refused = await captureError(() =>
        inTx(v, (tx) => finishTable(tx, { partyId, ...finishing })),
      );
      expect(refused).toMatchObject({ code: "party.bill_outstanding", params: { partyId } });

      await pay(v, tabId, "2.00");
      const closing = await commandFor(v, partyId);
      await inTx(v, (tx) => finishTable(tx, { partyId, ...closing }));

      expect((await partyRow(v, partyId)).state).toBe("closed");
      expect((await billRow(v, tabId)).status).toBe("settled");
    });
  });
});

describe("held dishes the kitchen has on a HOLD ticket are on the MOVED slip (ruling 5)", () => {
  const printHeldWork = (v: PartyVenue, on: boolean) =>
    inTx(v, (tx) => setStationPrinting(tx, { printHeldWork: on }));
  afterEach(() => withTransaction(db, (tx) => setStationPrinting(tx, { printHeldWork: false })));

  it("a party with a fired Burger and a held group 2 Paella on a HOLD ticket moving Mesa 111 to 112 prints one Grill slip listing both, the Paella under HOLD and GROUP 2", async () => {
    const v = await setupPartyVenue(db);
    await printHeldWork(v, true);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    await inTx(v, async (tx) =>
      setStationPrinting(tx, { printHeldWork: true }, [await activeStationId(tx, "Grill")]),
    );
    const table112 = await v.table("Mesa 112");
    const { partyId, tabId } = await seat(v, await v.table("Mesa 111"));
    await burgerAndHeldPaella(v, partyId, tabId);
    const numbers = await numbersOf([tabId]);
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, table112, { ...command, otherPartyId: null }),
    );

    expect(await slipsSince(grill, before)).toEqual([
      movedSlip("Grill", `Pedido ${numbers.get(tabId)}`, "Mesa 111", "Mesa 112", [
        "1 x BURG",
        kitchenTicketWords("es").hold,
        `${kitchenTicketWords("es").group} 2`,
        "1 x PAELLA",
      ]),
    ]);
    expect(byDish(await noticesOf([tabId]))).toEqual([
      ["BURG", tabId, "Mesa 112"],
      ["PAELLA", tabId, "Mesa 112"],
    ]);
  });

  it("a MOVED slip lists under HOLD only the held dishes of a station recorded for the group", async () => {
    const v = await setupPartyVenue(db);
    const kitchen = await stationWithPrinter(v, "Kitchen", ["Burger"]);
    const bar = await stationWithPrinter(v, "Bar", ["Paella"]);
    const screenId = await inTx(v, async (tx) => {
      const station = await createStation(tx, { name: "Screen" });
      await setRoutingCell(
        tx,
        { row: { kind: "product", productId: v.productId("Flan") }, zoneId: null },
        { kind: "station", stationId: station.id },
      );
      await setStationPrinting(tx, { printHeldWork: true }, [await activeStationId(tx, "Kitchen")]);
      return station.id;
    });
    const table122 = await v.table("Mesa 122");
    const { partyId, tabId } = await seat(v, await v.table("Mesa 121"));
    const line = (name: string) => ({ menuItemId: v.item(name), quantity: "1" });
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, partyId, {
        groups: [{ lines: [line("Burger"), line("Paella"), line("Flan")], release: "hold" }],
        operatorId: OPERATOR,
        billId: tabId,
      }),
    );
    const numbers = await numbersOf([tabId]);
    const before = {
      kitchen: (await printedBy(kitchen)).length,
      bar: (await printedBy(bar)).length,
    };
    expect(before).toEqual({ kitchen: 1, bar: 0 });
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, table122, { ...command, otherPartyId: null }),
    );

    expect(await slipsSince(kitchen, before.kitchen)).toEqual([
      movedSlip("Kitchen", `Pedido ${numbers.get(tabId)}`, "Mesa 121", "Mesa 122", [
        kitchenTicketWords("es").hold,
        `${kitchenTicketWords("es").group} 1`,
        "1 x BURG",
      ]),
    ]);
    expect(await slipsSince(bar, before.bar)).toEqual([]);
    expect(byDish(await noticesOf([tabId]))).toEqual([
      ["BURG", tabId, "Mesa 122"],
      ["FLAN", tabId, "Mesa 122"],
      ["PAELLA", tabId, "Mesa 122"],
    ]);
    expect(
      await db
        .select({ kind: kitchenNotices.kind, lineName: kitchenNotices.lineName })
        .from(kitchenNotices)
        .where(eq(kitchenNotices.stationId, screenId)),
    ).toEqual([{ kind: "moved", lineName: "FLAN" }]);
  });

  it("lists each held group on a HOLD ticket under its own GROUP line, its dishes in line order", async () => {
    const v = await setupPartyVenue(db);
    await printHeldWork(v, true);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    await inTx(v, async (tx) =>
      setStationPrinting(tx, { printHeldWork: true }, [await activeStationId(tx, "Grill")]),
    );
    const table119 = await v.table("Mesa 119");
    const { partyId, tabId } = await seat(v, await v.table("Mesa 118"));
    const line = (name: string) => ({ menuItemId: v.item(name), quantity: "1" });
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, partyId, {
        groups: [
          { lines: [line("Paella"), line("Burger")], release: "hold" },
          { lines: [line("Paella")], release: "hold" },
        ],
        operatorId: OPERATOR,
        billId: tabId,
      }),
    );
    const numbers = await numbersOf([tabId]);
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, table119, { ...command, otherPartyId: null }),
    );

    expect(await slipsSince(grill, before)).toEqual([
      movedSlip("Grill", `Pedido ${numbers.get(tabId)}`, "Mesa 118", "Mesa 119", [
        kitchenTicketWords("es").hold,
        `${kitchenTicketWords("es").group} 1`,
        "1 x PAELLA",
        "1 x BURG",
        `${kitchenTicketWords("es").group} 2`,
        "1 x PAELLA",
      ]),
    ]);
  });

  it("a held group never printed adds nothing to the slip and records no notice", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    const table114 = await v.table("Mesa 114");
    const { partyId, tabId } = await seat(v, await v.table("Mesa 113"));
    await burgerAndHeldPaella(v, partyId, tabId);
    const numbers = await numbersOf([tabId]);
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, table114, { ...command, otherPartyId: null }),
    );

    expect(await slipsSince(grill, before)).toEqual([
      movedSlip("Grill", `Pedido ${numbers.get(tabId)}`, "Mesa 113", "Mesa 114", ["1 x BURG"]),
    ]);
    expect(byDish(await noticesOf([tabId]))).toEqual([["BURG", tabId, "Mesa 114"]]);
  });

  it("Split the bill of a held dish on a HOLD ticket prints a slip that starts with HOLD, onto the new order", async () => {
    const v = await setupPartyVenue(db);
    await printHeldWork(v, true);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    await inTx(v, async (tx) =>
      setStationPrinting(tx, { printHeldWork: true }, [await activeStationId(tx, "Grill")]),
    );
    const { partyId, tabId } = await seat(v, await v.table("Mesa 115"));
    await burgerAndHeldPaella(v, partyId, tabId);
    const before = (await printedBy(grill)).length;

    const second = await split(v, partyId, tabId, [2]);

    const numbers = await numbersOf([tabId, second]);
    expect(await slipsSince(grill, before)).toEqual([
      movedSlip(
        "Grill",
        `Pedido ${numbers.get(tabId)} -> ${numbers.get(second)}`,
        "Mesa 115",
        "Mesa 115",
        [kitchenTicketWords("es").hold, `${kitchenTicketWords("es").group} 2`, "1 x PAELLA"],
      ),
    ]);
    expect(byDish(await noticesOf([second]))).toEqual([["PAELLA", second, "Mesa 115"]]);
  });

  it("Split the bill of a held dish whose group was never printed prints nothing and records no notice", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    const { partyId, tabId } = await seat(v, await v.table("Mesa 116"));
    await burgerAndHeldPaella(v, partyId, tabId);
    const before = (await printedBy(grill)).length;

    const second = await split(v, partyId, tabId, [2]);

    expect(await slipsSince(grill, before)).toEqual([]);
    expect(await noticesOf([tabId, second])).toEqual([]);
  });

  it("Transfer items of a held dish on a HOLD ticket prints it under HOLD and GROUP 2, onto the other order", async () => {
    const v = await setupPartyVenue(db);
    await printHeldWork(v, true);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    await inTx(v, async (tx) =>
      setStationPrinting(tx, { printHeldWork: true }, [await activeStationId(tx, "Grill")]),
    );
    const { partyId, tabId } = await seat(v, await v.table("Mesa 117"));
    await burgerAndHeldPaella(v, partyId, tabId);
    const second = await split(v, partyId, tabId, [1]);
    const numbers = await numbersOf([tabId, second]);
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) => transferItems(tx, v.cfg, tabId, second, [{ lineNo: 2 }], command));

    expect(await slipsSince(grill, before)).toEqual([
      movedSlip(
        "Grill",
        `Pedido ${numbers.get(tabId)} -> ${numbers.get(second)}`,
        "Mesa 117",
        "Mesa 117",
        [kitchenTicketWords("es").hold, `${kitchenTicketWords("es").group} 2`, "1 x PAELLA"],
      ),
    ]);
    expect(byDish(await noticesOf([second]))).toEqual([
      ["BURG", second, "Mesa 117"],
      ["PAELLA", second, "Mesa 117"],
    ]);
  });
});

describe("A1378 MOVED follows station grouping and preserves portion boundaries", () => {
  it("F2 combines whole portions with different recorded late marks on change paper", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    const p = await seat(v, await v.table("Late source"));
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, p.partyId, {
        operatorId: OPERATOR,
        billId: p.tabId,
        groups: [{ release: "fire", lines: [{ menuItemId: v.item("Burger"), quantity: "2" }] }],
      }),
    );
    const lines = await v.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.tabId));
    await inTx(v, async (tx) => {
      await tx
        .delete(workingLineContexts)
        .where(eq(workingLineContexts.workingOrderLineId, lines[1]!.id));
      await recordWorkingLineContexts(
        tx,
        p.tabId,
        [
          {
            workingOrderLineId: lines[1]!.id,
            menuItemId: v.item("Burger"),
            late: { periodName: "Lunch", confirmedBy: OPERATOR },
          },
        ],
        await listZoneOffers(tx, v.tables.zoneId),
      );
    });
    const contexts = await v.db
      .select()
      .from(workingLineContexts)
      .where(
        inArray(
          workingLineContexts.workingOrderLineId,
          lines.map((line) => line.id),
        ),
      );
    expect(contexts.map((context) => context.latePeriodName).sort()).toEqual(
      ["Lunch", null].sort(),
    );
    const beforeReprint = (await printedBy(grill)).length;
    await inTx(v, (tx) => reprintOrderTickets(tx, v.cfg, p.tabId));
    const reprinted = await slipsSince(grill, beforeReprint);
    expect(reprinted.map((paper) => paper.filter((line) => / x BURG$/.test(line)))).toEqual([
      ["1 x BURG", "1 x BURG"],
    ]);
    expect(reprinted[0]!.some((line) => line.includes("LUNCH"))).toBe(true);
    let before = (await printedBy(grill)).length;
    await inTx(v, (tx) =>
      enqueueOrderKitchenNoteChange(tx, v.cfg, [p.tabId], { before: null, after: "Together" }),
    );
    expect(
      (await slipsSince(grill, before)).map((paper) =>
        paper.filter((line) => / x BURG$/.test(line)),
      ),
    ).toEqual([["2 x BURG"]]);
    before = (await printedBy(grill)).length;
    const destination = await v.table("Late destination");
    const command = await commandFor(v, p.partyId);
    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, p.partyId, destination, { ...command, otherPartyId: null }),
    );
    expect(
      (await slipsSince(grill, before)).map((paper) =>
        paper.filter((line) => / x BURG$/.test(line)),
      ),
    ).toEqual([["2 x BURG"]]);
    before = (await printedBy(grill)).length;
    const items = await v.db
      .select({ ...getTableColumns(ticketItems), workingOrderId: workingOrderLines.workingOrderId })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(eq(workingOrderLines.workingOrderId, p.tabId));
    expect(items.map((item) => item.quantity)).toEqual([1000, 1000]);
    await inTx(v, (tx) =>
      enqueueCorrectionSlips(
        tx,
        v.cfg,
        p.tabId,
        items.map((item) => ({
          workingOrderLineId: item.workingOrderLineId,
          stationId: item.stationId,
          quantity: 1000,
          wasStarted: false,
        })),
        "VOID",
      ),
    );
    expect(
      await inTx(v, (tx) =>
        readWholePortionLines(
          tx,
          lines.map((line) => line.id),
        ),
      ),
    ).toEqual(new Set(lines.map((line) => line.id)));
    expect(
      (await slipsSince(grill, before)).map((paper) =>
        paper.filter((line) => / x BURG$/.test(line)),
      ),
    ).toEqual([["2 x BURG"]]);
    const cancelled = (
      await v.db.select().from(kitchenNotices).where(eq(kitchenNotices.workingOrderId, p.tabId))
    ).filter((notice) => notice.kind === "void");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]!.quantity).toBe(2000);
  });

  it("F6 combines identical held portions within the same MOVED group", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    await inTx(v, async (tx) =>
      setStationPrinting(tx, { ticketGrouping: "combined", printHeldWork: true }, [
        await activeStationId(tx, "Grill"),
      ]),
    );
    const p = await seat(v, await v.table("Held source"));
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, p.partyId, {
        operatorId: OPERATOR,
        billId: p.tabId,
        groups: [{ release: "hold", lines: [{ menuItemId: v.item("Burger"), quantity: "2" }] }],
      }),
    );
    const before = (await printedBy(grill)).length;
    const destination = await v.table("Held destination");
    const command = await commandFor(v, p.partyId);
    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, p.partyId, destination, { ...command, otherPartyId: null }),
    );
    const papers = await slipsSince(grill, before);
    expect(papers).toHaveLength(1);
    expect(papers[0]).toContain(kitchenTicketWords("es").hold);
    expect(papers[0]!.filter((line) => / x BURG$/.test(line))).toEqual(["2 x BURG"]);
  });

  it("keeps two whole measured portions separate under combined", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    await inTx(v, async (tx) => {
      const [gram] = await tx.select({ id: units.id }).from(units).where(eq(units.seedKey, "g"));
      await assignProductUnit(tx, v.productId("Burger"), gram!.id);
      await publishWorkingMenu(tx, v.tables.menuId);
    });
    const p = await seat(v, await v.table("Measured source"));
    await order(v, p.tabId, "Burger", "Burger");
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, p.partyId);
    const destination = await v.table("Measured destination");
    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, p.partyId, destination, { ...command, otherPartyId: null }),
    );
    const papers = await slipsSince(grill, before);
    expect(papers).toHaveLength(1);
    expect(papers[0]!.filter((line) => line.endsWith("g x BURG"))).toEqual([
      "1 g x BURG",
      "1 g x BURG",
    ]);
  });

  it("keeps identical portions from distinct groups separate under combined", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    const p = await seat(v, await v.table("Group source"));
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, p.partyId, {
        groups: [
          { release: "fire", lines: [{ menuItemId: v.item("Burger"), quantity: "1" }] },
          { release: "fire", lines: [{ menuItemId: v.item("Burger"), quantity: "1" }] },
        ],
        billId: p.tabId,
        operatorId: OPERATOR,
      }),
    );
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, p.partyId);
    const destination = await v.table("Group destination");
    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, p.partyId, destination, { ...command, otherPartyId: null }),
    );
    const papers = await slipsSince(grill, before);
    expect(papers).toHaveLength(1);
    expect(papers[0]!.slice(-5)).toEqual(["GRUPO 1", "1 x BURG", "GRUPO 2", "1 x BURG", ""]);
  });
  afterEach(() =>
    withTransaction(db, async (tx) => {
      await setStationPrinting(tx, { ticketGrouping: "combined", printHeldWork: false });
    }),
  );
  const dishLines = (lines: readonly string[]) => lines.filter((text) => / x [A-Z]+$/.test(text));

  it("with separate quantities, a fired 3 Burger and a held 2 Paella print one entry of 1 each, as their tickets did", async () => {
    const v = await setupPartyVenue(db);
    await inTx(v, (tx) =>
      setStationPrinting(tx, { ticketGrouping: "separate", printHeldWork: true }),
    );
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    await inTx(v, async (tx) =>
      setStationPrinting(tx, { ticketGrouping: "separate", printHeldWork: true }, [
        await activeStationId(tx, "Grill"),
      ]),
    );
    const table122 = await v.table("Mesa 122");
    const { partyId, tabId } = await seat(v, await v.table("Mesa 121"));
    const tickets = (await printedBy(grill)).length;
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, partyId, {
        groups: [
          { lines: [{ menuItemId: v.item("Burger"), quantity: "3" }], release: "fire" },
          { lines: [{ menuItemId: v.item("Paella"), quantity: "2" }], release: "hold" },
        ],
        operatorId: OPERATOR,
        billId: tabId,
      }),
    );
    expect((await slipsSince(grill, tickets)).map(dishLines)).toEqual(
      expect.arrayContaining([
        ["1 x BURG", "1 x BURG", "1 x BURG"],
        ["1 x PAELLA", "1 x PAELLA"],
      ]),
    );
    const numbers = await numbersOf([tabId]);
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, table122, { ...command, otherPartyId: null }),
    );

    expect(await slipsSince(grill, before)).toEqual([
      movedSlip("Grill", `Pedido ${numbers.get(tabId)}`, "Mesa 121", "Mesa 122", [
        "1 x BURG",
        "1 x BURG",
        "1 x BURG",
        kitchenTicketWords("es").hold,
        `${kitchenTicketWords("es").group} 2`,
        "1 x PAELLA",
        "1 x PAELLA",
      ]),
    ]);
  });

  it("with combined quantities, two lines of one Burger on one ticket print as one entry of 2", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    const table124 = await v.table("Mesa 124");
    const { partyId, tabId } = await seat(v, await v.table("Mesa 123"));
    const tickets = (await printedBy(grill)).length;
    await order(v, tabId, "Burger", "Burger");
    expect((await slipsSince(grill, tickets)).map(dishLines)).toEqual([["2 x BURG"]]);
    const numbers = await numbersOf([tabId]);
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, table124, { ...command, otherPartyId: null }),
    );

    expect(await slipsSince(grill, before)).toEqual([
      movedSlip("Grill", `Pedido ${numbers.get(tabId)}`, "Mesa 123", "Mesa 124", ["2 x BURG"]),
    ]);
  });

  it("with combined quantities, one Burger sent on each of two tickets prints as one entry of 2", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    const table126 = await v.table("Mesa 126");
    const { partyId, tabId } = await seat(v, await v.table("Mesa 125"));
    const tickets = (await printedBy(grill)).length;
    await order(v, tabId, "Burger");
    await order(v, tabId, "Burger");
    expect((await slipsSince(grill, tickets)).map(dishLines)).toEqual([["1 x BURG"], ["1 x BURG"]]);
    const numbers = await numbersOf([tabId]);
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, table126, { ...command, otherPartyId: null }),
    );

    expect(await slipsSince(grill, before)).toEqual([
      movedSlip("Grill", `Pedido ${numbers.get(tabId)}`, "Mesa 125", "Mesa 126", ["2 x BURG"]),
    ]);
  });

  it("with combined quantities, two tickets of one Burger reprinted as one entry of 2 still print as one entry of 2", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    const table128 = await v.table("Mesa 128");
    const { partyId, tabId } = await seat(v, await v.table("Mesa 127"));
    await order(v, tabId, "Burger");
    await order(v, tabId, "Burger");
    const reprinted = (await printedBy(grill)).length;
    await inTx(v, (tx) => reprintOrderTickets(tx, v.cfg, tabId));
    expect((await slipsSince(grill, reprinted)).map(dishLines)).toEqual([["2 x BURG"]]);
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, table128, { ...command, otherPartyId: null }),
    );

    expect((await slipsSince(grill, before)).map(dishLines)).toEqual([["2 x BURG"]]);
  });

  it("with combined quantities, two tickets of one Burger reprinted as one entry of 2, its reprint unprinted, still print as one entry of 2 after Transfer items moves both", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    const { partyId, tabId } = await seat(v, await v.table("Mesa 131"));
    await order(v, tabId, "Paella");
    const second = await split(v, partyId, tabId, [1]);
    await order(v, tabId, "Burger");
    await order(v, tabId, "Burger");
    await inTx(v, (tx) => reprintOrderTickets(tx, v.cfg, tabId));
    const lineNos = (
      await db
        .select({ lineNo: workingOrderLines.lineNo })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
    ).map(({ lineNo }) => ({ lineNo }));
    expect(lineNos).toHaveLength(2);
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) => transferItems(tx, v.cfg, tabId, second, lineNos, command));

    expect((await slipsSince(grill, before)).map(dishLines)).toEqual([["2 x BURG"]]);
  });

  it("with combined quantities, two tickets of one Burger reprinted as one entry of 2, its reprint unprinted, still print as one entry of 2 after Merge bills", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    const { partyId, tabId } = await seat(v, await v.table("Mesa 132"));
    await order(v, tabId, "Paella");
    const second = await split(v, partyId, tabId, [1]);
    await order(v, tabId, "Burger");
    await order(v, tabId, "Burger");
    await inTx(v, (tx) => reprintOrderTickets(tx, v.cfg, tabId));
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) => mergeBills(tx, v.cfg, second, tabId, command));

    expect((await slipsSince(grill, before)).map(dishLines)).toEqual([["2 x BURG"]]);
  });

  it("with combined quantities, one Burger sent twice while the station had no printer prints as one entry of 2", async () => {
    const v = await setupPartyVenue(db);
    const table130 = await v.table("Mesa 130");
    const { partyId, tabId } = await seat(v, await v.table("Mesa 129"));
    await order(v, tabId, "Burger");
    await order(v, tabId, "Burger");
    const kitchenPrinterId = await kitchenPrinter(v);
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, table130, { ...command, otherPartyId: null }),
    );

    expect((await slipsSince(kitchenPrinterId, 0)).map(dishLines)).toEqual([["2 x BURG"]]);
  });
});

describe("a station's print-MOVED-slips choice", () => {
  /**
   * A party at Mesa 21 with a fired Burger at the Grill; Move guests takes it to Mesa 22. `null`
   * leaves the Grill's choice never set.
   */
  async function moveGuestsWithBurger(on: boolean | null) {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    await inTx(v, async (tx) => {
      const id = await activeStationId(tx, "Grill");
      if (on === null)
        await tx
          .update(kitchenStations)
          .set({ printMovedSlips: null })
          .where(eq(kitchenStations.id, id));
      else await setStationPrinting(tx, { printMovedSlips: on }, [id]);
    });
    const table21 = await v.table("Mesa 21");
    const table22 = await v.table("Mesa 22");
    const { partyId, tabId } = await seat(v, table21);
    await orderForParty(v, partyId, ["Burger"], tabId);
    const printed = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, table22, { ...command, otherPartyId: null }),
    );

    return { v, grill, tabId, slips: (await printedBy(grill)).slice(printed) };
  }

  it("off, Move guests prints no MOVED slip and still records the moved notice", async () => {
    const { tabId, slips } = await moveGuestsWithBurger(false);

    expect(slips).toEqual([]);
    expect(await noticesOf([tabId])).toEqual([
      { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 22" },
    ]);
  });

  it("on, Move guests prints the MOVED slip", async () => {
    const { tabId, slips } = await moveGuestsWithBurger(true);

    expect(slips).toHaveLength(1);
    expect(slips[0]).toContain("*** MOVIDO ***");
    expect(slips[0]).toContain("De: Mesa 21\nA:  Mesa 22\n");
    expect(await noticesOf([tabId])).toEqual([
      { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 22" },
    ]);
  });

  it("a station whose MOVED slips choice was never set prints MOVED slips", async () => {
    const { slips } = await moveGuestsWithBurger(null);

    expect(slips).toHaveLength(1);
    expect(slips[0]).toContain("*** MOVIDO ***");
    expect(slips[0]).toContain("De: Mesa 21\nA:  Mesa 22\n");
  });

  it("off, a VOID still prints its correction slip", async () => {
    const { v, grill, tabId } = await moveGuestsWithBurger(false);
    const printed = (await printedBy(grill)).length;

    await inTx(v, async (tx) => {
      const fired = await tx
        .select({
          workingOrderLineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
        })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, tabId));
      await enqueueCorrectionSlips(
        tx,
        v.cfg,
        tabId,
        fired.map((item) => ({ ...item, quantity: 1000, wasStarted: false })),
        "VOID",
      );
    });

    const slips = (await printedBy(grill)).slice(printed);
    expect(slips).toHaveLength(1);
    expect(slips[0]).not.toContain("*** MOVIDO ***");
    expect(slips[0]).toContain("BURG");
  });
});

describe("a prep station's own print-MOVED-slips choice", () => {
  async function stationIdOf(name: string): Promise<string> {
    const [station] = await db
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(and(eq(kitchenStations.name, name)));
    return station!.id;
  }

  async function stationPrints(v: PartyVenue, name: string, printMovedSlips: boolean) {
    const id = await stationIdOf(name);
    await inTx(v, (tx) => updateStation(tx, id, { printMovedSlips }));
  }

  /**
   * Burger at the Grill and Flan at Postres, both fired at Mesa 31; Move guests takes them to Mesa
   * 32. A `null` for Postres leaves its choice never set.
   */
  async function moveGuestsWithBurgerAndFlan(grill: boolean, desserts: boolean | null) {
    const v = await setupPartyVenue(db);
    const grillPrinter = await stationWithPrinter(v, "Grill", ["Burger"]);
    const dessertsPrinter = await stationWithPrinter(v, "Postres", ["Flan"]);
    await stationPrints(v, "Grill", grill);
    if (desserts === null) {
      const id = await stationIdOf("Postres");
      await inTx(v, (tx) =>
        tx.update(kitchenStations).set({ printMovedSlips: null }).where(eq(kitchenStations.id, id)),
      );
    } else await stationPrints(v, "Postres", desserts);
    const { partyId, tabId } = await seat(v, await v.table("Mesa 31"));
    await orderForParty(v, partyId, ["Burger", "Flan"], tabId);
    const printed = {
      grill: (await printedBy(grillPrinter)).length,
      desserts: (await printedBy(dessertsPrinter)).length,
    };
    const table32 = await v.table("Mesa 32");
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, table32, { ...command, otherPartyId: null }),
    );

    return {
      tabId,
      grill: (await printedBy(grillPrinter)).slice(printed.grill),
      desserts: (await printedBy(dessertsPrinter)).slice(printed.desserts),
    };
  }

  it("Grill off and Postres never chosen: Move guests prints at Postres only and records notices at both", async () => {
    const { tabId, grill, desserts } = await moveGuestsWithBurgerAndFlan(false, null);

    expect(grill).toEqual([]);
    expect(desserts).toHaveLength(1);
    expect(desserts[0]).toContain("*** MOVIDO ***");
    expect(desserts[0]).toContain("FLAN");
    expect(byDish(await noticesOf([tabId]))).toEqual([
      ["BURG", tabId, "Mesa 32"],
      ["FLAN", tabId, "Mesa 32"],
    ]);
  });

  it("Grill on and Postres off: Move guests prints at the Grill only", async () => {
    const { grill, desserts } = await moveGuestsWithBurgerAndFlan(true, false);

    expect(grill).toHaveLength(1);
    expect(grill[0]).toContain("*** MOVIDO ***");
    expect(grill[0]).toContain("BURG");
    expect(desserts).toEqual([]);
  });

  it("after Merge bills with every station off, no slip prints and the station queue still shows the merged bill's number", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    await stationPrints(v, "Grill", false);
    const { partyId, tabId } = await seat(v, await v.table("Mesa 33"));
    await updateHeldOrder({ admission: testTradingAdmission(), db: v.db }, v.cfg, tabId, {
      revision: (await billRow(v, tabId)).revision,
      lines: [{ menuItemId: v.item("Water"), quantity: "1" }],
      operatorId: OPERATOR,
    });
    const second = await split(v, partyId, tabId, [1]);
    await order(v, tabId, "Paella");
    await order(v, second, "Burger");
    const n28 = (await numbersOf([second])).get(second);
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) => mergeBills(tx, v.cfg, tabId, second, command));

    expect(await slipsSince(grill, before)).toEqual([]);
    const grillId = await stationIdOf("Grill");
    const queues = await inTx(v, (tx) => listStationQueues(tx, [grillId]));
    expect(n28).toBeDefined();
    expect(queues.get(grillId)!.find((group) => group.orderId === tabId)).toMatchObject({
      formerNumbers: [n28],
    });
  });
});
