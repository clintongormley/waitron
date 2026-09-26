import { randomUUID } from "node:crypto";
import net from "node:net";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  diningTables,
  locations,
  printJobs,
  ticketItems,
  tills,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createExtraList,
  createProduct,
  readContentLanguages,
  writeProductModifiers,
} from "@waitron/catalogue";
import type { ExtraSelection, OptionSelection } from "@waitron/shared";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter, deactivatePrinter, updatePrinter } from "@waitron/printing";
import type { PrintConfig } from "@waitron/printing";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  thousandthsToDecimal,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createCourse, createStation, setProductCourse, setProductStation } from "./kitchen.js";
import {
  addTabRound,
  createOpenOrder,
  fireCourse,
  fireLines,
  openTab,
  voidTabLine,
} from "./working-order.js";
import { listStationNotices } from "@waitron/venue-service";
import { attachPrinterToStation } from "./station-printers.js";
import {
  enqueueCorrectionSlips,
  enqueueKitchenTickets,
  reprintOrderTickets,
} from "./kitchen-print.js";
import { decodeTicket, printedLines } from "./testing/decode-ticket.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";

// Pins print-on-fire's order-scope dedupe, round independence and never-block (no socket opened).
// `station_printers`' keys are pinned in packages/db's station-printers.test.ts and the outbox shape in
// packages/printing's outbox.test.ts. `node:sqlite` opens no socket of its own, so a spy on
// `Socket.prototype.connect` sees only what the fire does.
const LOCALE = "es-ES";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});
afterEach(() => {
  vi.restoreAllMocks();
});

interface Venue {
  cfg: TillConfig;
  catalogueId: string;
}

