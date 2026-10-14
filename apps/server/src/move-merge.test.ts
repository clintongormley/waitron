import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  floorTodayJoinTables,
  floorTodayJoins,
  kitchenStations,
  locations,
  printJobs,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  units,
} from "@waitron/catalogue";
import {
  centsToDecimal,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  jobOrigin,
} from "@waitron/shared";
import type { OriginConfig } from "./till-config.js";
import { createTable } from "./testing/live-table.js";
import {
  addTabRound,
  listStationQueues,
  moveOrderLines,
  updateHeldOrder,
} from "./working-order.js";
import { createPrinter } from "@waitron/printing";
import {
  kitchenNotices,
  setRoutingCell,
  writeKitchenTicketGrouping,
  writePrintHeldWork,
  writePrintMovedSlips,
} from "@waitron/venue-service";
import { createStation, updateStation } from "./kitchen.js";
import { placeGroups } from "./order-groups.js";
import { attachPrinterToStation } from "./station-printers.js";
import { printedLines } from "./testing/decode-ticket.js";
import {
  OPERATOR,
  billRow,
  commandFor,
  inTx,
  join,
  nameParty,
  nextMillisecond,
  order,
  orderForParty,
  pay,
  revisionOf,
  seat,
  setupPartyVenue,
  split,
  type PartyVenue,
} from "./testing/party-venue.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import "./errors.js";
import { openPartyTab } from "./testing/serve-line.js";
import { joinTables, moveGuests, splitTable } from "./table-actions.js";
import { moveBill } from "./move-bill.js";
import { mergeBills, splitBill, transferItems } from "./bill-actions.js";
import { enqueueCorrectionSlips, reprintOrderTickets } from "./kitchen-print.js";

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
  cafeId: string;
  aguaId: string;
  /** "Bacon" — sold only as another dish's extra here, so a child line's product id can never be
   *  mistaken for a dish's. */
  baconId: string;
}

/** A fresh tenant/location/node + a three-product catalogue (Café 1.50, Agua 2.00, both general;
 *  Bacon 0.50, reduced). */
async function setupVenue(): Promise<Seeded> {
  await seedTenant(db);
  // Through the table definitions rather than raw SQL: `units.id` and `locations.id` are
  // `$defaultFn` generators a raw insert never reaches.
  await db.insert(units).values([
    {
      seedKey: "each",
      name: { en: "each" },
      abbreviation: { en: "ea" },
      precision: 0,
      hardwareUnit: null,
    },
    {
      seedKey: "kg",
      name: { en: "kg" },
      abbreviation: { en: "kg" },
      precision: 3,
      hardwareUnit: "kg",
    },
  ]);
  const locationId = randomUUID();
  await db.insert(locations).values({
    id: locationId,
    name: "Barra",
    invoiceLocales: [LOCALE],
    operationDescription: "Venta en establecimiento",
  });
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const cfg: OriginConfig = {
    origin: jobOrigin("dashboard"),
    nodeId: brandNodeId(nodeId),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const { cafeId, aguaId, baconId } = await withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Carta" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    const cafe = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Café",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const agua = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Agua",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    const bacon = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Bacon",
      pricingUnit: "each",
      unitPrice: "0.50",
      vatClass: "reduced",
    });
    await assignCatalogueToLocation(tx, locationId, cat.id);
    return { cafeId: cafe.id, aguaId: agua.id, baconId: bacon.id };
  });
  offersByCfg.set(
    cfg,
    await withTransaction(db, (tx) => offerProducts(tx, cfg, { zone: "tables" })),
  );
  return { cfg, cafeId, aguaId, baconId };
}

/** Each venue's offers in its tables zone, keyed by the venue's config so call sites pass only `cfg`. */
const offersByCfg = new WeakMap<OriginConfig, ZoneOffers>();
function offersOf(cfg: OriginConfig): ZoneOffers {
  return offersByCfg.get(cfg)!;
}

