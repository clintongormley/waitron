import { randomUUID } from "node:crypto";
import net from "node:net";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { asAppUser, printJobs, ticketItems, withTransaction, workingOrderLines } from "@waitron/db";
import type { Database, Doneness, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
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
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createCourse, createStation, setProductCourse, setProductStation } from "./kitchen.js";
import { addTabRound, createOpenOrder, fireCourse, fireLines, openTab } from "./working-order.js";
import { attachPrinterToStation } from "./station-printers.js";
import {
  enqueueCorrectionSlips,
  enqueueKitchenTickets,
  reprintOrderTickets,
} from "./kitchen-print.js";
import { decodeTicket, printedLines } from "./testing/decode-ticket.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import "./errors.js";

// PGlite is the correct target: print-on-fire is a set of INSERT/SELECTs inside the caller's fire tx —
// no privilege or concurrency dimension (station_printers' PK and FKs are proven against real Postgres
// in Task 1's station-printers.test.ts, enqueuePrintJob's outbox shape in packages/printing's
// outbox.test.ts). The load-bearing invariants HERE are logical: the order-scope dedupe, round
// independence (ruling R-D), and never-block (no socket). PGlite is in-process WASM, so "no socket
// opened" is a clean structural proof, exactly as outbox.test.ts relies on.
const LOCALE = "es-ES";
const suite = usePgliteDb({
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

/** Stand up a fresh tenant + location + till + node and an assigned catalogue, returning the till's
 *  config (the brief's `testCfg`, built minimally per ruling R-C — no shared helper exists). Each test
 *  gets its OWN tenant, so its print jobs and order numbers are its own and the suite is
 *  order-independent (CLAUDE.md §4). Mirrors working-order.test.ts / station-printers.test.ts setup. */
async function setupVenue(): Promise<Venue> {
  await seedTenant(db);
  await seedLegacySellingUnits(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (name, invoice_locales, operation_description)
    values ('Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (location_id, name)
    values (${locationId}, 'Caja 1') returning id`);
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const catalogueId = await withTransaction(db, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Carta" });
    await assignCatalogueToLocation(tx, locationId, cat.id);
    return cat.id;
  });
  const cfg: TillConfig = {
    tillId: brandTillId(till.rows[0]!.id),
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

/** The tenant + location scope the printing verbs run under. */
function printCfg(cfg: TillConfig): PrintConfig {
  return { locationId: cfg.locationId };
}

/** Run `fn` on a transaction scoped to the venue's tenant as `app_user`, the shape every
 *  route uses. `nodeId` mirrors the fire path so `ticket_items.node_id` is set as production would. */
function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(db, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** Read the print-job outbox. `payload` is typed by the shared `binary` column, which declares a
 * Uint8Array; this suite runs on PGlite, whose own bytea parser returns one anyway, so the target
 * cannot tell the column's mapping from the driver's (measured in packages/db columns.test.ts). */
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

/** A basket line for a product at quantity 1 — the shape createOpenOrder/fireLines/addTabRound consume. */
const line = (productId: string) => ({ productId, quantity: "1" });

/** Create a sellable product (description in the venue's single locale so `check_locales` passes),
 *  optionally routed to a station and/or a course, and return its id. */
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

/** Create a live printer via the real printing verb — `cloud_poll` needs only a poll id (no agent to
 *  seed). `scope: "order"` makes it a GROUP printer (the consolidated-ticket target) via updatePrinter,
 *  since createPrinter always mints `ticket_scope = 'station'`. */
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

/** Open a fresh working order carrying `lines` and FIRE it — the isolated createOpenOrder → fireLines
 *  sequence placeOrder/sendToPrep run (the brief's order-firing helper). Passes ALL persisted lines
 *  (parent dishes AND child modifier lines) to `fireLines`, exactly as placeOrder/sendToPrep do — so
 *  the parent-only filter under test lives in `fireLines`, not at this caller. Returns the order id. */
async function fireNewOrder(
  tx: Transaction,
  cfg: TillConfig,
  lines: {
    productId: string;
    quantity: string;
    extras?: ExtraSelection[];
    options?: OptionSelection[];
    // Order-line customisation (spec §2/§3): a parent line MAY carry a note/doneness, snapshotted at fire.
    note?: string;
    doneness?: Doneness;
  }[],
): Promise<string> {
  const id = randomUUID();
  await createOpenOrder(tx, cfg, id, lines, null);
  const fired = await tx
    .select({
      id: workingOrderLines.id,
      productId: workingOrderLines.productId,
      courseId: workingOrderLines.courseId,
      parentLineId: workingOrderLines.parentLineId,
      note: workingOrderLines.note,
      doneness: workingOrderLines.doneness,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id))
    .orderBy(workingOrderLines.lineNo);
  await fireLines(tx, cfg, id, fired);
  return id;
}

/** Offer one OPTIONAL extras list (`minPicks` 0, uncapped) on `dishId`, one item per entry, and
 *  return the list id with the offered products' ids in the order offered — the shape a round line's
 *  `extras: [{ listId, picks }]` picks from. Each item is a product of its own, created here, so a
 *  pick becomes a CHILD line carrying that product. `maxQuantity` is the per-dish cap a pick's own
 *  quantity is checked against. None of these products is routed to a station: a child line never
 *  resolves one, which is the point of the parent-only rule. */
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

/** Spy the single chokepoint every outbound TCP open funnels through (outbox.test.ts's proof): if the
 *  fire opened a socket, `Socket.prototype.connect` would have been called. */
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
      // Deactivate AFTER attaching (attach requires the printer live). The mapping now points at an
      // inactive printer, which enqueueKitchenTickets filters out — so Barra fires but enqueues nothing,
      // and enqueuePrintJob (which would throw printer.not_found on an inactive id, aborting the fire tx)
      // is never handed it.
      await deactivatePrinter(tx, printCfg(cfg), pDead);
      const steak = await makeProduct(tx, cfg, catalogueId, "Chuleton", { stationId: cocina.id });
      const beer = await makeProduct(tx, cfg, catalogueId, "Cerveza", { stationId: barra.id });

      // The fire SUCCEEDS despite the dead-printer mapping (no throw escapes this block).
      await fireNewOrder(tx, cfg, [line(steak), line(beer)]);
      return { pActive, pDead, jobs: await printJobsFor(tx) };
    });

    expect(connectSpy).not.toHaveBeenCalled(); // never-block: no delivery/transport call on the fire

    const activeJobs = jobs.filter((j) => j.printerId === pActive);
    expect(activeJobs).toHaveLength(1);
    expect(activeJobs[0]!.status).toBe("queued"); // outbox INSERT only — the agent delivers later
    expect(jobs.filter((j) => j.printerId === pDead)).toHaveLength(0); // inactive → no job
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
      // Re-firing the already-fired course matches zero rows → enqueues nothing (empty-set short-circuit).
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

    // Round 2: a SECOND ticket appears; the NEW job carries the steak only — round 1's soup is never
    // reprinted (the capture-not-requery proof).
    expect(jobsFor(afterRound2)).toHaveLength(2);
    const round1Ids = new Set(afterRound1.map((j) => j.id));
    const round2New = afterRound2.filter((j) => !round1Ids.has(j.id));
    expect(round2New).toHaveLength(1);
    expect(decodeTicket(round2New[0]!.payload)).toContain("Chuleton");
    expect(decodeTicket(round2New[0]!.payload)).not.toContain("Sopa");

    // The re-fire enqueued nothing.
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
      const table = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (location_id, label)
        values (${cfg.locationId}, 'Mesa 5') returning id`);
      const { tabId } = await openTab(tx, cfg, { tableId: table.rows[0]!.id });
      // Fire the round with the FOREIGN-locale config so name resolution takes the fallback path.
      await addTabRound(tx, foreignCfg, tabId, [line(drink)]);
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

    // Fire inside a transaction that then throws — the fire's ticket items AND their enqueued jobs must
    // roll back together, because the enqueue lives in the SAME tx.
    await expect(
      asApp(cfg, async (tx) => {
        await fireNewOrder(tx, cfg, [line(setup.steak)]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // A fresh transaction sees no print jobs.
    const jobs = await asApp(cfg, (tx) => printJobsFor(tx));
    expect(jobs).toHaveLength(0);
  });

  it("resolves the table label via the counter-delivery delivery_table_id direction", async () => {
    // The table-label subquery covers BOTH `dt.tab_id = order.id` (a seated tab, tested above) and
    // `order.delivery_table_id = dt.id` (a counter delivery — a walk-up order routed to a table). This
    // pins the second direction. enqueueKitchenTickets is called directly on an order whose
    // `delivery_table_id` points at the table (no tab_id back-pointer).
    const { cfg, catalogueId } = await setupVenue();
    const { printerId, jobs } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer", "station");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      const drink = await makeProduct(tx, cfg, catalogueId, "Zumo", { stationId: cocina.id });
      const orderId = randomUUID();
      await createOpenOrder(tx, cfg, orderId, [line(drink)], null);
      // A counter-delivery table the order delivers to — the order points AT it (no tab back-pointer).
      const table = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (location_id, label)
        values (${cfg.locationId}, 'Barra 3') returning id`);
      await tx.execute(sql`
        update working_orders set delivery_table_id = ${table.rows[0]!.id} where id = ${orderId}`);
      const [lineRow] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      // Enqueue directly with the fired line routed to Cocina — the tableLabel must resolve to the
      // delivery table via the `delivery_table_id = dt.id` arm of the subquery.
      await enqueueKitchenTickets(tx, cfg, orderId, [
        { workingOrderLineId: lineRow!.id, stationId: cocina.id },
      ]);
      return { printerId, jobs: await printJobsFor(tx) };
    });

    const stationJobs = jobs.filter((j) => j.printerId === printerId);
    expect(stationJobs).toHaveLength(1);
    expect(decodeTicket(stationJobs[0]!.payload)).toContain("Barra 3"); // via delivery_table_id, not tab_id
  });

  it("returns early after the single mapping read when the involved stations have NO attached printer", async () => {
    // The no-kitchen-printer venue's common case: a station fires but nothing is mapped to it. The mapping
    // read runs FIRST and comes back empty, so enqueueKitchenTickets RETURNS before the three
    // line/station/order detail SELECTs — proven by counting the `tx.select` calls it issues (one mapping
    // read, not four). It enqueues nothing and takes no printer-row lock. This distinguishes the reordered
    // code (1 select) from the old order (4 selects); the zero-jobs assertion holds for both, so it is the
    // select count that pins the early return (CLAUDE.md §4: a test must fail with the guard removed).
    const { cfg, catalogueId } = await setupVenue();
    const { selectCalls, jobs } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      // A live order with a fired line routed to Cocina, but NO printer attached to the station — so the
      // detail reads WOULD succeed (the rows exist) if they ran, isolating the count as the only signal.
      const dish = await makeProduct(tx, cfg, catalogueId, "Tortilla", { stationId: cocina.id });
      const orderId = randomUUID();
      await createOpenOrder(tx, cfg, orderId, [line(dish)], null);
      const [lineRow] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      // Count only the SELECTs enqueueKitchenTickets itself issues.
      const selectSpy = vi.spyOn(tx, "select");
      await enqueueKitchenTickets(tx, cfg, orderId, [
        { workingOrderLineId: lineRow!.id, stationId: cocina.id },
      ]);
      const selectCalls = selectSpy.mock.calls.length;
      selectSpy.mockRestore();
      return { selectCalls, jobs: await printJobsFor(tx) };
    });

    expect(jobs).toHaveLength(0); // nothing mapped → nothing enqueued (a pure no-op)
    expect(selectCalls).toBe(1); // ONLY the mapping read ran; the three detail SELECTs were skipped
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
    // The 80mm ticket lays out to its own wider column count: a line exceeds 30 (impossible on the
    // 58mm printer's 30 columns) yet none exceeds 42, and rejoining the wrap continuations recovers the
    // whole dish name. The fired line reads "1.000 unitat x Chuletón…", whose 15-char qty+unit prefix
    // wraps the name at both widths — so the plan's original `.endsWith` at 42 could never have held.
    const wideLines = printedLines(new Uint8Array(payloadOf(ids.wide)));
    for (const printed of wideLines) expect(printed.length, printed).toBeLessThanOrEqual(42);
    // Positively pins the WIDER direction, not just narrow != wide: a 30-column layout could not
    // produce a line this long.
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
      await enqueueCorrectionSlips(tx, cfg, orderId, fired, "VOID");
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

describe("ordering modifiers on the kitchen ticket (parent-only ticket_items, child sub-text)", () => {
  it("fires a dish with two extras as ONE ticket_item (the parent), never one per child", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { orderId, parentLineId, ticketItemRows } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer", "station");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      // A dish with TWO extras picked — even with a DEFAULT station present (so a child would otherwise
      // route to it), only the parent must become a ticket item.
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
      // The persisted lines: one parent (parent_line_id null) + one child per pick.
      const lines = await tx
        .select({
          id: workingOrderLines.id,
          productId: workingOrderLines.productId,
          parentLineId: workingOrderLines.parentLineId,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId))
        .orderBy(workingOrderLines.lineNo);
      expect(lines).toHaveLength(3); // parent + two child extra lines
      const parent = lines.find((l) => l.parentLineId === null)!;
      const ticketItemRows = await tx
        .select({ workingOrderLineId: ticketItems.workingOrderLineId })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      return { orderId, parentLineId: parent.id, ticketItemRows };
    });

    // Exactly ONE ticket item, and it is the PARENT's — the two children got none.
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
      // instead of the staff name the child line froze reads differently (CLAUDE.md §4).
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
    expect(ticket).toContain("Cortado"); // the parent dish line
    expect(ticket).toContain("+ Nata"); // each pick as indented sub-text beneath the parent
    expect(ticket).toContain("+ Leche avena");
    // A cook reads the staff name, never the diner's wording.
    expect(ticket).not.toContain("Nata montada");
    expect(ticket).not.toContain("Bebida de avena");
    // The picks appear BELOW the dish, and each sub-text row carries the "+ " marker.
    expect(ticket.indexOf("Cortado")).toBeLessThan(ticket.indexOf("+ Nata"));
    expect(ticket.indexOf("Cortado")).toBeLessThan(ticket.indexOf("+ Leche avena"));
  });

  it("prints the line's doneness prominently and its note as sub-lines on the kitchen ticket (order-line customisation)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { printerId, jobs } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer", "station");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      const chuleton = await makeProduct(tx, cfg, catalogueId, "Chuleton", {
        stationId: cocina.id,
      });

      await fireNewOrder(tx, cfg, [
        { productId: chuleton, quantity: "1", note: "sin sal", doneness: "medium_rare" },
      ]);
      return { printerId, jobs: await printJobsFor(tx) };
    });

    const ticket = decodeTicket(jobs.filter((j) => j.printerId === printerId)[0]!.payload);
    expect(ticket).toContain("Chuleton");
    // Doneness prominent (upper-cased, underscores spaced) BENEATH the dish, above the note.
    expect(ticket).toContain("MEDIUM RARE");
    expect(ticket).not.toContain("medium_rare");
    expect(ticket).toContain("* sin sal");
    expect(ticket.indexOf("Chuleton")).toBeLessThan(ticket.indexOf("MEDIUM RARE"));
    expect(ticket.indexOf("MEDIUM RARE")).toBeLessThan(ticket.indexOf("* sin sal"));
  });

  it("badges an extra's PER-DISH count when it exceeds one, leaving a single pick's line unchanged", async () => {
    // Per-pick quantity: an extra taken ×N per dish is filed as a CHILD line whose stored `quantity` is
    // the COMBINED count = dishQuantity × pickQuantity. The kitchen ticket shows the per-dish count
    // (childQuantity ÷ parentDishQuantity) as an ASCII "xN" suffix on the child line ONLY when it
    // exceeds 1 — so a single pick prints `  + <name>` exactly as before.
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

      // Dish quantity 1; "Nata" picked ×2 → child quantity 2 (per-dish 2 → "x2"); "Leche avena" picked
      // once → child quantity 1 (per-dish 1 → no suffix).
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
    expect(ticket).toContain("+ Nata x2"); // per-dish count badged with an ASCII "x"
    expect(ticket).toContain("+ Leche avena"); // single pick — unchanged, no suffix
    expect(ticket).not.toContain("Leche avena x"); // the single pick carries NO count
    // Proven by contrast: without the badge the Nata line would read `+ Nata`, like the control.
    expect(ticket).not.toMatch(/\+ Nata(?! x)/u);
  });

  it("never station-resolves a child line: a dish-with-extras fires with NO default station", async () => {
    // The child line carries the picked extra's product, which routes nowhere of its own. With no venue
    // default station, an independently-resolved child would fail LOUD with `station.no_default`. The
    // parent-only filter means the child is never resolved — the fire succeeds and the parent uses its
    // OWN station.
    const { cfg, catalogueId } = await setupVenue();
    const { stationId, ticketItemRows } = await asApp(cfg, async (tx) => {
      // A NON-default station: the product routes to it explicitly; there is NO is_default station, so a
      // line that resolves neither a product nor category route has nowhere to go (station.no_default).
      const barra = await createStation(tx, cfg, { name: "Barra", isDefault: false });
      const cafe = await makeProduct(tx, cfg, catalogueId, "Cafe", { stationId: barra.id });
      const { listId, productIds } = await addExtras(tx, cfg, catalogueId, cafe, [
        { name: "Nata" },
      ]);

      // This must NOT throw station.no_default — the child is filtered before station resolution.
      const orderId = await fireNewOrder(tx, cfg, [
        {
          productId: cafe,
          quantity: "1",
          extras: [{ listId, picks: [{ productId: productIds[0]!, quantity: 1 }] }],
        },
      ]);
      const ticketItemRows = await tx
        .select({
          workingOrderLineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
        })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      return { stationId: barra.id, ticketItemRows };
    });

    // One ticket item — the parent — routed to the PARENT's own station, not a (missing) default.
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

      // Fire round 1 (auto-fires Entrantes/soup, holds Principales/steak), then round 2 releases the
      // held course — so BOTH items are now fired, from two separate rounds.
      const orderId = await fireNewOrder(tx, cfg, [line(soup), line(steak)]);
      await fireCourse(tx, cfg, orderId, pri.id);
      const beforeReprint = await printJobsFor(tx);

      // Reprint re-queries ALL currently-fired items (both rounds) and re-enqueues the whole ticket —
      // unlike print-on-fire, which prints only the newly-fired set. This is the load-bearing difference.
      await reprintOrderTickets(tx, cfg, orderId);
      const afterReprint = await printJobsFor(tx);
      return { pStation, pGroup, beforeReprint, afterReprint };
    });

    // The reprint added NEW jobs on top of the two rounds' print-on-fire jobs.
    const beforeIds = new Set(beforeReprint.map((j) => j.id));
    const newJobs = afterReprint.filter((j) => !beforeIds.has(j.id));

    // One station ticket + one consolidated group ticket = two new jobs (the one involved station, Cocina,
    // its station printer once and its group printer once), no more.
    const newStation = newJobs.filter((j) => j.printerId === pStation);
    const newGroup = newJobs.filter((j) => j.printerId === pGroup);
    expect(newStation).toHaveLength(1);
    expect(newGroup).toHaveLength(1);
    expect(newJobs).toHaveLength(2);

    // The reprinted STATION ticket carries BOTH rounds' items — the whole current ticket, not just the
    // last-fired course (round 2's print-on-fire ticket carried only Chuleton).
    const stationTicket = decodeTicket(newStation[0]!.payload);
    expect(stationTicket).toContain("Sopa");
    expect(stationTicket).toContain("Chuleton");

    // The reprinted GROUP ticket is the consolidated whole-event ticket, both items under the Cocina header.
    const groupTicket = decodeTicket(newGroup[0]!.payload);
    expect(groupTicket).toContain("Sopa");
    expect(groupTicket).toContain("Chuleton");
    expect(groupTicket).toContain("Cocina");
  });

  it("enqueues nothing (and does NOT throw) for an order with no fired items", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const jobs = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer", "station");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      await makeProduct(tx, cfg, catalogueId, "Chuleton", { stationId: cocina.id });

      // An order id that has no fired ticket_items at all — a well-formed but unknown/never-fired order.
      // The verb re-queries zero fired rows and enqueues nothing, never throwing a new error code.
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
    const { lineRows } = await createOpenOrder(tx, cfg, orderId, [line(productId)], null);
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
 * product's staff name ("Coffee") and its customer-facing text ("Café recién hecho") are deliberately
 * DIFFERENT, so a ticket that fell back to the customer text reads differently from one that fell
 * back to the staff name — the two are not tellable apart when a product carries only one name.
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
    const { lineRows } = await createOpenOrder(tx, cfg, orderId, [line(productId)], null);
    const parent = lineRows[0]!;
    await tx.update(workingOrderLines).set(frozen).where(eq(workingOrderLines.id, parent.id!));
    await enqueueKitchenTickets(tx, cfg, orderId, [
      { workingOrderLineId: parent.id!, stationId: station.id },
    ]);
    return printJobsFor(tx);
  });
  return decodeTicket(jobs[0]!.payload);
}

it("prints the frozen kitchen names of the product and the selected variant", async () => {
  const paper = await ticketWithNames({
    kitchenName: "COF",
    variantName: "Large",
    variantKitchenName: "LG",
  });
  expect(paper).toContain("COF · LG");
  expect(paper).not.toContain("Coffee");
});

it("falls back to the variant's staff name when it has no kitchen name", async () => {
  const paper = await ticketWithNames({
    kitchenName: "COF",
    variantName: "Large",
    variantKitchenName: null,
  });
  expect(paper).toContain("COF · Large");
});

// The product's kitchen name falls back to its STAFF name, not to the customer-facing text the
// receipt prints — a cook reads the name the till buttons carry.
it("falls back to the product's staff name when it has no kitchen name", async () => {
  const paper = await ticketWithNames({
    kitchenName: null,
    variantName: "Large",
    variantKitchenName: "LG",
  });
  expect(paper).toContain("Coffee · LG");
  expect(paper).not.toContain("Café recién hecho");
});