/** A fresh location, till, node and assigned catalogue, returning the till's config. */
async function setupVenue(): Promise<Venue> {
  await seedTenant(db);
  await seedLegacySellingUnits(db);
  // Inserted through the table definitions, not as raw SQL: the ids and `created_at` come from
  // `$defaultFn` generators, which a raw insert never reaches.
  const [loc] = await db
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: [LOCALE],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const locationId = loc!.id;
  const [till] = await db
    .insert(tills)
    .values({ locationId, name: "Caja 1" })
    .returning({ id: tills.id });
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const catalogueId = await withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Carta" });
    await assignCatalogueToLocation(tx, locationId, cat.id);
    return cat.id;
  });
  const cfg: TillConfig = {
    tillId: brandTillId(till!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  return { cfg, catalogueId };
}

/** The location scope the printing verbs run under. */
function printCfg(cfg: TillConfig): PrintConfig {
  return { locationId: cfg.locationId };
}

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

/** Read the print-job outbox. This cannot tell `binary`'s read mapping from the driver's; the mapping
 *  is pinned in packages/db/src/schema/columns.test.ts ("binary binds a Uint8Array…"). */
async function printJobsFor(
  tx: Transaction,
): Promise<{ id: string; printerId: string; status: string; payload: Uint8Array }[]> {
  return tx
    .select({
      id: printJobs.id,
      printerId: printJobs.printerId,
      status: printJobs.status,
      payload: printJobs.payload,
    })
    .from(printJobs);
}

/** A basket line for a product at quantity 1. */
const line = (productId: string) => ({ productId, quantity: "1" });

/** Create a sellable product, optionally routed to a station and/or a course. */
async function makeProduct(
  tx: Transaction,
  cfg: TillConfig,
  catalogueId: string,
  name: string,
  route: { stationId?: string; courseId?: string } = {},
): Promise<string> {
  const { id } = await createProduct(tx, {
    catalogueId,
    categoryId: null,
    name: name,
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "general",
  });
  if (route.stationId !== undefined) await setProductStation(tx, cfg, id, route.stationId);
  if (route.courseId !== undefined) await setProductCourse(tx, cfg, id, route.courseId);
  return id;
}

/** Create a live printer. `scope: "order"` makes it a group printer (the consolidated-ticket target). */
async function makePrinter(
  tx: Transaction,
  cfg: TillConfig,
  name: string,
  scope: "station" | "order",
): Promise<string> {
  const { id } = await createPrinter(tx, printCfg(cfg), {
    name,
    transport: "cloud_poll",
    pollId: `poll-${randomUUID()}`,
  });
  if (scope === "order") await updatePrinter(tx, printCfg(cfg), id, { ticketScope: "order" });
  return id;
}

type ProductLine = {
  productId: string;
  quantity: string;
  extras?: ExtraSelection[];
  options?: OptionSelection[];
  note?: string;
};

/** Open a working order in the counter zone, selling each line through the zone's offer for its
 *  product. Call once the suite's products, stations and extras are final: the offers' routes mirror
 *  the product/category/default station each product would have taken. */
async function createOfferedOrder(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  lines: ProductLine[],
): ReturnType<typeof createOpenOrder> {
  const offers = await offerProducts(tx, cfg);
  return createOpenOrder(tx, cfg, id, offers.toOfferLines(lines), null, {
    zoneId: offers.zoneId,
  });
}

/** Open a working order carrying `lines` and fire it, returning the order id. Passes every persisted
 *  line, children included, to `fireLines`, so the parent-only filter under test is `fireLines`' own. */
async function fireNewOrder(
  tx: Transaction,
  cfg: TillConfig,
  lines: ProductLine[],
): Promise<string> {
  const id = randomUUID();
  await createOfferedOrder(tx, cfg, id, lines);
  const fired = await tx
    .select({
      id: workingOrderLines.id,
      productId: workingOrderLines.productId,
      courseId: workingOrderLines.courseId,
      parentLineId: workingOrderLines.parentLineId,
      note: workingOrderLines.note,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id))
    .orderBy(workingOrderLines.lineNo);
  await fireLines(tx, cfg, id, fired);
  return id;
}

/**
 * Open an order with NO service context holding one dish line and one child line per pick, then FIRE
 * it, so the dish takes `fireLines`' context-less station chain (product, then category, then the
 * default station) rather than a preparation route. The lines are written straight to the table
 * because pricing one needs a zone; the price and name columns are placeholders nothing here reads.
 */
async function fireContextlessDish(
  tx: Transaction,
  cfg: TillConfig,
  dishId: string,
  pickIds: string[],
): Promise<string> {
  const id = randomUUID();
  await createOpenOrder(tx, cfg, id, [], null);
  const placeholder = {
    workingOrderId: id,
    name: "Line",
    descriptions: { [LOCALE]: "Line" },
    quantity: 1000,
    unitPrice: 124,
    unitPriceGross: 150,
    vatRate: 2100,
    lineTotal: 150,
  };
  const [parent] = await tx
    .insert(workingOrderLines)
    .values({ ...placeholder, lineNo: 1, productId: dishId })
    .returning({ id: workingOrderLines.id });
  await tx.insert(workingOrderLines).values(
    pickIds.map((productId, index) => ({
      ...placeholder,
      lineNo: index + 2,
      productId,
      parentLineId: parent!.id,
    })),
  );
  const fired = await tx
    .select({
      id: workingOrderLines.id,
      productId: workingOrderLines.productId,
      courseId: workingOrderLines.courseId,
      parentLineId: workingOrderLines.parentLineId,
      note: workingOrderLines.note,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id))
    .orderBy(workingOrderLines.lineNo);
  await fireLines(tx, cfg, id, fired);
  return id;
}

/** Offer one optional, uncapped extras list on `dishId`, returning the list id and the offered
 *  products' ids in order. None of these products is routed to a station: a child line never resolves
 *  one. */
async function addExtras(
  tx: Transaction,
  cfg: TillConfig,
  catalogueId: string,
  dishId: string,
  items: { name: string; customerName?: string; kitchenName?: string; maxQuantity?: number }[],
): Promise<{ listId: string; productIds: string[] }> {
  const { defaultLanguage } = await readContentLanguages(tx, cfg.locale);
  const productIds: string[] = [];
  for (const item of items) {
    const { id } = await createProduct(tx, {
      catalogueId,
      categoryId: null,
      name: item.name,
      ...(item.customerName === undefined
        ? {}
        : { customerName: { [defaultLanguage]: item.customerName } }),
      ...(item.kitchenName === undefined ? {} : { kitchenName: item.kitchenName }),
      pricingUnit: "each",
      unitPrice: "0.50",
      vatClass: "reduced",
    });
    productIds.push(id);
  }
  const list = await createExtraList(
    tx,
    {
      name: "Extras",
      customerName: null,
      kitchenName: null,
      minPicks: 0,
      maxPicks: null,
      active: true,
      items: productIds.map((productId, index) => ({
        productId,
        maxQuantity: items[index]!.maxQuantity ?? 1,
        preselected: false,
        price: null,
      })),
    },
    cfg.locale,
  );
  await writeProductModifiers(tx, dishId, [{ kind: "extras", id: list.id }]);
  return { listId: list.id, productIds };
}

/** Every outbound TCP open goes through `Socket.prototype.connect`. */
function spyOnNoSocketOpened() {
  return vi.spyOn(
    net.Socket.prototype as unknown as { connect: (...args: unknown[]) => unknown },
    "connect",
  );
}

describe("print-on-fire (enqueueKitchenTickets wired into fireLines / fireCourse)", () => {
  it("prints a per-station ticket and ONE consolidated ticket for a group printer (the R-D dedupe)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { pCocina, pGroup, jobs } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const barra = await createStation(tx, cfg, { name: "Barra" });
      const pCocina = await makePrinter(tx, cfg, "Cocina printer", "station");
      const pGroup = await makePrinter(tx, cfg, "Pase", "order");
      // Station printer on Cocina; group printer on BOTH Cocina and Barra.
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId: pCocina });
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId: pGroup });
      await attachPrinterToStation(tx, { stationId: barra.id, printerId: pGroup });
      const steak = await makeProduct(tx, cfg, catalogueId, "Chuleton", { stationId: cocina.id });
      const beer = await makeProduct(tx, cfg, catalogueId, "Cerveza", { stationId: barra.id });

      await fireNewOrder(tx, cfg, [line(steak), line(beer)]);
      return { pCocina, pGroup, jobs: await printJobsFor(tx) };
    });

    const cocinaJobs = jobs.filter((j) => j.printerId === pCocina);
    const groupJobs = jobs.filter((j) => j.printerId === pGroup);
    expect(cocinaJobs).toHaveLength(1); // the station ticket
    expect(groupJobs).toHaveLength(1); // ONE consolidated ticket, NOT two (deduped across both stations)

    // The Cocina station ticket carries its own item and NOT Barra's.
    const cocinaTicket = decodeTicket(cocinaJobs[0]!.payload);
    expect(cocinaTicket).toContain("Chuleton");
    expect(cocinaTicket).not.toContain("Cerveza");

    // The consolidated group ticket carries BOTH items, each under its station sub-header.
    const groupTicket = decodeTicket(groupJobs[0]!.payload);
    expect(groupTicket).toContain("Chuleton");
    expect(groupTicket).toContain("Cerveza");
    expect(groupTicket).toContain("Cocina");
    expect(groupTicket).toContain("Barra");
  });

  it("never opens a socket on fire, queues its jobs, and enqueues nothing to an inactive printer", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const connectSpy = spyOnNoSocketOpened();
    const { pActive, pDead, jobs } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const barra = await createStation(tx, cfg, { name: "Barra" });
      const pActive = await makePrinter(tx, cfg, "Cocina printer", "station");
      const pDead = await makePrinter(tx, cfg, "Barra printer", "station");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId: pActive });
      await attachPrinterToStation(tx, { stationId: barra.id, printerId: pDead });
      // Deactivated after attaching (attach requires a live printer): `enqueuePrintJob` would throw
      // `printer.not_found` for it, so it must never be handed this id.
      await deactivatePrinter(tx, printCfg(cfg), pDead);
      const steak = await makeProduct(tx, cfg, catalogueId, "Chuleton", { stationId: cocina.id });
      const beer = await makeProduct(tx, cfg, catalogueId, "Cerveza", { stationId: barra.id });

      await fireNewOrder(tx, cfg, [line(steak), line(beer)]);
      return { pActive, pDead, jobs: await printJobsFor(tx) };
    });

    expect(connectSpy).not.toHaveBeenCalled();

    const activeJobs = jobs.filter((j) => j.printerId === pActive);
    expect(activeJobs).toHaveLength(1);
    expect(activeJobs[0]!.status).toBe("queued");
    expect(jobs.filter((j) => j.printerId === pDead)).toHaveLength(0);
  });

  it("a second fire (fireCourse) prints only round-2 items and never reprints round 1 (R-D)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { printerId, afterRound1, afterRound2, afterRefire } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer", "station");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const soup = await makeProduct(tx, cfg, catalogueId, "Sopa", {
        stationId: cocina.id,
        courseId: ent.id,
      });
      const steak = await makeProduct(tx, cfg, catalogueId, "Chuleton", {
        stationId: cocina.id,
        courseId: pri.id,
      });

      // Round 1: firing auto-fires the earliest course (Entrantes) and HOLDS the later one (steak).
      const orderId = await fireNewOrder(tx, cfg, [line(soup), line(steak)]);
      const afterRound1 = await printJobsFor(tx);
      // Round 2: fireCourse releases the held course.
      await fireCourse(tx, cfg, orderId, pri.id);
      const afterRound2 = await printJobsFor(tx);
      // Re-firing the already-fired course matches zero rows.
      await fireCourse(tx, cfg, orderId, pri.id);
      const afterRefire = await printJobsFor(tx);
      return { printerId, afterRound1, afterRound2, afterRefire };
    });

    const jobsFor = (rows: { printerId: string }[]) =>
      rows.filter((j) => j.printerId === printerId);

    // Round 1: one ticket, the soup only — the steak is held, so it is NOT printed yet.
    expect(jobsFor(afterRound1)).toHaveLength(1);
    const round1Ticket = decodeTicket(afterRound1[0]!.payload);
    expect(round1Ticket).toContain("Sopa");
    expect(round1Ticket).not.toContain("Chuleton");

    // Round 2: the new job carries the steak only; round 1's soup is not reprinted.
    expect(jobsFor(afterRound2)).toHaveLength(2);
    const round1Ids = new Set(afterRound1.map((j) => j.id));
    const round2New = afterRound2.filter((j) => !round1Ids.has(j.id));
    expect(round2New).toHaveLength(1);
    expect(decodeTicket(round2New[0]!.payload)).toContain("Chuleton");
    expect(decodeTicket(round2New[0]!.payload)).not.toContain("Sopa");

    expect(jobsFor(afterRefire)).toHaveLength(2);
  });

  it("stamps the dining-table label and falls back to the venue language when the till locale is absent", async () => {
    const { cfg, catalogueId } = await setupVenue();
    // A till whose UI locale is NOT among the venue's invoice locales — name resolution must fall back to
    // the venue-language description rather than a blank line.
    const foreignCfg: TillConfig = { ...cfg, locale: "de-DE" };
    const { printerId, jobs } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer", "station");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      const drink = await makeProduct(tx, cfg, catalogueId, "Cafe con leche", {
        stationId: cocina.id,
      });
      // A tab bound to a dining table → the order carries the table label the ticket header prints.
      const offers = await offerProducts(tx, cfg, { zone: "tables" });
      const [table] = await tx
        .insert(diningTables)
        .values({ locationId: cfg.locationId, label: "Mesa 5", zoneId: offers.zoneId })
        .returning({ id: diningTables.id });
      const { tabId } = await openTab(tx, cfg, { tableId: table!.id });
      await addTabRound(tx, foreignCfg, tabId, offers.toOfferLines([line(drink)]));
      return { printerId, jobs: await printJobsFor(tx) };
    });

    const stationJobs = jobs.filter((j) => j.printerId === printerId);
    expect(stationJobs).toHaveLength(1);
    const ticket = decodeTicket(stationJobs[0]!.payload);
    expect(ticket).toContain("Mesa 5"); // the dining-table label on the header
    expect(ticket).toContain("Cafe con leche"); // venue-language fallback (de-DE absent → the es-ES value)
  });

  it("enqueues no print jobs when the fire transaction rolls back (same-tx atomicity)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const setup = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer", "station");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      const steak = await makeProduct(tx, cfg, catalogueId, "Chuleton", { stationId: cocina.id });
      return { printerId, steak };
    });

    // The fire's ticket items and its enqueued jobs roll back together.
    await expect(
      asApp(cfg, async (tx) => {
        await fireNewOrder(tx, cfg, [line(setup.steak)]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const jobs = await asApp(cfg, (tx) => printJobsFor(tx));
    expect(jobs).toHaveLength(0);
  });

  it("resolves the table label via the counter-delivery delivery_table_id direction", async () => {
    // The seated-tab direction of the table label is tested above; this pins the counter-delivery one.
    const { cfg, catalogueId } = await setupVenue();
    const { printerId, jobs } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer", "station");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      const drink = await makeProduct(tx, cfg, catalogueId, "Zumo", { stationId: cocina.id });
      const orderId = randomUUID();
      await createOfferedOrder(tx, cfg, orderId, [line(drink)]);
      const [table] = await tx
        .insert(diningTables)
        .values({ locationId: cfg.locationId, label: "Barra 3" })
        .returning({ id: diningTables.id });
      await tx.execute(sql`
        update working_orders set delivery_table_id = ${table!.id} where id = ${orderId}`);
      const [lineRow] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      await enqueueKitchenTickets(tx, cfg, orderId, [
        { workingOrderLineId: lineRow!.id, stationId: cocina.id },
      ]);
      return { printerId, jobs: await printJobsFor(tx) };
    });

    const stationJobs = jobs.filter((j) => j.printerId === printerId);
    expect(stationJobs).toHaveLength(1);
    expect(decodeTicket(stationJobs[0]!.payload)).toContain("Barra 3");
  });

  it("returns early after the single mapping read when the involved stations have NO attached printer", async () => {
    // Zero jobs would hold whether or not the detail reads ran, so the select count is what pins the
    // early return.
    const { cfg, catalogueId } = await setupVenue();
    const { selectCalls, jobs } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const dish = await makeProduct(tx, cfg, catalogueId, "Tortilla", { stationId: cocina.id });
      const orderId = randomUUID();
      await createOfferedOrder(tx, cfg, orderId, [line(dish)]);
      const [lineRow] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      const selectSpy = vi.spyOn(tx, "select");
      await enqueueKitchenTickets(tx, cfg, orderId, [
        { workingOrderLineId: lineRow!.id, stationId: cocina.id },
      ]);
      const selectCalls = selectSpy.mock.calls.length;
      selectSpy.mockRestore();
      return { selectCalls, jobs: await printJobsFor(tx) };
    });

    expect(jobs).toHaveLength(0);
    expect(selectCalls).toBe(1);
  });

  it("builds one kitchen ticket per distinct paper width and character set among the printers", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const ids = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const wide = await makePrinter(tx, cfg, "Cocina 80 A", "station");
      const wideTwin = await makePrinter(tx, cfg, "Cocina 80 B", "station");
      const narrow = await makePrinter(tx, cfg, "Cocina 58", "station");
      await updatePrinter(tx, printCfg(cfg), narrow, { paperWidth: "58mm" });
      const pass = await makePrinter(tx, cfg, "Pase 1252", "order");
      const passPc858 = await makePrinter(tx, cfg, "Pase 858", "order");
      await updatePrinter(tx, printCfg(cfg), passPc858, {
        characterSet: "pc858",
        characterTable: 19,
      });
      for (const printerId of [wide, wideTwin, narrow, pass, passPc858]) {
        await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      }
      const steak = await makeProduct(
        tx,
        cfg,
        catalogueId,
        "Chuletón de buey madurado a la brasa",
        {
          stationId: cocina.id,
        },
      );
      await fireNewOrder(tx, cfg, [line(steak)]);
      return { wide, wideTwin, narrow, pass, passPc858, jobs: await printJobsFor(tx) };
    });
    const payloadOf = (printerId: string): Buffer => {
      const own = ids.jobs.filter((job) => job.printerId === printerId);
      expect(own).toHaveLength(1);
      // The payload arrives as a Uint8Array; wrap it so `.equals` (a Node Buffer method) works.
      return Buffer.from(own[0]!.payload);
    };
    expect(payloadOf(ids.wideTwin).equals(payloadOf(ids.wide))).toBe(true);
    expect(payloadOf(ids.narrow).equals(payloadOf(ids.wide))).toBe(false);
    for (const printed of printedLines(new Uint8Array(payloadOf(ids.narrow)))) {
      expect(printed.length, printed).toBeLessThanOrEqual(30);
    }
    // The 80mm ticket lays out to 42 columns; the qty+unit prefix wraps the name at both widths, so
    // the whole name is checked across the rejoined continuations.
    const wideLines = printedLines(new Uint8Array(payloadOf(ids.wide)));
    for (const printed of wideLines) expect(printed.length, printed).toBeLessThanOrEqual(42);
    expect(wideLines.some((printed) => printed.length > 30)).toBe(true);
    expect(wideLines.map((l) => l.trimStart()).join(" ")).toContain(
      "Chuletón de buey madurado a la brasa",
    );
    expect(payloadOf(ids.passPc858).equals(payloadOf(ids.pass))).toBe(false);
    expect([...payloadOf(ids.passPc858).subarray(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
  });

  it("builds a correction slip once per distinct layout among the line's printers", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const result = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const wide = await makePrinter(tx, cfg, "Cocina 80", "station");
      const narrow = await makePrinter(tx, cfg, "Cocina 58", "order");
      await updatePrinter(tx, printCfg(cfg), narrow, { paperWidth: "58mm" });
      for (const printerId of [wide, narrow]) {
        await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      }
      const steak = await makeProduct(
        tx,
        cfg,
        catalogueId,
        "Chuletón de buey madurado a la brasa",
        {
          stationId: cocina.id,
        },
      );
      const orderId = await fireNewOrder(tx, cfg, [line(steak)]);
      const fired = await tx
        .select({
          workingOrderLineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
        })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      const before = new Set((await printJobsFor(tx)).map((job) => job.id));
      await enqueueCorrectionSlips(
        tx,
        cfg,
        orderId,
        fired.map((item) => ({ ...item, quantity: 1000, wasStarted: false })),
        "VOID",
      );
      const slips = (await printJobsFor(tx)).filter((job) => !before.has(job.id));
      return { wide, narrow, slips };
    });
    const slipFor = (printerId: string): Buffer => {
      const own = result.slips.filter((job) => job.printerId === printerId);
      expect(own).toHaveLength(1);
      // The payload arrives as a Uint8Array; wrap it so `.equals` (a Node Buffer method) works.
      return Buffer.from(own[0]!.payload);
    };
    expect(slipFor(result.narrow).equals(slipFor(result.wide))).toBe(false);
    for (const printed of printedLines(new Uint8Array(slipFor(result.narrow)))) {
      expect(printed.length, printed).toBeLessThanOrEqual(30);
    }
  });
});