function asApp<T>(cfg: OriginConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

/** Create one active dining table in the venue's tables zone; returns its id. */
async function seedTable(cfg: OriginConfig, label: string): Promise<string> {
  const zoneId = offersOf(cfg).zoneId;
  return asApp(cfg, (tx) => createTable(tx, cfg, { label, zoneId }).then((r) => r.id));
}

/** Open a tab on a table with the given lines; returns the tab (working_order) id. */
async function openTabOn(
  cfg: OriginConfig,
  tableId: string,
  lines: { productId: string; quantity: string }[],
): Promise<string> {
  return asApp(cfg, (tx) =>
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
    const { cfg, cafeId, aguaId } = await setupVenue();
    const t1 = await seedTable(cfg, "M1");
    const t2 = await seedTable(cfg, "M2");
    const from = await openTabOn(cfg, t1, [{ productId: cafeId, quantity: "1" }]);
    const to = await openTabOn(cfg, t2, [{ productId: aguaId, quantity: "1" }]);
    const sourceLineId = (await linesOf(from))[0]!.id;

    await asApp(cfg, (tx) => moveOrderLines(tx, cfg, from, to, undefined));

    // Destination now carries both lines; the café keeps its own locked gross; source is empty.
    const dest = await linesOf(to);
    expect(dest).toHaveLength(2);
    expect(dest.map((l) => l.lineNo)).toEqual([1, 2]);
    expect(dest.find((l) => l.productId === cafeId)?.gross).toBe("1.50");
    expect(dest.find((l) => l.productId === cafeId)?.id).toBe(sourceLineId);
    expect(await linesOf(from)).toHaveLength(0);
  });

  it("moves only the NAMED subset (the TS-4 shape), leaving the rest on the source", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    const t1 = await seedTable(cfg, "S1");
    const t2 = await seedTable(cfg, "S2");
    const from = await openTabOn(cfg, t1, [
      { productId: cafeId, quantity: "1" },
      { productId: aguaId, quantity: "1" },
    ]);
    const to = await openTabOn(cfg, t2, []);

    await asApp(cfg, (tx) => moveOrderLines(tx, cfg, from, to, [2])); // move only line 2 (agua)

    expect(await linesOf(to)).toHaveLength(1);
    expect((await linesOf(to))[0]!.productId).toBe(aguaId);
    const remaining = await linesOf(from);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.productId).toBe(cafeId);
  });

  it("moving from an EMPTY tab is a no-op (the empty-source guard), no error", async () => {
    const { cfg, aguaId } = await setupVenue();
    const t1 = await seedTable(cfg, "E1");
    const t2 = await seedTable(cfg, "E2");
    const from = await openTabOn(cfg, t1, []); // empty tab
    const to = await openTabOn(cfg, t2, [{ productId: aguaId, quantity: "1" }]);

    await asApp(cfg, (tx) => moveOrderLines(tx, cfg, from, to, undefined));
    expect(await linesOf(to)).toHaveLength(1); // unchanged
  });

  it("refuses a non-open source or destination (tab.not_open)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const t1 = await seedTable(cfg, "N1");
    const t2 = await seedTable(cfg, "N2");
    const from = await openTabOn(cfg, t1, [{ productId: cafeId, quantity: "1" }]);
    const to = await openTabOn(cfg, t2, []);
    // Abandon the destination (owner write, fixture setup).
    await db.execute(sql`update working_orders set status = 'abandoned' where id = ${to}`);
    await expect(
      asApp(cfg, (tx) => moveOrderLines(tx, cfg, from, to, undefined)),
    ).rejects.toMatchObject({
      code: "tab.not_open",
      params: { tabId: to },
    });
    await expect(
      asApp(cfg, (tx) => moveOrderLines(tx, cfg, to, from, undefined)),
    ).rejects.toMatchObject({
      code: "tab.not_open",
      params: { tabId: to },
    });
    expect(await linesOf(from)).toHaveLength(1);
  });

  it("refuses a self-transfer (fromTabId === toTabId) with tab.merge_self and leaves the lines intact", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    const t = await seedTable(cfg, "ST");
    const tab = await openTabOn(cfg, t, [
      { productId: cafeId, quantity: "1" },
      { productId: aguaId, quantity: "1" },
    ]);
    // `mergeBills` guards this at its own top, but `moveOrderLines` is exported and must self-guard:
    // a "move all" onto itself would wipe the tab.
    await expect(
      asApp(cfg, (tx) => moveOrderLines(tx, cfg, tab, tab, undefined)),
    ).rejects.toMatchObject({
      code: "tab.merge_self",
      params: { tabId: tab },
    });
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
      .where(eq(kitchenStations.locationId, v.cfg.locationId));
    const { id } = await createPrinter(
      tx,
      { locationId: v.cfg.locationId },
      { name: "Cocina", transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
    );
    await attachPrinterToStation(tx, {
      locationId: v.cfg.locationId,
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
    const mesa4 = await v.table("Mesa 4");
    const mesa5 = await v.table("Mesa 5");
    const { partyId, tabId } = await seat(v, mesa4);
    await orderForParty(v, partyId, ["Burger"], tabId);
    await orderForParty(v, partyId, ["Vino"], tabId);
    const checkId = await split(v, partyId, tabId, [2]);
    await holdOne(v, tabId, "Agua");
    const before = await noticesOf([tabId, checkId]);

    await join(v, partyId, mesa5);

    expect((await noticesOf([tabId, checkId])).slice(before.length)).toEqual([]);
  });

  it("tells the kitchen of every bill when a table leaves the party, naming the tables the dishes had", async () => {
    const v = await setupPartyVenue(db);
    const printerId = await kitchenPrinter(v);
    const mesa4 = await v.table("Mesa 4");
    const mesa5 = await v.table("Mesa 5");
    const { partyId, tabId } = await seat(v, mesa4);
    await join(v, partyId, mesa5);
    await orderForParty(v, partyId, ["Burger", "Vino", "Flan"], tabId);
    const checkId = await split(v, partyId, tabId, [2]);
    const newTabId = await split(v, partyId, tabId, [1]);
    const command = await commandFor(v, partyId);
    const before = await noticesOf([tabId, checkId, newTabId]);
    const printed = (await printedBy(printerId)).length;

    await inTx(v, (tx) => splitTable(tx, v.cfg, partyId, mesa5, newTabId, command));

    const notices = (await noticesOf([tabId, checkId, newTabId])).slice(before.length);
    expect(byDish(notices)).toEqual([
      ["BURG", newTabId, "Mesa 5"],
      ["FLAN", tabId, "Mesa 4"],
      ["TINTO", checkId, "Mesa 4"],
    ]);
    const slips = (await printedBy(printerId))
      .slice(printed)
      .filter((slip) => slip.includes("*** MOVIDO ***"));
    expect(slips).toHaveLength(3);
    expect(slips.filter((slip) => slip.includes("De: Mesa 4, 5\nA:  Mesa 5\n"))).toHaveLength(1);
    expect(slips.filter((slip) => slip.includes("De: Mesa 4, 5\nA:  Mesa 4\n"))).toHaveLength(2);
  });

  it("tells the kitchen of the party's sent dishes when an empty table leaves it", async () => {
    const v = await setupPartyVenue(db);
    const mesa4 = await v.table("Mesa 4");
    const mesa5 = await v.table("Mesa 5");
    const { partyId, tabId } = await seat(v, mesa4);
    await join(v, partyId, mesa5);
    await orderForParty(v, partyId, ["Burger"], tabId);
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) => splitTable(tx, v.cfg, partyId, mesa5, null, command));

    expect(await noticesOf([tabId])).toEqual([
      { workingOrderId: tabId, kind: "moved", lineName: "BURG", movedTo: "Mesa 4" },
    ]);
  });

  it("tells the kitchen of every bill of a party whose tab moves to another table", async () => {
    const v = await setupPartyVenue(db);
    const mesa4 = await v.table("Mesa 4");
    const mesa5 = await v.table("Mesa 5");
    const mesa9 = await v.table("Mesa 9");
    const { partyId, tabId } = await seat(v, mesa4);
    await join(v, partyId, mesa5);
    await orderForParty(v, partyId, ["Burger", "Vino"], tabId);
    const checkId = await split(v, partyId, tabId, [2]);
    const command = await commandFor(v, partyId);
    const before = await noticesOf([tabId, checkId]);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, mesa9, { ...command, bills: "merge", otherPartyId: null }),
    );

    const notices = (await noticesOf([tabId, checkId])).slice(before.length);
    expect(byDish(notices)).toEqual([
      ["BURG", tabId, "Mesa 9"],
      ["TINTO", checkId, "Mesa 9"],
    ]);
  });

  it("tells the kitchen nothing of the bills of a party that takes in another party's table, and of the bill merged in only that its dishes are on another order", async () => {
    const v = await setupPartyVenue(db);
    const mesa4 = await v.table("Mesa 4");
    const mesa7 = await v.table("Mesa 7");
    const ana = await seat(v, mesa4);
    await orderForParty(v, ana.partyId, ["Burger", "Vino"], ana.tabId);
    const checkId = await split(v, ana.partyId, ana.tabId, [2]);
    await nextMillisecond();
    const other = await seat(v, mesa7);
    await orderForParty(v, other.partyId, ["Flan"], other.tabId);
    const expectedPartyRevision = await revisionOf(v, ana.partyId);
    const expectedOtherPartyRevision = await revisionOf(v, other.partyId);
    const before = await noticesOf([ana.tabId, checkId, other.tabId]);
    await nextMillisecond();

    await inTx(v, (tx) =>
      joinTables(tx, v.cfg, ana.partyId, mesa7, {
        bills: "merge",
        expectedPartyRevision,
        otherPartyId: other.partyId,
        expectedOtherPartyRevision,
        operatorId: OPERATOR,
      }),
    );

    expect(await noticesOf([ana.tabId, checkId, other.tabId])).toEqual([
      ...before,
      { workingOrderId: ana.tabId, kind: "moved", lineName: "FLAN", movedTo: "Mesa 4, 7" },
    ]);
  });

  it("tells the kitchen of the main bill of the party taken in, which merges, and nothing of its kept bill, which keeps its table and its name", async () => {
    const v = await setupPartyVenue(db);
    const mesa4 = await v.table("Mesa 4");
    const mesa7 = await v.table("Mesa 7");
    const ana = await seat(v, mesa4);
    await nextMillisecond();
    const other = await seat(v, mesa7);
    await orderForParty(v, other.partyId, ["Flan", "Tarta"], other.tabId);
    const otherCheckId = await split(v, other.partyId, other.tabId, [2]);
    const expectedPartyRevision = await revisionOf(v, ana.partyId);
    const expectedOtherPartyRevision = await revisionOf(v, other.partyId);
    const before = await noticesOf([ana.tabId, other.tabId, otherCheckId]);
    await nextMillisecond();

    await inTx(v, (tx) =>
      joinTables(tx, v.cfg, ana.partyId, mesa7, {
        bills: "merge",
        expectedPartyRevision,
        otherPartyId: other.partyId,
        expectedOtherPartyRevision,
        operatorId: OPERATOR,
      }),
    );

    expect(await noticesOf([ana.tabId, other.tabId, otherCheckId])).toEqual([
      ...before,
      { workingOrderId: ana.tabId, kind: "moved", lineName: "FLAN", movedTo: "Mesa 4, 7" },
    ]);
  });
});

