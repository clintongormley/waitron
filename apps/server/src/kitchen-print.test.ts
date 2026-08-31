import { randomUUID } from "node:crypto";
import net from "node:net";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  asAppUser,
  optionGroupItems,
  optionGroups,
  printJobs,
  productOptionGroups,
  ticketItems,
  withTenant,
  workingOrderLines,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { assignCatalogueToLocation, createCatalogue, createProduct } from "@waitron/catalogue";
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
import { enqueueKitchenTickets, reprintOrderTickets } from "./kitchen-print.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import "./errors.js";

// PGlite is the correct target: print-on-fire is a set of INSERT/SELECTs inside the caller's fire tx —
// no privilege or concurrency dimension (station_printers' RLS + grants are proven against real Postgres
// in Task 1's station-printers.rls.test.ts, enqueuePrintJob's outbox shape in packages/printing's
// outbox.test.ts). The load-bearing invariants HERE are logical: the order-scope dedupe, round
// independence (ruling R-D), and never-block (no socket). PGlite is in-process WASM, so "no socket
// opened" is a clean structural proof, exactly as outbox.test.ts relies on.
const LOCALE = "es-ES";
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
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
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${tenantId}, ${locationId}, 'Caja 1') returning id`);
  const nodeId = await seedNode(db, tenantId, brandLocationId(locationId));
  const catalogueId = await withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Carta" });
    await assignCatalogueToLocation(tx, locationId, cat.id);
    return cat.id;
  });
  const cfg: TillConfig = {
    tenantId,
    tillId: brandTillId(till.rows[0]!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  return { cfg, catalogueId };
}

/** The tenant + location scope the printing verbs run under. */
function printCfg(cfg: TillConfig): PrintConfig {
  return { tenantId: cfg.tenantId, locationId: cfg.locationId };
}

/** Run `fn` on a transaction scoped to the venue's tenant as `app_user` (RLS in force), the shape every
 *  route uses. `nodeId` mirrors the fire path so `ticket_items.node_id` is set as production would. */
function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(
    db,
    cfg.tenantId,
    async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    },
    { nodeId: cfg.nodeId },
  );
}

/** Read the venue's print-job outbox (the brief's `printJobsFor`, modelled on outbox.test.ts's `jobRow`).
 *  RLS scopes it to the caller's tenant; `payload` decodes through the bytea customType to a Buffer. */
async function printJobsFor(
  tx: Transaction,
): Promise<{ id: string; printerId: string; status: string; payload: Buffer }[]> {
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
    descriptions: { [LOCALE]: name },
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
  lines: { productId: string; quantity: string; options?: { optionGroupItemId: string }[] }[],
): Promise<string> {
  const id = randomUUID();
  await createOpenOrder(tx, cfg, id, lines, null);
  const fired = await tx
    .select({
      id: workingOrderLines.id,
      productId: workingOrderLines.productId,
      courseId: workingOrderLines.courseId,
      parentLineId: workingOrderLines.parentLineId,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id))
    .orderBy(workingOrderLines.lineNo);
  await fireLines(tx, cfg, id, fired);
  return id;
}

/** Attach a fresh single-item option group to `productId` and return the option-item id — the shape a
 *  round line's `options: [{ optionGroupItemId }]` selects. Each call mints its OWN group (minSelect 0,
 *  maxSelect 1), so two calls give two independently-selectable options on one dish. The option carries
 *  NO station — a modifier never routes to its own station (that is the point of the parent-only rule). */
async function addOption(tx: Transaction, productId: string, name: string): Promise<string> {
  const [group] = await tx
    .insert(optionGroups)
    .values({
      tenantId: sql`current_tenant_id()`,
      name: { [LOCALE]: `${name} group` },
      minSelect: 0,
      maxSelect: 1,
      required: false,
      sort: 0,
    })
    .returning({ id: optionGroups.id });
  const [item] = await tx
    .insert(optionGroupItems)
    .values({
      tenantId: sql`current_tenant_id()`,
      groupId: group!.id,
      name: { [LOCALE]: name },
      priceDelta: "0.50",
      vatClass: "reduced",
      sort: 0,
    })
    .returning({ id: optionGroupItems.id });
  await tx.insert(productOptionGroups).values({
    tenantId: sql`current_tenant_id()`,
    productId,
    groupId: group!.id,
    sort: 0,
  });
  return item!.id;
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
      await attachPrinterToStation(tx, printCfg(cfg), { stationId: cocina.id, printerId: pCocina });
      await attachPrinterToStation(tx, printCfg(cfg), { stationId: cocina.id, printerId: pGroup });
      await attachPrinterToStation(tx, printCfg(cfg), { stationId: barra.id, printerId: pGroup });
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
      await attachPrinterToStation(tx, printCfg(cfg), { stationId: cocina.id, printerId: pActive });
      await attachPrinterToStation(tx, printCfg(cfg), { stationId: barra.id, printerId: pDead });
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
      await attachPrinterToStation(tx, printCfg(cfg), { stationId: cocina.id, printerId });
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
      await attachPrinterToStation(tx, printCfg(cfg), { stationId: cocina.id, printerId });
      const drink = await makeProduct(tx, cfg, catalogueId, "Cafe con leche", {
        stationId: cocina.id,
      });
      // A tab bound to a dining table → the order carries the table label the ticket header prints.
      const table = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (tenant_id, location_id, label)
        values (${cfg.tenantId}, ${cfg.locationId}, 'Mesa 5') returning id`);
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
      await attachPrinterToStation(tx, printCfg(cfg), { stationId: cocina.id, printerId });
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
      await attachPrinterToStation(tx, printCfg(cfg), { stationId: cocina.id, printerId });
      const drink = await makeProduct(tx, cfg, catalogueId, "Zumo", { stationId: cocina.id });
      const orderId = randomUUID();
      await createOpenOrder(tx, cfg, orderId, [line(drink)], null);
      // A counter-delivery table the order delivers to — the order points AT it (no tab back-pointer).
      const table = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (tenant_id, location_id, label)
        values (${cfg.tenantId}, ${cfg.locationId}, 'Barra 3') returning id`);
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
});

describe("ordering modifiers on the kitchen ticket (parent-only ticket_items, child sub-text)", () => {
  it("fires a dish with two options as ONE ticket_item (the parent), never one per child", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { orderId, parentLineId, ticketItemRows } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer", "station");
      await attachPrinterToStation(tx, printCfg(cfg), { stationId: cocina.id, printerId });
      // A dish with TWO options — even with a DEFAULT station present (so a child would otherwise route
      // to it), only the parent must become a ticket item.
      const cortado = await makeProduct(tx, cfg, catalogueId, "Cortado", { stationId: cocina.id });
      const grande = await addOption(tx, cortado, "Grande");
      const avena = await addOption(tx, cortado, "Leche avena");

      const orderId = await fireNewOrder(tx, cfg, [
        {
          productId: cortado,
          quantity: "1",
          options: [{ optionGroupItemId: grande }, { optionGroupItemId: avena }],
        },
      ]);
      // The persisted lines: one parent (product set, parent_line_id null) + two children.
      const lines = await tx
        .select({
          id: workingOrderLines.id,
          productId: workingOrderLines.productId,
          parentLineId: workingOrderLines.parentLineId,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId))
        .orderBy(workingOrderLines.lineNo);
      expect(lines).toHaveLength(3); // parent + two child modifier lines
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

  it("renders the dish then its two options as indented '+' sub-text on the kitchen ticket", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { printerId, jobs } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer", "station");
      await attachPrinterToStation(tx, printCfg(cfg), { stationId: cocina.id, printerId });
      const cortado = await makeProduct(tx, cfg, catalogueId, "Cortado", { stationId: cocina.id });
      const grande = await addOption(tx, cortado, "Grande");
      const avena = await addOption(tx, cortado, "Leche avena");

      await fireNewOrder(tx, cfg, [
        {
          productId: cortado,
          quantity: "1",
          options: [{ optionGroupItemId: grande }, { optionGroupItemId: avena }],
        },
      ]);
      return { printerId, jobs: await printJobsFor(tx) };
    });

    const stationJobs = jobs.filter((j) => j.printerId === printerId);
    expect(stationJobs).toHaveLength(1);
    const ticket = decodeTicket(stationJobs[0]!.payload);
    expect(ticket).toContain("Cortado"); // the parent dish line
    expect(ticket).toContain("+ Grande"); // each option as indented sub-text beneath the parent
    expect(ticket).toContain("+ Leche avena");
    // The options appear BELOW the dish, and each sub-text row carries the "+ " marker.
    expect(ticket.indexOf("Cortado")).toBeLessThan(ticket.indexOf("+ Grande"));
    expect(ticket.indexOf("Cortado")).toBeLessThan(ticket.indexOf("+ Leche avena"));
  });

  it("never station-resolves a child line: a dish-with-options fires with NO default station", async () => {
    // The child modifier line carries no product and no station of its own. With no venue default
    // station, an independently-resolved child would fail LOUD with `station.no_default`. The parent-only
    // filter means the child is never resolved — the fire succeeds and the parent uses its OWN station.
    const { cfg, catalogueId } = await setupVenue();
    const { stationId, ticketItemRows } = await asApp(cfg, async (tx) => {
      // A NON-default station: the product routes to it explicitly; there is NO is_default station, so a
      // line that resolves neither a product nor category route has nowhere to go (station.no_default).
      const barra = await createStation(tx, cfg, { name: "Barra", isDefault: false });
      const cafe = await makeProduct(tx, cfg, catalogueId, "Cafe", { stationId: barra.id });
      const grande = await addOption(tx, cafe, "Grande");

      // This must NOT throw station.no_default — the child is filtered before station resolution.
      const orderId = await fireNewOrder(tx, cfg, [
        { productId: cafe, quantity: "1", options: [{ optionGroupItemId: grande }] },
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
      await attachPrinterToStation(tx, printCfg(cfg), {
        stationId: cocina.id,
        printerId: pStation,
      });
      await attachPrinterToStation(tx, printCfg(cfg), { stationId: cocina.id, printerId: pGroup });
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
      await attachPrinterToStation(tx, printCfg(cfg), { stationId: cocina.id, printerId });
      await makeProduct(tx, cfg, catalogueId, "Chuleton", { stationId: cocina.id });

      // An order id that has no fired ticket_items at all — a well-formed but unknown/never-fired order.
      // The verb re-queries zero fired rows and enqueues nothing, never throwing a new error code.
      await reprintOrderTickets(tx, cfg, randomUUID());
      return printJobsFor(tx);
    });
    expect(jobs).toHaveLength(0);
  });
});