describe("correction slips for a station with no printer", () => {
  it("sends a correction slip only for the lines whose station has an active printer", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { printerId, slips } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const barra = await createStation(tx, cfg, { name: "Barra", isDefault: false });
      const printerId = await makePrinter(tx, cfg, "Cocina printer", "station");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      const steak = await makeProduct(tx, cfg, catalogueId, "Chuleton", { stationId: cocina.id });
      const beer = await makeProduct(tx, cfg, catalogueId, "Cerveza", { stationId: barra.id });
      const orderId = await fireNewOrder(tx, cfg, [line(steak), line(beer)]);
      const fired = await tx
        .select({
          workingOrderLineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
        })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      expect(fired).toHaveLength(2);
      const before = new Set((await printJobsFor(tx)).map((job) => job.id));
      await enqueueCorrectionSlips(
        tx,
        cfg,
        orderId,
        fired.map((item) => ({ ...item, quantity: 1000, wasStarted: false })),
        "VOID",
      );
      const slips = (await printJobsFor(tx)).filter((job) => !before.has(job.id));
      return { printerId, slips };
    });

    expect(slips.map((slip) => slip.printerId)).toEqual([printerId]);
    const slip = decodeTicket(slips[0]!.payload);
    expect(slip).toContain("Chuleton");
    expect(slip).not.toContain("Cerveza");
  });
});