/**
 * A station named `name` with its own printer, taking each of `dishes`; returns the printer's id.
 */
async function stationWithPrinter(v: PartyVenue, name: string, dishes: string[]): Promise<string> {
  return inTx(v, async (tx) => {
    const station = await createStation(tx, v.cfg, { name });
    const { id } = await createPrinter(
      tx,
      { locationId: v.cfg.locationId },
      { name: `${name} printer`, transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
    );
    await attachPrinterToStation(tx, {
      locationId: v.cfg.locationId,
      stationId: station.id,
      printerId: id,
    });
    for (const dish of dishes)
      await setRoutingCell(
        tx,
        v.cfg,
        { row: { kind: "product", productId: v.productId(dish) }, zoneId: null },
        { kind: "station", stationId: station.id },
      );
    return id;
  });
}

describe("a MOVED slip per order per station", () => {
  it("prints one slip for each order at each station, listing that order's dishes there", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    const postres = await stationWithPrinter(v, "Postres", ["Flan"]);
    const mesa11 = await v.table("Mesa 11");
    const mesa12 = await v.table("Mesa 12");
    const { partyId, tabId } = await seat(v, mesa11);
    await nameParty(v, partyId, "Ana");
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, partyId, {
        groups: [
          {
            lines: [
              { menuItemId: v.item("Burger"), quantity: "2" },
              { menuItemId: v.item("Paella"), quantity: "1" },
              { menuItemId: v.item("Flan"), quantity: "1" },
              { menuItemId: v.item("Burger"), quantity: "1" },
            ],
            release: "fire",
          },
        ],
        operatorId: OPERATOR,
        billId: tabId,
      }),
    );
    const checkId = await split(v, partyId, tabId, [4]);
    const numbers = await db
      .select({ id: workingOrders.id, orderNumber: workingOrders.orderNumber })
      .from(workingOrders)
      .where(inArray(workingOrders.id, [tabId, checkId]));
    const numberOf = (id: string) => numbers.find((row) => row.id === id)!.orderNumber;
    const grillBefore = (await printedBy(grill)).length;
    const postresBefore = (await printedBy(postres)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, mesa12, { ...command, bills: "merge", otherPartyId: null }),
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
    const postresSlips = (await printedBy(postres)).slice(postresBefore);
    expect(grillSlips.map((text) => text.split("\n"))).toEqual(
      expect.arrayContaining([
        slip(numberOf(tabId), ["2.000 x BURG", "1.000 x PAELLA"], "Grill"),
        slip(numberOf(checkId), ["1.000 x BURG"], "Grill"),
      ]),
    );
    expect(grillSlips).toHaveLength(2);
    expect(postresSlips.map((text) => text.split("\n"))).toEqual([
      slip(numberOf(tabId), ["1.000 x FLAN"], "Postres"),
    ]);
  });

  it("lists a station's dishes as its tickets do: group-less ones first, then group by group", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    const mesa15 = await v.table("Mesa 15");
    const mesa16 = await v.table("Mesa 16");
    const { partyId, tabId } = await seat(v, mesa15);
    await orderForParty(v, partyId, ["Burger"], tabId);
    await orderForParty(v, partyId, ["Paella"], tabId);
    await order(v, tabId, "Burger");
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, mesa16, { ...command, bills: "merge", otherPartyId: null }),
    );

    const slips = (await printedBy(grill)).slice(before).map((text) => text.split("\n"));
    expect(slips).toHaveLength(1);
    expect(slips[0]!.slice(6)).toEqual([
      "1.000 x BURG",
      "GROUP 1",
      "1.000 x BURG",
      "GROUP 2",
      "1.000 x PAELLA",
      "",
    ]);
  });

  it("names the party a bill moved to the counter left, and words the counter", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    const mesa13 = await v.table("Mesa 13");
    const { partyId, tabId } = await seat(v, mesa13);
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
        { bills: "merge", operatorId: OPERATOR, expectedPartyRevision },
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
    const mesa21 = await v.table("Mesa 21");
    const mesa22 = await v.table("Mesa 22");
    const ana = await seat(v, mesa21);
    await nameParty(v, ana.partyId, "Ana");
    await nextMillisecond();
    const luis = await seat(v, mesa22);
    await nameParty(v, luis.partyId, "Luis");
    await order(v, ana.tabId, "Burger");
    await pay(v, ana.tabId, "12.00");
    const number = (
      await db
        .select({ orderNumber: workingOrders.orderNumber })
        .from(workingOrders)
        .where(eq(workingOrders.id, ana.tabId))
    )[0]!.orderNumber;
    const before = (await printedBy(grill)).length;
    const expectedPartyRevision = await revisionOf(v, ana.partyId);
    const expectedOtherPartyRevision = await revisionOf(v, luis.partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, ana.partyId, mesa22, {
        bills: "merge",
        expectedPartyRevision,
        otherPartyId: luis.partyId,
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
      .insert(floorTodayJoins)
      .values({ zoneId: v.tables.zoneId, seats: 8, name })
      .returning({ id: floorTodayJoins.id });
    for (const tableId of tableIds)
      await tx
        .insert(floorTodayJoinTables)
        .values({ joinId: row!.id, tableId, beforeX: 0, beforeY: 0, beforeRotation: 0 });
  });
}

