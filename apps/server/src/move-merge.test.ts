import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  kitchenStations,
  locations,
  printJobs,
  tills,
  withTransaction,
  workingOrderLines,
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
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { addTabRound, moveOrderLines } from "./working-order.js";
import { createPrinter } from "@waitron/printing";
import { kitchenNotices } from "@waitron/venue-service";
import { attachPrinterToStation } from "./station-printers.js";
import { printedLines } from "./testing/decode-ticket.js";
import {
  OPERATOR,
  commandFor,
  inTx,
  join,
  nextMillisecond,
  orderForParty,
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
  cfg: TillConfig;
  cafeId: string;
  aguaId: string;
  /** "Bacon" — sold only as another dish's extra here, so a child line's product id can never be
   *  mistaken for a dish's. */
  baconId: string;
}

/** A fresh tenant/location/till/node + a three-product catalogue (Café 1.50, Agua 2.00, both general;
 *  Bacon 0.50, reduced). */
async function setupVenue(): Promise<Seeded> {
  await seedTenant(db);
  // Through the table definitions rather than raw SQL: `units.id` and `locations.id`/`tills.id` are
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
  const tillId = randomUUID();
  await db.insert(tills).values({ id: tillId, locationId, name: "Caja 1" });
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const cfg: TillConfig = {
    tillId: brandTillId(tillId),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const { cafeId, aguaId, baconId } = await withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Carta" });
    const bebidas = await createCategory(tx, { name: { en: "Bebidas" } });
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
const offersByCfg = new WeakMap<TillConfig, ZoneOffers>();
function offersOf(cfg: TillConfig): ZoneOffers {
  return offersByCfg.get(cfg)!;
}

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

/** Create one active dining table in the venue's tables zone; returns its id. */
async function seedTable(cfg: TillConfig, label: string): Promise<string> {
  const zoneId = offersOf(cfg).zoneId;
  return asApp(cfg, (tx) => createTable(tx, cfg, { label, zoneId }).then((r) => r.id));
}

/** Open a tab on a table with the given lines; returns the tab (working_order) id. */
async function openTabOn(
  cfg: TillConfig,
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
    await attachPrinterToStation(tx, { stationId: station!.id, printerId: id });
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
  it("tells the kitchen of sent dishes on every bill of a party that joins a table, and only those", async () => {
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

    const added = (await noticesOf([tabId, checkId])).slice(before.length);
    expect(added).toHaveLength(2);
    expect(added.map((n) => n.kind)).toEqual(["moved", "moved"]);
    expect(added.map((n) => n.movedTo)).toEqual(["Mesa 4, 5", "Mesa 4, 5"]);
    expect(added.map((n) => n.workingOrderId).sort()).toEqual([tabId, checkId].sort());
    expect(added.map((n) => n.lineName).sort()).toEqual(["BURG", "TINTO"]);
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

    await inTx(v, (tx) => splitTable(tx, v.cfg, partyId, mesa5, newTabId, command));

    const notices = await noticesOf([tabId, checkId, newTabId]);
    expect(byDish(notices)).toEqual([
      ["BURG", newTabId, "Mesa 5"],
      ["FLAN", tabId, "Mesa 4"],
      ["TINTO", checkId, "Mesa 4"],
    ]);
    const slips = (await printedBy(printerId)).filter((slip) => slip.includes("MOVED"));
    expect(slips).toHaveLength(3);
    expect(slips.filter((slip) => slip.includes("Mesa 4, 5 -> Mesa 5"))).toHaveLength(1);
    expect(slips.filter((slip) => slip.includes("Mesa 4, 5 -> Mesa 4"))).toHaveLength(2);
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

    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, mesa9, { ...command, bills: "merge", otherPartyId: null }),
    );

    const notices = await noticesOf([tabId, checkId]);
    expect(byDish(notices)).toEqual([
      ["BURG", tabId, "Mesa 9"],
      ["TINTO", checkId, "Mesa 9"],
    ]);
  });

  it("tells the kitchen of every bill of the party that takes in another party's table", async () => {
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

    const notices = await noticesOf([ana.tabId, checkId, other.tabId]);
    expect(byDish(notices)).toEqual([
      ["BURG", ana.tabId, "Mesa 4, 7"],
      ["FLAN", ana.tabId, "Mesa 4, 7"],
      ["TINTO", checkId, "Mesa 4, 7"],
    ]);
  });

  it("tells the kitchen of a split bill of the party taken in, which joins the receiving party", async () => {
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

    const notices = await noticesOf([ana.tabId, other.tabId, otherCheckId]);
    expect(byDish(notices)).toEqual([
      ["FLAN", ana.tabId, "Mesa 4, 7"],
      ["TARTA", otherCheckId, "Mesa 4, 7"],
    ]);
  });
});