describe("every correction reaches the station as a notice, printer or not", () => {
  it("records the notice at a station with no printer, and enqueues no print job", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { stationId, notices, jobs } = await asApp(cfg, async (tx) => {
      const barra = await createStation(tx, cfg, { name: "Barra", isDefault: true });
      const beer = await makeProduct(tx, cfg, catalogueId, "Cerveza", { stationId: barra.id });
      const orderId = await fireNewOrder(tx, cfg, [line(beer)]);
      const [fired] = await tx
        .select({
          workingOrderLineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
        })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      await enqueueCorrectionSlips(
        tx,
        cfg,
        orderId,
        [{ ...fired!, stationId: fired!.stationId!, quantity: 1000, wasStarted: true }],
        "VOID",
      );
      return {
        stationId: barra.id,
        notices: await listStationNotices(tx, cfg, barra.id),
        jobs: await printJobsFor(tx),
      };
    });

    expect(notices).toMatchObject([
      { stationId, kind: "void", lineName: "Cerveza", quantity: "1.000", wasStarted: true },
    ]);
    expect(jobs).toEqual([]);
  });

  it("records the notice and prints the slip where the station has a printer", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { printerId, notices, slips } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer", "station");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      const steak = await makeProduct(tx, cfg, catalogueId, "Chuleton", { stationId: cocina.id });
      const orderId = await fireNewOrder(tx, cfg, [line(steak)]);
      const [fired] = await tx
        .select({
          workingOrderLineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
        })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      const before = new Set((await printJobsFor(tx)).map((job) => job.id));
      await enqueueCorrectionSlips(
        tx,
        cfg,
        orderId,
        [{ ...fired!, stationId: fired!.stationId!, quantity: 1000, wasStarted: false }],
        "RECALLED",
      );
      return {
        printerId,
        notices: await listStationNotices(tx, cfg, cocina.id),
        slips: (await printJobsFor(tx)).filter((job) => !before.has(job.id)),
      };
    });

    expect(notices).toMatchObject([{ kind: "recalled", lineName: "Chuleton", wasStarted: false }]);
    expect(slips.map((slip) => slip.printerId)).toEqual([printerId]);
    expect(decodeTicket(slips[0]!.payload)).toContain("Chuleton");
  });

  it("a partial void's slip prints the quantity removed, not what is left", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const slips = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer", "station");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      const steak = await makeProduct(tx, cfg, catalogueId, "Chuleton", { stationId: cocina.id });
      const offers = await offerProducts(tx, cfg, { zone: "tables" });
      const [table] = await tx
        .insert(diningTables)
        .values({ locationId: cfg.locationId, label: "T1", zoneId: offers.zoneId })
        .returning({ id: diningTables.id });
      const { tabId } = await openTab(tx, cfg, { tableId: table!.id });
      await addTabRound(tx, cfg, tabId, [{ menuItemId: offers.offerFor(steak), quantity: "3" }]);
      const before = new Set((await printJobsFor(tx)).map((job) => job.id));
      await voidTabLine(tx, cfg, tabId, 1, "2");
      return (await printJobsFor(tx)).filter((job) => !before.has(job.id));
    });

    expect(slips).toHaveLength(1);
    const slip = decodeTicket(slips[0]!.payload);
    expect(slip).toContain(`${thousandthsToDecimal(2000)} ea x Chuleton`);
  });
});