describe("when a MOVED slip prints: a table or a place name lost (§3)", () => {
  it("a free table joined prints nothing and records no notice: no table and no name is lost (row 6)", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    const mesa71 = await v.table("Mesa 71");
    const mesa72 = await v.table("Mesa 72");
    const { partyId, tabId } = await seat(v, mesa71);
    await order(v, tabId, "Burger");
    const before = (await printedBy(grill)).length;
    const notices = await noticesOf([tabId]);

    await join(v, partyId, mesa72);

    expect((await printedBy(grill)).slice(before)).toEqual([]);
    expect(await noticesOf([tabId])).toEqual(notices);
  });

  it("Split a table with no bill chosen prints From: Mesa 51, 52 / To: Mesa 51 for each bill that stays (row 8)", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    const mesa51 = await v.table("Mesa 51");
    const mesa52 = await v.table("Mesa 52");
    const { partyId, tabId } = await seat(v, mesa51);
    await join(v, partyId, mesa52);
    await order(v, tabId, "Burger", "Burger");
    await split(v, partyId, tabId, [2]);
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) => splitTable(tx, v.cfg, partyId, mesa52, null, command));

    const slips = (await printedBy(grill)).slice(before).map((text) => text.split("\n"));
    expect(slips.map((lines) => lines.slice(3, 5))).toEqual([
      ["De: Mesa 51, 52", "A:  Mesa 51"],
      ["De: Mesa 51, 52", "A:  Mesa 51"],
    ]);
  });

  it("a bill moved between two tables of the group Terraza names each side's table in brackets (row 12b)", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    const mesa77 = await v.table("Mesa 77");
    const mesa78 = await v.table("Mesa 78");
    const { partyId, tabId } = await seat(v, mesa77);
    // Seating a grouped table seats the whole group, so the group forms after the party sits.
    await group(v, "Terraza", [mesa77, mesa78]);
    await order(v, tabId, "Paella", "Burger");
    const second = await split(v, partyId, tabId, [2]);
    const before = (await printedBy(grill)).length;
    const expectedPartyRevision = await revisionOf(v, partyId);

    await inTx(v, (tx) =>
      moveBill(
        tx,
        v.cfg,
        second,
        { tableId: mesa78 },
        { bills: "merge", operatorId: OPERATOR, expectedPartyRevision },
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
  it("a join of another party's table, bills merging, prints the merged-in order's dishes from Mesa 74 to Mesa 73, 74, and nothing for the surviving order (row 7)", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    const mesa73 = await v.table("Mesa 73");
    const mesa74 = await v.table("Mesa 74");
    const ana = await seat(v, mesa73);
    await order(v, ana.tabId, "Burger");
    await nextMillisecond();
    const luis = await seat(v, mesa74);
    await order(v, luis.tabId, "Paella");
    const numbers = await numbersOf([ana.tabId, luis.tabId]);
    const before = (await printedBy(grill)).length;
    const expectedPartyRevision = await revisionOf(v, ana.partyId);
    const expectedOtherPartyRevision = await revisionOf(v, luis.partyId);

    await inTx(v, (tx) =>
      joinTables(tx, v.cfg, ana.partyId, mesa74, {
        bills: "merge",
        expectedPartyRevision,
        otherPartyId: luis.partyId,
        expectedOtherPartyRevision,
        operatorId: OPERATOR,
      }),
    );

    expect(await slipsSince(grill, before)).toEqual([
      movedSlip(
        "Grill",
        `Pedido ${numbers.get(luis.tabId)} -> ${numbers.get(ana.tabId)}`,
        "Mesa 74",
        "Mesa 73, 74",
        ["1.000 x PAELLA"],
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
        ["1.000 x PAELLA"],
      ),
    ]);
  });

  it("Transfer items prints only the dishes moved, at the part moved (row 16b)", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    const { partyId, tabId } = await seat(v, await v.table("Mesa 91"));
    await inTx(v, (tx) =>
      addTabRound(tx, v.cfg, tabId, [
        { menuItemId: v.item("Burger"), quantity: "2" },
        { menuItemId: v.item("Paella"), quantity: "1" },
      ]),
    );
    const second = await split(v, partyId, tabId, [2]);
    const numbers = await numbersOf([tabId, second]);
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      transferItems(tx, v.cfg, tabId, second, [{ lineNo: 1, quantity: "1" }], command),
    );

    expect(await slipsSince(grill, before)).toEqual([
      movedSlip(
        "Grill",
        `Pedido ${numbers.get(tabId)} -> ${numbers.get(second)}`,
        "Mesa 91",
        "Mesa 91",
        ["1.000 x BURG"],
      ),
    ]);
  });

  it("Split the bill prints one slip of the dishes split off, at their station, onto the new order (row 16c)", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    const postres = await stationWithPrinter(v, "Postres", ["Flan"]);
    const { partyId, tabId } = await seat(v, await v.table("Mesa 91"));
    await order(v, tabId, "Burger", "Flan");
    const grillBefore = (await printedBy(grill)).length;
    const postresBefore = (await printedBy(postres)).length;
    const notices = await noticesOf([tabId]);

    const second = await split(v, partyId, tabId, [2]);

    const numbers = await numbersOf([tabId, second]);
    expect(await slipsSince(postres, postresBefore)).toEqual([
      movedSlip(
        "Postres",
        `Pedido ${numbers.get(tabId)} -> ${numbers.get(second)}`,
        "Mesa 91",
        "Mesa 91",
        ["1.000 x FLAN"],
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
        v.cfg,
        { row: { kind: "product", productId: v.productId("Agua") }, zoneId: null },
        { kind: "no_preparation" },
      ),
    );
    const { partyId, tabId } = await seat(v, await v.table("Mesa 93"));
    await order(v, tabId, "Burger", "Agua", "Agua");
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
        { bills: "merge", operatorId: OPERATOR, expectedPartyRevision },
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
        ["1.000 x BURG"],
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

describe("held dishes the kitchen has on a HOLD ticket are on the MOVED slip (ruling 5)", () => {
  const printHeldWork = (v: PartyVenue, on: boolean) => inTx(v, (tx) => writePrintHeldWork(tx, on));
  afterEach(() => withTransaction(db, (tx) => writePrintHeldWork(tx, false)));

  it("a party with a fired Burger and a held group 2 Paella on a HOLD ticket moving Mesa 111 to 112 prints one Grill slip listing both, the Paella under HOLD and GROUP 2", async () => {
    const v = await setupPartyVenue(db);
    await printHeldWork(v, true);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    const mesa112 = await v.table("Mesa 112");
    const { partyId, tabId } = await seat(v, await v.table("Mesa 111"));
    await burgerAndHeldPaella(v, partyId, tabId);
    const numbers = await numbersOf([tabId]);
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, mesa112, { ...command, bills: "merge", otherPartyId: null }),
    );

    expect(await slipsSince(grill, before)).toEqual([
      movedSlip("Grill", `Pedido ${numbers.get(tabId)}`, "Mesa 111", "Mesa 112", [
        "1.000 x BURG",
        "HOLD",
        "GROUP 2",
        "1.000 x PAELLA",
      ]),
    ]);
    expect(byDish(await noticesOf([tabId]))).toEqual([
      ["BURG", tabId, "Mesa 112"],
      ["PAELLA", tabId, "Mesa 112"],
    ]);
  });

  it("lists each held group on a HOLD ticket under its own GROUP line, its dishes in line order", async () => {
    const v = await setupPartyVenue(db);
    await printHeldWork(v, true);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    const mesa119 = await v.table("Mesa 119");
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
      moveGuests(tx, v.cfg, partyId, mesa119, { ...command, bills: "merge", otherPartyId: null }),
    );

    expect(await slipsSince(grill, before)).toEqual([
      movedSlip("Grill", `Pedido ${numbers.get(tabId)}`, "Mesa 118", "Mesa 119", [
        "HOLD",
        "GROUP 1",
        "1.000 x PAELLA",
        "1.000 x BURG",
        "GROUP 2",
        "1.000 x PAELLA",
      ]),
    ]);
  });

  it("a held group never printed adds nothing to the slip and records no notice", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    const mesa114 = await v.table("Mesa 114");
    const { partyId, tabId } = await seat(v, await v.table("Mesa 113"));
    await burgerAndHeldPaella(v, partyId, tabId);
    const numbers = await numbersOf([tabId]);
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, mesa114, { ...command, bills: "merge", otherPartyId: null }),
    );

    expect(await slipsSince(grill, before)).toEqual([
      movedSlip("Grill", `Pedido ${numbers.get(tabId)}`, "Mesa 113", "Mesa 114", ["1.000 x BURG"]),
    ]);
    expect(byDish(await noticesOf([tabId]))).toEqual([["BURG", tabId, "Mesa 114"]]);
  });

  it("Split the bill of a held dish on a HOLD ticket prints a slip that starts with HOLD, onto the new order", async () => {
    const v = await setupPartyVenue(db);
    await printHeldWork(v, true);
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
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
        ["HOLD", "GROUP 2", "1.000 x PAELLA"],
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
        ["HOLD", "GROUP 2", "1.000 x PAELLA"],
      ),
    ]);
    expect(byDish(await noticesOf([second]))).toEqual([
      ["BURG", second, "Mesa 117"],
      ["PAELLA", second, "Mesa 117"],
    ]);
  });
});