describe("ordering modifiers on the kitchen ticket (parent-only ticket_items, child sub-text)", () => {
  it("fires a dish with two extras as ONE ticket_item (the parent), never one per child", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { orderId, parentLineId, ticketItemRows } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer", "station");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      // With a default station present, a child would otherwise route to it.
      const cortado = await makeProduct(tx, cfg, catalogueId, "Cortado", { stationId: cocina.id });
      const { listId, productIds } = await addExtras(tx, cfg, catalogueId, cortado, [
        { name: "Nata" },
        { name: "Leche avena" },
      ]);

      const orderId = await fireNewOrder(tx, cfg, [
        {
          productId: cortado,
          quantity: "1",
          extras: [{ listId, picks: productIds.map((productId) => ({ productId, quantity: 1 })) }],
        },
      ]);
      const lines = await tx
        .select({
          id: workingOrderLines.id,
          productId: workingOrderLines.productId,
          parentLineId: workingOrderLines.parentLineId,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId))
        .orderBy(workingOrderLines.lineNo);
      expect(lines).toHaveLength(3);
      const parent = lines.find((l) => l.parentLineId === null)!;
      const ticketItemRows = await tx
        .select({ workingOrderLineId: ticketItems.workingOrderLineId })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      return { orderId, parentLineId: parent.id, ticketItemRows };
    });

    expect(ticketItemRows).toEqual([{ workingOrderLineId: parentLineId }]);
    expect(orderId).toBeTruthy();
  });

  it("renders the dish then its two extras as indented '+' sub-text on the kitchen ticket", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { printerId, jobs } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer", "station");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      const cortado = await makeProduct(tx, cfg, catalogueId, "Cortado", { stationId: cocina.id });
      // Each extra carries three DIFFERENT names, so a sub-line that read the customer-facing text
      // instead of the staff name the child line froze reads differently (CLAUDE.md §3).
      const { listId, productIds } = await addExtras(tx, cfg, catalogueId, cortado, [
        { name: "Nata", customerName: "Nata montada", kitchenName: "NAT" },
        { name: "Leche avena", customerName: "Bebida de avena", kitchenName: "AVE" },
      ]);

      await fireNewOrder(tx, cfg, [
        {
          productId: cortado,
          quantity: "1",
          extras: [{ listId, picks: productIds.map((productId) => ({ productId, quantity: 1 })) }],
        },
      ]);
      return { printerId, jobs: await printJobsFor(tx) };
    });

    const stationJobs = jobs.filter((j) => j.printerId === printerId);
    expect(stationJobs).toHaveLength(1);
    const ticket = decodeTicket(stationJobs[0]!.payload);
    expect(ticket).toContain("Cortado");
    expect(ticket).toContain("+ Nata");
    expect(ticket).toContain("+ Leche avena");
    // A cook reads the staff name, never the diner's wording.
    expect(ticket).not.toContain("Nata montada");
    expect(ticket).not.toContain("Bebida de avena");
    expect(ticket.indexOf("Cortado")).toBeLessThan(ticket.indexOf("+ Nata"));
    expect(ticket.indexOf("Cortado")).toBeLessThan(ticket.indexOf("+ Leche avena"));
  });

  it("prints the line's note as a sub-line on the kitchen ticket (order-line customisation)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { printerId, jobs } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer", "station");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      const chuleton = await makeProduct(tx, cfg, catalogueId, "Chuleton", {
        stationId: cocina.id,
      });

      await fireNewOrder(tx, cfg, [{ productId: chuleton, quantity: "1", note: "sin sal" }]);
      return { printerId, jobs: await printJobsFor(tx) };
    });

    const ticket = decodeTicket(jobs.filter((j) => j.printerId === printerId)[0]!.payload);
    expect(ticket).toContain("Chuleton");
    expect(ticket).toContain("* sin sal");
    expect(ticket.indexOf("Chuleton")).toBeLessThan(ticket.indexOf("* sin sal"));
  });

  it("badges an extra's PER-DISH count when it exceeds one, leaving a single pick's line unchanged", async () => {
    // A child line stores the combined quantity (dish × pick); the ticket shows the per-dish count as
    // an ASCII "xN" suffix only when it exceeds 1.
    const { cfg, catalogueId } = await setupVenue();
    const { printerId, jobs } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer", "station");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      const cortado = await makeProduct(tx, cfg, catalogueId, "Cortado", { stationId: cocina.id });
      const { listId, productIds } = await addExtras(tx, cfg, catalogueId, cortado, [
        { name: "Nata", maxQuantity: 3 }, // a per-dish cap of 3 admits a ×2
        { name: "Leche avena" }, // single pick (cap 1)
      ]);
      const [nata, avena] = productIds;

      await fireNewOrder(tx, cfg, [
        {
          productId: cortado,
          quantity: "1",
          extras: [
            {
              listId,
              picks: [
                { productId: nata!, quantity: 2 },
                { productId: avena!, quantity: 1 },
              ],
            },
          ],
        },
      ]);
      return { printerId, jobs: await printJobsFor(tx) };
    });

    const stationJobs = jobs.filter((j) => j.printerId === printerId);
    expect(stationJobs).toHaveLength(1);
    const ticket = decodeTicket(stationJobs[0]!.payload);
    expect(ticket).toContain("Cortado");
    expect(ticket).toContain("+ Nata x2");
    expect(ticket).toContain("+ Leche avena");
    expect(ticket).not.toContain("Leche avena x");
    expect(ticket).not.toMatch(/\+ Nata(?! x)/u);
  });

  it("never station-resolves a child line: a dish-with-extras fires with NO default station", async () => {
    // The child's product routes nowhere and there is no default station, so a child resolved on its
    // own would fail with `station.no_default`.
    const { cfg, catalogueId } = await setupVenue();
    const { stationId, ticketItemRows } = await asApp(cfg, async (tx) => {
      const barra = await createStation(tx, cfg, { name: "Barra", isDefault: false });
      const cafe = await makeProduct(tx, cfg, catalogueId, "Cafe", { stationId: barra.id });
      const { productIds } = await addExtras(tx, cfg, catalogueId, cafe, [{ name: "Nata" }]);

      const orderId = await fireContextlessDish(tx, cfg, cafe, [productIds[0]!]);
      const ticketItemRows = await tx
        .select({
          workingOrderLineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
        })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      return { stationId: barra.id, ticketItemRows };
    });

    expect(ticketItemRows).toHaveLength(1);
    expect(ticketItemRows[0]!.stationId).toBe(stationId);
  });
});

describe("reprintOrderTickets (re-enqueue the WHOLE current ticket for an order)", () => {
  it("re-enqueues EVERY currently-fired item across all fire rounds — not just the last round (the print-on-fire contrast)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { pStation, pGroup, beforeReprint, afterReprint } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const pStation = await makePrinter(tx, cfg, "Cocina printer", "station");
      const pGroup = await makePrinter(tx, cfg, "Pase", "order");
      await attachPrinterToStation(tx, {
        stationId: cocina.id,
        printerId: pStation,
      });
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId: pGroup });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const soup = await makeProduct(tx, cfg, catalogueId, "Sopa", {
        stationId: cocina.id,
        courseId: ent.id,
      });
      const steak = await makeProduct(tx, cfg, catalogueId, "Chuleton", {
        stationId: cocina.id,
        courseId: pri.id,
      });

      // Two rounds: round 1 fires the soup and holds the steak, round 2 releases the steak.
      const orderId = await fireNewOrder(tx, cfg, [line(soup), line(steak)]);
      await fireCourse(tx, cfg, orderId, pri.id);
      const beforeReprint = await printJobsFor(tx);

      await reprintOrderTickets(tx, cfg, orderId);
      const afterReprint = await printJobsFor(tx);
      return { pStation, pGroup, beforeReprint, afterReprint };
    });

    const beforeIds = new Set(beforeReprint.map((j) => j.id));
    const newJobs = afterReprint.filter((j) => !beforeIds.has(j.id));

    // One station ticket and one consolidated group ticket.
    const newStation = newJobs.filter((j) => j.printerId === pStation);
    const newGroup = newJobs.filter((j) => j.printerId === pGroup);
    expect(newStation).toHaveLength(1);
    expect(newGroup).toHaveLength(1);
    expect(newJobs).toHaveLength(2);

    // Both rounds' items, where round 2's print-on-fire ticket carried only Chuleton.
    const stationTicket = decodeTicket(newStation[0]!.payload);
    expect(stationTicket).toContain("Sopa");
    expect(stationTicket).toContain("Chuleton");

    const groupTicket = decodeTicket(newGroup[0]!.payload);
    expect(groupTicket).toContain("Sopa");
    expect(groupTicket).toContain("Chuleton");
    expect(groupTicket).toContain("Cocina");
  });

  it("prints the quantity each item was fired at, not its line's current quantity", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { released, reprinted } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer", "station");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const soup = await makeProduct(tx, cfg, catalogueId, "Sopa", {
        stationId: cocina.id,
        courseId: ent.id,
      });
      const steak = await makeProduct(tx, cfg, catalogueId, "Chuleton", {
        stationId: cocina.id,
        courseId: pri.id,
      });
      // Three soups fire; two steaks are held by their course.
      const orderId = await fireNewOrder(tx, cfg, [
        { productId: soup, quantity: "3" },
        { productId: steak, quantity: "2" },
      ]);
      // Each line now bills one, as after splitting the rest off to another check.
      await tx.execute(sql`
        update working_order_lines set quantity = 1000 where working_order_id = ${orderId}`);
      const beforeRelease = new Set((await printJobsFor(tx)).map((job) => job.id));
      await fireCourse(tx, cfg, orderId, pri.id);
      const released = (await printJobsFor(tx)).filter((job) => !beforeRelease.has(job.id));
      const beforeReprint = new Set((await printJobsFor(tx)).map((job) => job.id));
      await reprintOrderTickets(tx, cfg, orderId);
      const reprinted = (await printJobsFor(tx)).filter((job) => !beforeReprint.has(job.id));
      return { released, reprinted };
    });

    expect(released).toHaveLength(1);
    expect(decodeTicket(released[0]!.payload)).toContain(
      `${thousandthsToDecimal(2000)} ea x Chuleton`,
    );
    expect(reprinted).toHaveLength(1);
    const reprint = decodeTicket(reprinted[0]!.payload);
    expect(reprint).toContain(`${thousandthsToDecimal(3000)} ea x Sopa`);
    expect(reprint).toContain(`${thousandthsToDecimal(2000)} ea x Chuleton`);
  });

  it("enqueues nothing (and does NOT throw) for an order with no fired items", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const jobs = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer", "station");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      await makeProduct(tx, cfg, catalogueId, "Chuleton", { stationId: cocina.id });

      await reprintOrderTickets(tx, cfg, randomUUID());
      return printJobsFor(tx);
    });
    expect(jobs).toHaveLength(0);
  });
});