describe("a MOVED slip lays out each line by the ticket grouping and never adds two lines together (§4)", () => {
  afterEach(() =>
    withTransaction(db, async (tx) => {
      await writeKitchenTicketGrouping(tx, "combined");
      await writePrintHeldWork(tx, false);
    }),
  );
  const dishLines = (lines: readonly string[]) => lines.filter((text) => / x [A-Z]+$/.test(text));

  it("with separate quantities, a fired 3 Burger and a held 2 Paella print one entry of 1 each, as their tickets did", async () => {
    const v = await setupPartyVenue(db);
    await inTx(v, async (tx) => {
      await writeKitchenTicketGrouping(tx, "separate");
      await writePrintHeldWork(tx, true);
    });
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    const mesa122 = await v.table("Mesa 122");
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
        ["1.000 x BURG", "1.000 x BURG", "1.000 x BURG"],
        ["1.000 x PAELLA", "1.000 x PAELLA"],
      ]),
    );
    const numbers = await numbersOf([tabId]);
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, mesa122, { ...command, bills: "merge", otherPartyId: null }),
    );

    expect(await slipsSince(grill, before)).toEqual([
      movedSlip("Grill", `Pedido ${numbers.get(tabId)}`, "Mesa 121", "Mesa 122", [
        "1.000 x BURG",
        "1.000 x BURG",
        "1.000 x BURG",
        "HOLD",
        "GROUP 2",
        "1.000 x PAELLA",
        "1.000 x PAELLA",
      ]),
    ]);
  });

  it("with combined quantities, two lines of one Burger on one ticket print as two entries of 1: lines are never added together", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    const mesa124 = await v.table("Mesa 124");
    const { partyId, tabId } = await seat(v, await v.table("Mesa 123"));
    const tickets = (await printedBy(grill)).length;
    await order(v, tabId, "Burger", "Burger");
    expect((await slipsSince(grill, tickets)).map(dishLines)).toEqual([["2.000 x BURG"]]);
    const numbers = await numbersOf([tabId]);
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, mesa124, { ...command, bills: "merge", otherPartyId: null }),
    );

    expect(await slipsSince(grill, before)).toEqual([
      movedSlip("Grill", `Pedido ${numbers.get(tabId)}`, "Mesa 123", "Mesa 124", [
        "1.000 x BURG",
        "1.000 x BURG",
      ]),
    ]);
  });

  it("with combined quantities, one Burger sent on each of two tickets prints as two entries of 1", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    const mesa126 = await v.table("Mesa 126");
    const { partyId, tabId } = await seat(v, await v.table("Mesa 125"));
    const tickets = (await printedBy(grill)).length;
    await order(v, tabId, "Burger");
    await order(v, tabId, "Burger");
    expect((await slipsSince(grill, tickets)).map(dishLines)).toEqual([
      ["1.000 x BURG"],
      ["1.000 x BURG"],
    ]);
    const numbers = await numbersOf([tabId]);
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, mesa126, { ...command, bills: "merge", otherPartyId: null }),
    );

    expect(await slipsSince(grill, before)).toEqual([
      movedSlip("Grill", `Pedido ${numbers.get(tabId)}`, "Mesa 125", "Mesa 126", [
        "1.000 x BURG",
        "1.000 x BURG",
      ]),
    ]);
  });

  it("with combined quantities, two tickets of one Burger reprinted as one entry of 2 still print as two entries of 1", async () => {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    const mesa128 = await v.table("Mesa 128");
    const { partyId, tabId } = await seat(v, await v.table("Mesa 127"));
    await order(v, tabId, "Burger");
    await order(v, tabId, "Burger");
    const reprinted = (await printedBy(grill)).length;
    await inTx(v, (tx) => reprintOrderTickets(tx, v.cfg, tabId));
    expect((await slipsSince(grill, reprinted)).map(dishLines)).toEqual([["2.000 x BURG"]]);
    const before = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, mesa128, { ...command, bills: "merge", otherPartyId: null }),
    );

    expect((await slipsSince(grill, before)).map(dishLines)).toEqual([
      ["1.000 x BURG", "1.000 x BURG"],
    ]);
  });

  it("with combined quantities, two tickets of one Burger reprinted as one entry of 2, its reprint unprinted, still print as two entries of 1 after Transfer items moves both", async () => {
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

    expect((await slipsSince(grill, before)).map(dishLines)).toEqual([
      ["1.000 x BURG", "1.000 x BURG"],
    ]);
  });

  it("with combined quantities, two tickets of one Burger reprinted as one entry of 2, its reprint unprinted, still print as two entries of 1 after Merge bills", async () => {
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

    expect((await slipsSince(grill, before)).map(dishLines)).toEqual([
      ["1.000 x BURG", "1.000 x BURG"],
    ]);
  });

  it("with combined quantities, one Burger sent twice while the station had no printer prints as two entries of 1", async () => {
    const v = await setupPartyVenue(db);
    const mesa130 = await v.table("Mesa 130");
    const { partyId, tabId } = await seat(v, await v.table("Mesa 129"));
    await order(v, tabId, "Burger");
    await order(v, tabId, "Burger");
    const cocina = await kitchenPrinter(v);
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, mesa130, { ...command, bills: "merge", otherPartyId: null }),
    );

    expect((await slipsSince(cocina, 0)).map(dishLines)).toEqual([
      ["1.000 x BURG", "1.000 x BURG"],
    ]);
  });
});