afterEach(async () => {
  await suite.db.execute(sql`delete from print_jobs`);
});

it("prints a line's stored options answers, each side taking its KITCHEN name", async () => {
  const { cfg, catalogueId } = await setupVenue();
  const jobs = await asApp(cfg, async (tx) => {
    const station = await createStation(tx, cfg, { name: "Kitchen", isDefault: true });
    const printerId = await makePrinter(tx, cfg, "Kitchen printer", "station");
    await attachPrinterToStation(tx, { stationId: station.id, printerId });
    const productId = await makeProduct(tx, cfg, catalogueId, "Coffee", { stationId: station.id });
    const orderId = randomUUID();
    const { lineRows } = await createOfferedOrder(tx, cfg, orderId, [line(productId)]);
    const parent = lineRows[0]!;
    // A frozen answer's two staff names are keyed by CONTENT language, which is what the order path
    // widens them under (`buildLineExtras`, modifier-selection.ts).
    const { defaultLanguage } = await readContentLanguages(tx, cfg.locale);
    await tx
      .update(workingOrderLines)
      .set({
        optionSnapshots: [
          // Six names, six different texts: the ticket can only print the kitchen pair.
          {
            listName: { [defaultLanguage]: "Leche staff" },
            listCustomerName: { [defaultLanguage]: "Leche cliente" },
            listKitchenName: "LECHE",
            labelName: { [defaultLanguage]: "Avena staff" },
            labelCustomerName: { [defaultLanguage]: "Avena cliente" },
            labelKitchenName: "AVENA",
          },
          // Neither side has a kitchen name: a cook reads the STAFF name, never the diner's wording.
          {
            listName: { [defaultLanguage]: "Azucar" },
            listCustomerName: { [defaultLanguage]: "Azucar cliente" },
            listKitchenName: null,
            labelName: { [defaultLanguage]: "Sin" },
            labelCustomerName: { [defaultLanguage]: "Sin cliente" },
            labelKitchenName: null,
          },
        ],
      })
      .where(eq(workingOrderLines.id, parent.id!));
    await enqueueKitchenTickets(tx, cfg, orderId, [
      { workingOrderLineId: parent.id!, stationId: station.id },
    ]);
    return printJobsFor(tx);
  });
  expect(jobs).toHaveLength(1);
  const paper = decodeTicket(jobs[0]!.payload);
  expect(paper).toContain("+ LECHE: AVENA");
  expect(paper).not.toContain("Leche staff");
  expect(paper).toContain("+ Azucar: Sin");
  expect(paper).not.toContain("cliente");
});

/**
 * Fire one line whose frozen kitchen/variant names are `frozen`, and return the printed ticket. The
 * staff name and the customer-facing text differ, so the ticket shows which one it fell back to.
 */
async function ticketWithNames(frozen: {
  kitchenName: string | null;
  variantName: string | null;
  variantKitchenName: string | null;
}): Promise<string> {
  const { cfg, catalogueId } = await setupVenue();
  const jobs = await asApp(cfg, async (tx) => {
    const station = await createStation(tx, cfg, { name: "Kitchen", isDefault: true });
    const printerId = await makePrinter(tx, cfg, "Kitchen printer", "station");
    await attachPrinterToStation(tx, { stationId: station.id, printerId });
    const { id: productId } = await createProduct(tx, {
      catalogueId,
      categoryId: null,
      name: "Coffee",
      customerName: { [LOCALE]: "Café recién hecho" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await setProductStation(tx, cfg, productId, station.id);
    const orderId = randomUUID();
    const { lineRows } = await createOfferedOrder(tx, cfg, orderId, [line(productId)]);
    const parent = lineRows[0]!;
    await tx.update(workingOrderLines).set(frozen).where(eq(workingOrderLines.id, parent.id!));
    await enqueueKitchenTickets(tx, cfg, orderId, [
      { workingOrderLineId: parent.id!, stationId: station.id },
    ]);
    return printJobsFor(tx);
  });
  return decodeTicket(jobs[0]!.payload);
}

it("prints the selected variant's frozen kitchen name alone", async () => {
  const paper = await ticketWithNames({
    kitchenName: "COF",
    variantName: "Large",
    variantKitchenName: "LG",
  });
  expect(paper).toContain("LG");
  expect(paper).not.toContain("COF");
  expect(paper).not.toContain("Coffee");
});

it("falls back to the variant's staff name when it has no kitchen name", async () => {
  const paper = await ticketWithNames({
    kitchenName: "COF",
    variantName: "Large",
    variantKitchenName: null,
  });
  expect(paper).toContain("Large");
  expect(paper).not.toContain("COF");
});

it("falls back to the product's staff name when it has no kitchen name", async () => {
  const paper = await ticketWithNames({
    kitchenName: null,
    variantName: null,
    variantKitchenName: null,
  });
  expect(paper).toContain("Coffee");
  expect(paper).not.toContain("Café recién hecho");
});