describe("the venue's print-MOVED-slips setting", () => {
  afterEach(() => withTransaction(db, (tx) => writePrintMovedSlips(tx, true)));

  /** A party at Mesa 21 with a fired Burger at the Grill; Move guests takes it to Mesa 22. */
  async function moveGuestsWithBurger(on: boolean) {
    const v = await setupPartyVenue(db);
    const grill = await stationWithPrinter(v, "Grill", ["Burger"]);
    await inTx(v, (tx) => writePrintMovedSlips(tx, on));
    const mesa21 = await v.table("Mesa 21");
    const mesa22 = await v.table("Mesa 22");
    const { partyId, tabId } = await seat(v, mesa21);
    await orderForParty(v, partyId, ["Burger"], tabId);
    const printed = (await printedBy(grill)).length;
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, mesa22, { ...command, bills: "merge", otherPartyId: null }),
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
        .where(eq(ticketItems.workingOrderId, tabId));
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
  afterEach(() => withTransaction(db, (tx) => writePrintMovedSlips(tx, true)));

  async function stationIdOf(v: PartyVenue, name: string): Promise<string> {
    const [station] = await db
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(and(eq(kitchenStations.locationId, v.cfg.locationId), eq(kitchenStations.name, name)));
    return station!.id;
  }

  async function stationPrints(v: PartyVenue, name: string, printMovedSlips: boolean | null) {
    const id = await stationIdOf(v, name);
    await inTx(v, (tx) => updateStation(tx, v.cfg, id, { printMovedSlips }));
  }

  /** Burger at the Grill and Flan at Postres, both fired at Mesa 31; Move guests takes them to Mesa 32. */
  async function moveGuestsWithBurgerAndFlan(
    venue: boolean,
    grill: boolean | null,
    postres: boolean | null,
  ) {
    const v = await setupPartyVenue(db);
    const grillPrinter = await stationWithPrinter(v, "Grill", ["Burger"]);
    const postresPrinter = await stationWithPrinter(v, "Postres", ["Flan"]);
    await inTx(v, (tx) => writePrintMovedSlips(tx, venue));
    await stationPrints(v, "Grill", grill);
    await stationPrints(v, "Postres", postres);
    const { partyId, tabId } = await seat(v, await v.table("Mesa 31"));
    await orderForParty(v, partyId, ["Burger", "Flan"], tabId);
    const printed = {
      grill: (await printedBy(grillPrinter)).length,
      postres: (await printedBy(postresPrinter)).length,
    };
    const mesa32 = await v.table("Mesa 32");
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, mesa32, { ...command, bills: "merge", otherPartyId: null }),
    );

    return {
      tabId,
      grill: (await printedBy(grillPrinter)).slice(printed.grill),
      postres: (await printedBy(postresPrinter)).slice(printed.postres),
    };
  }

  it("venue on, Grill off, Postres following: Move guests prints at Postres only and records notices at both", async () => {
    const { tabId, grill, postres } = await moveGuestsWithBurgerAndFlan(true, false, null);

    expect(grill).toEqual([]);
    expect(postres).toHaveLength(1);
    expect(postres[0]).toContain("*** MOVIDO ***");
    expect(postres[0]).toContain("FLAN");
    expect(byDish(await noticesOf([tabId]))).toEqual([
      ["BURG", tabId, "Mesa 32"],
      ["FLAN", tabId, "Mesa 32"],
    ]);
  });

  it("venue off, Grill on: Move guests prints at the Grill only", async () => {
    const { grill, postres } = await moveGuestsWithBurgerAndFlan(false, true, null);

    expect(grill).toHaveLength(1);
    expect(grill[0]).toContain("*** MOVIDO ***");
    expect(grill[0]).toContain("BURG");
    expect(postres).toEqual([]);
  });

  it("after Merge bills with every station off, no slip prints and the station queue still shows the merged bill's number", async () => {
    const v = await setupPartyVenue(db);
    await inTx(v, (tx) => writePrintMovedSlips(tx, true));
    const grill = await stationWithPrinter(v, "Grill", ["Burger", "Paella"]);
    await stationPrints(v, "Grill", false);
    const { partyId, tabId } = await seat(v, await v.table("Mesa 33"));
    await updateHeldOrder({ db: v.db }, v.cfg, tabId, {
      revision: (await billRow(v, tabId)).revision,
      lines: [{ menuItemId: v.item("Agua"), quantity: "1" }],
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
    const grillId = await stationIdOf(v, "Grill");
    const queues = await inTx(v, (tx) => listStationQueues(tx, [grillId]));
    expect(n28).toBeDefined();
    expect(queues.get(grillId)!.find((group) => group.orderId === tabId)).toMatchObject({
      formerNumbers: [n28],
    });
  });
});
