import { randomUUID } from "node:crypto";
import net from "node:net";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  diningTables,
  kitchenPrintJobLines,
  kitchenPrintJobs,
  nowIso,
  orderGroups,
  parties,
  partyTables,
  printJobs,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  EACH_UNIT,
  createProduct,
  readContentLanguages,
  units,
  updateUnit,
} from "@waitron/catalogue";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter, deactivatePrinter, updatePrinter } from "@waitron/printing";
import type { PrintConfig } from "@waitron/printing";
import { thousandthsToDecimal } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createCourse, createStation, setProductCourse, updateStation } from "./kitchen.js";
import { addTabRound, createOpenOrder, fireCourse, fireLines } from "./working-order.js";
import {
  listStationNotices,
  writeKitchenTicketGrouping,
  writePrintHeldWork,
  setStationFallback,
  setStationToday,
} from "@waitron/venue-service";
import { placeGroups } from "./order-groups.js";
import { attachPrinterToStation } from "./station-printers.js";
import { createWatcher, setPrinterWatcher } from "./watchers.js";
import {
  enqueueCorrectionSlips,
  enqueueKitchenTickets,
  enqueueStationMoved,
  orderTableLabel,
  reprintOrderTickets,
} from "./kitchen-print.js";
import { decodeTicket, printedCommands, printedLines } from "./testing/decode-ticket.js";
import { routeProductTo, offerProducts } from "./testing/zone-offers.js";
import {
  billRow,
  inTx,
  join,
  nameParty,
  orderForParty,
  seat,
  setupPartyVenue,
  split,
  tableAt,
} from "./testing/party-venue.js";
import "./errors.js";
import {
  setupVenue,
  fireNewOrder,
  createOfferedOrder,
  addExtras,
  useSplitExtrasDb,
  setupSplitExtrasVenue,
} from "./testing/split-extras-venue.js";
import { openPartyTab } from "./testing/serve-line.js";
import { cancelLine } from "./testing/cancel-line.js";

const OPERATOR = "0000ffff-2222-4000-8000-0000000000aa";

// Pins one watcher copy per send, round independence and never-block (no socket opened).
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
  useSplitExtrasDb(db);
});
afterEach(() => {
  vi.restoreAllMocks();
});

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

/** The dot widths of a payload's drawn lines of text. */
function lineWidths(payload: Uint8Array): Set<number> {
  return new Set(
    printedCommands(payload)
      .filter((command) => command.text !== undefined)
      .map((command) => command.widthDots!),
  );
}

/** A basket line for a product at quantity 1. */
const line = (productId: string) => ({ productId, quantity: "1" });

describe("paper for a move to another station", () => {
  it.each([
    ["fired", false, false],
    ["held", true, false],
    ["printer off", false, true],
  ] as const)(
    "records the reroute and corrects %s work at the old station",
    async (_case, held, printerOff) => {
      const { cfg, catalogueId } = await setupVenue();
      const result = await asApp(cfg, async (tx) => {
        const bar = await createStation(tx, cfg, { name: "Bar", isDefault: true });
        const grill = await createStation(tx, cfg, { name: "Grill", isDefault: false });
        const barPrinter = await makePrinter(tx, cfg, "Bar printer");
        const grillPrinter = await makePrinter(tx, cfg, "Grill printer");
        await attachPrinterToStation(tx, { stationId: bar.id, printerId: barPrinter });
        await attachPrinterToStation(tx, { stationId: grill.id, printerId: grillPrinter });
        const dish = await makeProduct(tx, cfg, catalogueId, "Steak", { stationId: bar.id });
        const orderId = await fireNewOrder(tx, cfg, [line(dish)]);
        const [fired] = await tx
          .select({ workingOrderLineId: ticketItems.workingOrderLineId })
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderId, orderId));
        const before = new Set((await printJobsFor(tx)).map((job) => job.id));
        if (printerOff) await deactivatePrinter(tx, printCfg(cfg), barPrinter);
        await enqueueStationMoved(
          tx,
          cfg,
          orderId,
          [
            {
              workingOrderLineId: fired!.workingOrderLineId,
              stationId: bar.id,
              quantity: 1000,
              wasStarted: false,
              ...(held ? { group: 2 } : {}),
            },
          ],
          "Grill",
        );
        return {
          notices: await listStationNotices(tx, cfg, bar.id),
          jobs: (await printJobsFor(tx)).filter((job) => !before.has(job.id)),
          barPrinter,
        };
      });
      expect(result.notices).toMatchObject([
        { stationId: expect.any(String), kind: "rerouted", reroutedTo: "Grill", lineName: "Steak" },
      ]);
      expect(result.jobs.map((job) => job.printerId)).toEqual(
        printerOff ? [] : [result.barPrinter],
      );
      if (!printerOff) {
        const lines = printedLines(result.jobs[0]!.payload);
        expect(lines[0]).toBe(held ? "*** HOLD CANCELLED ***" : "*** PASADO A GRILL ***");
        if (held) expect(lines).toContain("GROUP 2");
        expect(lines).toContain("1.000 x Steak");
      }
    },
  );

  it("prints the origin on the new station's linked ticket", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const result = await asApp(cfg, async (tx) => {
      const grill = await createStation(tx, cfg, { name: "Grill", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Grill printer");
      await attachPrinterToStation(tx, { stationId: grill.id, printerId });
      const dish = await makeProduct(tx, cfg, catalogueId, "Steak", { stationId: grill.id });
      const orderId = randomUUID();
      await createOfferedOrder(tx, cfg, orderId, [line(dish)]);
      const [row] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      await enqueueKitchenTickets(
        tx,
        cfg,
        orderId,
        [{ workingOrderLineId: row!.id, stationId: grill.id }],
        { from: "Bar" },
      );
      return {
        jobs: await printJobsFor(tx),
        links: await tx.select().from(kitchenPrintJobs),
        lines: await tx.select().from(kitchenPrintJobLines),
        printerId,
        stationId: grill.id,
        lineId: row!.id,
      };
    });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]!.printerId).toBe(result.printerId);
    expect(printedLines(result.jobs[0]!.payload)).toContain("Viene de Bar");
    expect(result.links).toMatchObject([
      { printJobId: result.jobs[0]!.id, stationId: result.stationId },
    ]);
    expect(result.lines).toMatchObject([
      { printJobId: result.jobs[0]!.id, workingOrderLineId: result.lineId },
    ]);
  });
});

describe("show the rest of the order", () => {
  it("adds other stations only to an enabled station ticket and refreshes the list on reprint", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const result = await asApp(cfg, async (tx) => {
      const grill = await createStation(tx, cfg, { name: "Grill", isDefault: true });
      const fryer = await createStation(tx, cfg, { name: "Fryer" });
      const cold = await createStation(tx, cfg, { name: "Cold" });
      await updateStation(tx, cfg, grill.id, { showsRestOfOrder: true });
      const grillPrinter = await makePrinter(tx, cfg, "Grill printer");
      const fryerPrinter = await makePrinter(tx, cfg, "Fryer printer");
      const passPrinter = await makeWatcherPrinter(tx, cfg, "Pase", [grill.id]);
      await attachPrinterToStation(tx, { stationId: grill.id, printerId: grillPrinter });
      await attachPrinterToStation(tx, { stationId: fryer.id, printerId: fryerPrinter });
      const burger = await makeProduct(tx, cfg, catalogueId, "Burger", { stationId: grill.id });
      const chips = await makeProduct(tx, cfg, catalogueId, "Chips", { stationId: fryer.id });
      const salad = await makeProduct(tx, cfg, catalogueId, "Salad", { stationId: cold.id });
      const orderId = await fireNewOrder(tx, cfg, [line(burger), line(chips)]);
      const first = await printJobsFor(tx);
      const beforeSalad = new Set(first.map((job) => job.id));
      await fireNewOrder(tx, cfg, [line(salad)]);
      const later = (await printJobsFor(tx)).filter((job) => !beforeSalad.has(job.id));
      const lineId = randomUUID();
      await tx.insert(workingOrderLines).values({
        id: lineId,
        workingOrderId: orderId,
        lineNo: 3,
        name: "Salad",
        descriptions: { [LOCALE]: "Salad" },
        quantity: 1000,
        unitPriceGross: 150,
        vatClass: "general",
        lineTotal: 150,
      });
      await tx.insert(ticketItems).values({
        nodeId: cfg.nodeId,
        workingOrderId: orderId,
        workingOrderLineId: lineId,
        stationId: cold.id,
        state: "queued",
        firedAt: nowIso(),
        quantity: 1000,
      });
      await tx.insert(workingOrderLines).values({
        workingOrderId: orderId,
        lineNo: 4,
        name: "Water",
        descriptions: { [LOCALE]: "Water" },
        quantity: 1000,
        unitPriceGross: 100,
        vatClass: "general",
        lineTotal: 100,
      });
      const [party] = await tx
        .insert(parties)
        .values({ openedBy: OPERATOR })
        .returning({ id: parties.id });
      const [group] = await tx
        .insert(orderGroups)
        .values({
          partyId: party!.id,
          position: 1,
          state: "held",
          submittedBy: OPERATOR,
          holdPrintedAt: nowIso(),
        })
        .returning({ id: orderGroups.id });
      const pastry = await createStation(tx, cfg, { name: "Pastry" });
      const held = async (name: string, stationId: string, lineNo: number) => {
        const id = randomUUID();
        await tx.insert(workingOrderLines).values({
          id,
          workingOrderId: orderId,
          lineNo,
          name,
          descriptions: { [LOCALE]: name },
          quantity: 1000,
          unitPriceGross: 100,
          vatClass: "general",
          lineTotal: 100,
          groupId: group!.id,
        });
        await tx.insert(ticketItems).values({
          nodeId: cfg.nodeId,
          workingOrderId: orderId,
          workingOrderLineId: id,
          stationId,
          state: "queued",
          firedAt: null,
          quantity: 1000,
        });
      };
      await held("Steak", grill.id, 5);
      await held("Dessert", pastry.id, 6);
      const beforeReprint = new Set((await printJobsFor(tx)).map((job) => job.id));
      await reprintOrderTickets(tx, cfg, orderId);
      const reprinted = (await printJobsFor(tx)).filter((job) => !beforeReprint.has(job.id));
      const [chipsLine] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(
          sql`${workingOrderLines.workingOrderId} = ${orderId} and ${workingOrderLines.name} = 'Chips'`,
        );
      await tx
        .update(workingOrderLines)
        .set({ servedAt: nowIso() })
        .where(eq(workingOrderLines.id, chipsLine!.id));
      const beforeServed = new Set((await printJobsFor(tx)).map((job) => job.id));
      await reprintOrderTickets(tx, cfg, orderId);
      const served = (await printJobsFor(tx)).filter((job) => !beforeServed.has(job.id));
      await tx
        .update(workingOrderLines)
        .set({ servedAt: null })
        .where(eq(workingOrderLines.id, chipsLine!.id));
      await tx
        .update(ticketItems)
        .set({ awayAt: nowIso() })
        .where(eq(ticketItems.workingOrderLineId, chipsLine!.id));
      const beforeAway = new Set((await printJobsFor(tx)).map((job) => job.id));
      await reprintOrderTickets(tx, cfg, orderId);
      const away = (await printJobsFor(tx)).filter((job) => !beforeAway.has(job.id));
      return { first, later, reprinted, served, away, grillPrinter, fryerPrinter, passPrinter };
    });
    const firstAt = (id: string) =>
      printedLines(result.first.find((job) => job.printerId === id)!.payload);
    expect(firstAt(result.grillPrinter).join(" ")).toContain("También en este pedido");
    expect(firstAt(result.grillPrinter)).toContain(`${thousandthsToDecimal(1000)} x Chips — Fryer`);
    expect(firstAt(result.fryerPrinter).join(" ")).not.toContain("También en este pedido");
    expect(firstAt(result.passPrinter).join(" ")).not.toContain("También en este pedido");
    expect(result.later.some((job) => job.printerId === result.grillPrinter)).toBe(false);
    const grillReprint = printedLines(
      result.reprinted.find((job) => job.printerId === result.grillPrinter)!.payload,
    );
    expect(grillReprint).toContain(`${thousandthsToDecimal(1000)} x Chips — Fryer`);
    expect(grillReprint).toContain(`${thousandthsToDecimal(1000)} x Salad — Cold`);
    expect(grillReprint).toContain(`${thousandthsToDecimal(1000)} x Dessert — Pastry (en espera)`);
    expect(grillReprint.join(" ").match(/También en este pedido/g)).toHaveLength(1);
    expect(grillReprint.filter((entry) => entry.includes("Chips — Fryer"))).toHaveLength(1);
    expect(grillReprint.join(" ")).not.toContain("Water");
    for (const jobs of [result.served, result.away]) {
      const grillText = decodeTicket(
        jobs.find((job) => job.printerId === result.grillPrinter)!.payload,
      );
      expect(grillText).not.toContain("Chips — Fryer");
      expect(grillText).toContain("Salad — Cold");
    }
  });
});

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
  if (route.stationId !== undefined) await routeProductTo(tx, cfg, id, route.stationId);
  if (route.courseId !== undefined) await setProductCourse(tx, cfg, id, route.courseId);
  return id;
}

/** Create a live station printer. */
async function makePrinter(tx: Transaction, cfg: TillConfig, name: string): Promise<string> {
  const { id } = await createPrinter(tx, printCfg(cfg), {
    name,
    transport: "cloud_poll",
    pollId: `poll-${randomUUID()}`,
  });
  return id;
}

async function makeWatcherPrinter(
  tx: Transaction,
  cfg: TillConfig,
  name: string,
  stationIds: string[],
  watcherId?: string,
): Promise<string> {
  const printerId = await makePrinter(tx, cfg, name);
  const id =
    watcherId ??
    (
      await createWatcher(tx, cfg, {
        name: "Pase",
        runsPass: true,
        everyStation: false,
        stationIds,
        everyZone: true,
        zoneIds: [],
      })
    ).id;
  await setPrinterWatcher(tx, cfg, printerId, id);
  return printerId;
}

/**
 * Open an order with NO service context holding one dish line and one child line per pick, then FIRE
 * it, so the dish's zone-less product exception selects its station. The lines are written straight to the table
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
    unitPriceGross: 150,
    vatClass: "general",
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
      quantity: workingOrderLines.quantity,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id))
    .orderBy(workingOrderLines.lineNo);
  await fireLines(tx, cfg, id, fired);
  return id;
}

/** Every outbound TCP open goes through `Socket.prototype.connect`. */
function spyOnNoSocketOpened() {
  return vi.spyOn(
    net.Socket.prototype as unknown as { connect: (...args: unknown[]) => unknown },
    "connect",
  );
}

describe("print-on-fire (enqueueKitchenTickets wired into fireLines / fireCourse)", () => {
  it("prints each station's ticket and one copy for the watcher following both", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { pCocina, pGroup, jobs } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const barra = await createStation(tx, cfg, { name: "Barra" });
      const pCocina = await makePrinter(tx, cfg, "Cocina printer");
      const pGroup = await makeWatcherPrinter(tx, cfg, "Pase", [cocina.id, barra.id]);
      // The watcher follows both Cocina and Barra.
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId: pCocina });
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

  it("heads no group on the ticket of an order whose lines are in no group", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { pCocina, pGroup, jobs } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const pCocina = await makePrinter(tx, cfg, "Cocina printer");
      const pGroup = await makeWatcherPrinter(tx, cfg, "Pase", [cocina.id]);
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId: pCocina });
      const steak = await makeProduct(tx, cfg, catalogueId, "Chuleton", { stationId: cocina.id });

      await fireNewOrder(tx, cfg, [line(steak)]);
      return { pCocina, pGroup, jobs: await printJobsFor(tx) };
    });

    for (const printerId of [pCocina, pGroup]) {
      const printed = jobs.filter((j) => j.printerId === printerId);
      expect(printed).toHaveLength(1);
      expect(decodeTicket(printed[0]!.payload)).toContain("Chuleton");
      expect(decodeTicket(printed[0]!.payload)).not.toContain("GROUP");
    }
  });

  it("never opens a socket on fire, queues its jobs, and enqueues nothing to an inactive printer", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const connectSpy = spyOnNoSocketOpened();
    const { pActive, pDead, jobs } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const barra = await createStation(tx, cfg, { name: "Barra" });
      const pActive = await makePrinter(tx, cfg, "Cocina printer");
      const pDead = await makePrinter(tx, cfg, "Barra printer");
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
      const printerId = await makePrinter(tx, cfg, "Cocina printer");
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
      await fireCourse(tx, cfg, orderId, pri.id, OPERATOR);
      const afterRound2 = await printJobsFor(tx);
      // Re-firing the already-fired course matches zero rows.
      await fireCourse(tx, cfg, orderId, pri.id, OPERATOR);
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
      const printerId = await makePrinter(tx, cfg, "Cocina printer");
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
      const { tabId } = await openPartyTab(tx, cfg, { tableId: table!.id });
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
      const printerId = await makePrinter(tx, cfg, "Cocina printer");
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
      const printerId = await makePrinter(tx, cfg, "Cocina printer");
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
    expect(selectCalls).toBe(2);
  });

  it("builds one kitchen ticket per distinct paper width and resolution among the printers", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const ids = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const wide = await makePrinter(tx, cfg, "Cocina 80 A");
      const wideTwin = await makePrinter(tx, cfg, "Cocina 80 B");
      const narrow = await makePrinter(tx, cfg, "Cocina 58");
      await updatePrinter(tx, printCfg(cfg), narrow, { paperWidth: "58mm" });
      const watcher = await createWatcher(tx, cfg, {
        name: "Pase",
        runsPass: true,
        everyStation: false,
        stationIds: [cocina.id],
        everyZone: true,
        zoneIds: [],
      });
      const pass = await makeWatcherPrinter(tx, cfg, "Pase 180", [cocina.id], watcher.id);
      const pass203 = await makeWatcherPrinter(tx, cfg, "Pase 203", [cocina.id], watcher.id);
      await updatePrinter(tx, printCfg(cfg), pass203, { resolution: "203dpi" });
      for (const printerId of [wide, wideTwin, narrow]) {
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
      return { wide, wideTwin, narrow, pass, pass203, jobs: await printJobsFor(tx) };
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
    expect(payloadOf(ids.pass203).equals(payloadOf(ids.pass))).toBe(false);
    expect(lineWidths(payloadOf(ids.pass))).toEqual(new Set([512]));
    expect(lineWidths(payloadOf(ids.pass203))).toEqual(new Set([576]));
  });

  it("draws the next ticket at the paper width and resolution the printer was changed to", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const widths = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      const steak = await makeProduct(tx, cfg, catalogueId, "Steak", { stationId: cocina.id });
      const seen = new Set<string>();
      const nextTicketWidths = async (): Promise<number[]> => {
        await fireNewOrder(tx, cfg, [line(steak)]);
        const fresh = (await printJobsFor(tx)).filter((job) => !seen.has(job.id));
        for (const job of fresh) seen.add(job.id);
        expect(fresh).toHaveLength(1);
        return [...lineWidths(fresh[0]!.payload)];
      };
      const before = await nextTicketWidths();
      await updatePrinter(tx, printCfg(cfg), printerId, { paperWidth: "58mm" });
      const narrowed = await nextTicketWidths();
      await updatePrinter(tx, printCfg(cfg), printerId, { resolution: "203dpi" });
      const finer = await nextTicketWidths();
      return [before, narrowed, finer];
    });
    expect(widths).toEqual([[512], [360], [384]]);
  });

  it("builds a correction slip once per distinct layout among the line's printers", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const result = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const wide = await makePrinter(tx, cfg, "Cocina 80");
      const narrow = await makePrinter(tx, cfg, "Cocina 58");
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
      const printerId = await makePrinter(tx, cfg, "Cocina printer");
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
      const printerId = await makePrinter(tx, cfg, "Cocina printer");
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
      const printerId = await makePrinter(tx, cfg, "Cocina printer");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      const steak = await makeProduct(tx, cfg, catalogueId, "Chuleton", { stationId: cocina.id });
      const offers = await offerProducts(tx, cfg, { zone: "tables" });
      const [table] = await tx
        .insert(diningTables)
        .values({ locationId: cfg.locationId, label: "T1", zoneId: offers.zoneId })
        .returning({ id: diningTables.id });
      const { tabId } = await openPartyTab(tx, cfg, { tableId: table!.id });
      await addTabRound(tx, cfg, tabId, [{ menuItemId: offers.offerFor(steak), quantity: "3" }]);
      const before = new Set((await printJobsFor(tx)).map((job) => job.id));
      await cancelLine(tx, cfg, tabId, 1, "2");
      return (await printJobsFor(tx)).filter((job) => !before.has(job.id));
    });

    expect(slips).toHaveLength(1);
    const slip = decodeTicket(slips[0]!.payload);
    expect(slip).toContain(`${thousandthsToDecimal(2000)} x Chuleton`);
  });
});

describe("a dish sold by the piece prints no unit", () => {
  /**
   * Five dishes at Cocina, each sold in a different unit: Croqueta in Each as a product with no
   * stored unit, Bomba in the stored unit seeded "each", renamed so only its identity marks it Each,
   * Pulpo in the kg seed, Almendras in grams, and Pan in a stored unit spelled exactly like Each but
   * not seeded as it.
   */
  async function sellInEveryUnit(tx: Transaction, cfg: TillConfig, catalogueId: string) {
    const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
    const printerId = await makePrinter(tx, cfg, "Cocina printer");
    await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
    const [seededEach] = await tx
      .select({ id: units.id })
      .from(units)
      .where(eq(units.seedKey, "each"));
    await updateUnit(tx, seededEach!.id, { abbreviation: { es: "pz" } }, "es");
    const grams = { en: "g", es: "g", ca: "g", gl: "g", eu: "g" };
    const [gram, lookAlike] = await tx
      .insert(units)
      .values([
        { name: grams, abbreviation: grams, precision: 0, hardwareUnit: "g" },
        {
          name: { en: "piece", es: "pieza", ca: "peça", gl: "peza", eu: "pieza" },
          abbreviation: EACH_UNIT.abbreviation,
          precision: 0,
          hardwareUnit: null,
        },
      ])
      .returning({ id: units.id });
    const dish = async (
      name: string,
      unit: { unitId: string } | { pricingUnit: "each" | "weight" },
    ) => {
      const { id } = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name,
        ...unit,
        unitPrice: "1.50",
        vatClass: "general",
      });
      await routeProductTo(tx, cfg, id, cocina.id);
      return id;
    };
    return {
      printerId,
      croqueta: await dish("Croqueta", { pricingUnit: "each" }),
      bomba: await dish("Bomba", { unitId: seededEach!.id }),
      pulpo: await dish("Pulpo", { pricingUnit: "weight" }),
      almendras: await dish("Almendras", { unitId: gram!.id }),
      pan: await dish("Pan", { unitId: lookAlike!.id }),
    };
  }

  it("leaves the unit out for a dish sold in Each, and keeps it for every other unit", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const jobs = await asApp(cfg, async (tx) => {
      const sold = await sellInEveryUnit(tx, cfg, catalogueId);
      await fireNewOrder(tx, cfg, [
        { productId: sold.croqueta, quantity: "2" },
        { productId: sold.bomba, quantity: "3" },
        { productId: sold.pulpo, quantity: "0.5" },
        { productId: sold.almendras, quantity: "200" },
        { productId: sold.pan, quantity: "1" },
      ]);
      return printJobsFor(tx);
    });

    expect(jobs).toHaveLength(1);
    const lines = printedLines(jobs[0]!.payload);
    expect(lines).toContain(`${thousandthsToDecimal(2000)} x Croqueta`);
    expect(lines).toContain(`${thousandthsToDecimal(3000)} x Bomba`);
    expect(lines).toContain(`${thousandthsToDecimal(500)} kg x Pulpo`);
    expect(lines).toContain(`${thousandthsToDecimal(200_000)} g x Almendras`);
    // Spelled like Each, but a unit of the venue's own: its abbreviation still prints.
    expect(lines).toContain(`${thousandthsToDecimal(1000)} ea x Pan`);
  });

  it("a correction slip also leaves out the Each unit", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const slips = await asApp(cfg, async (tx) => {
      const sold = await sellInEveryUnit(tx, cfg, catalogueId);
      const orderId = await fireNewOrder(tx, cfg, [
        { productId: sold.croqueta, quantity: "2" },
        { productId: sold.pulpo, quantity: "0.5" },
      ]);
      const fired = await tx
        .select({
          workingOrderLineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
          quantity: ticketItems.quantity,
        })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      const before = new Set((await printJobsFor(tx)).map((job) => job.id));
      await enqueueCorrectionSlips(
        tx,
        cfg,
        orderId,
        fired.map((item) => ({
          workingOrderLineId: item.workingOrderLineId,
          stationId: item.stationId!,
          quantity: item.quantity!,
          wasStarted: false,
        })),
        "VOID",
      );
      return (await printJobsFor(tx)).filter((job) => !before.has(job.id));
    });

    expect(slips).toHaveLength(2);
    const printed = slips.flatMap((slip) => printedLines(slip.payload));
    expect(printed).toContain(`${thousandthsToDecimal(2000)} x Croqueta`);
    expect(printed).toContain(`${thousandthsToDecimal(500)} kg x Pulpo`);
  });

  // Fails if merging and splitting go by the unit's spelling while the unit's printing goes by its
  // identity: Pan's unit is spelled like Each but is the venue's own, and Bomba's is Each renamed.
  const at = (thousandths: number, rest: string) => `${thousandthsToDecimal(thousandths)} ${rest}`;
  it.each([
    {
      grouping: "combined",
      dish: "pan",
      name: "Pan",
      sold: ["1", "1"],
      printed: [at(1000, "ea x Pan"), at(1000, "ea x Pan")],
    },
    {
      grouping: "separate",
      dish: "pan",
      name: "Pan",
      sold: ["2"],
      printed: [at(2000, "ea x Pan")],
    },
    {
      grouping: "combined",
      dish: "bomba",
      name: "Bomba",
      sold: ["1", "1"],
      printed: [at(2000, "x Bomba")],
    },
    {
      grouping: "separate",
      dish: "bomba",
      name: "Bomba",
      sold: ["2"],
      printed: [at(1000, "x Bomba"), at(1000, "x Bomba")],
    },
  ] as const)(
    "merges or splits an entry only when its unit does not print ($dish, $grouping)",
    async ({ grouping, dish, name, sold, printed }) => {
      const { cfg, catalogueId } = await setupVenue();
      const jobs = await asApp(cfg, async (tx) => {
        await writeKitchenTicketGrouping(tx, grouping);
        const dishes = await sellInEveryUnit(tx, cfg, catalogueId);
        await fireNewOrder(
          tx,
          cfg,
          sold.map((quantity) => ({ productId: dishes[dish], quantity })),
        );
        return printJobsFor(tx);
      });

      expect(jobs).toHaveLength(1);
      expect(printedLines(jobs[0]!.payload).filter((text) => text.endsWith(` x ${name}`))).toEqual(
        printed,
      );
    },
  );
});

describe("dish extras on kitchen tickets", () => {
  it("prints split chips once on Fryer paper and cross-references both station and watcher paper", async () => {
    const venue = await setupSplitExtrasVenue();
    const { cfg, products, lists, printers } = venue;
    const jobs = await asApp(cfg, async (tx) => {
      await fireNewOrder(tx, cfg, [
        {
          productId: products.burger,
          quantity: "1",
          extras: [
            {
              listId: lists.burger,
              picks: [
                { productId: products.chips, quantity: 1 },
                { productId: products.cheese, quantity: 1 },
              ],
            },
          ],
        },
      ]);
      return printJobsFor(tx);
    });
    const paper = (printerId: string) =>
      decodeTicket(jobs.find((job) => job.printerId === printerId)!.payload);
    expect(jobs.map((job) => job.printerId)).toEqual(
      expect.arrayContaining([printers.grill, printers.fryer, printers.pass]),
    );
    expect(paper(printers.grill)).toContain("1.000 x BURG");
    expect(paper(printers.grill)).toContain("+ Cheese");
    expect(paper(printers.grill)).toContain("> con CHIPS de Fryer");
    expect(paper(printers.grill)).not.toContain("+ Chips");
    expect(paper(printers.fryer)).toContain("1.000 x CHIPS");
    expect(
      printedLines(jobs.find((job) => job.printerId === printers.fryer)!.payload).filter((line) =>
        line.includes("x CHIPS"),
      ),
    ).toHaveLength(1);
    expect(paper(printers.fryer)).toContain("> para BURG en Grill");
    expect(paper(printers.pass)).toContain("> con CHIPS de Fryer");
    expect(paper(printers.pass)).toContain("> para BURG en Grill");
    expect(
      printedLines(jobs.find((job) => job.printerId === printers.pass)!.payload).filter((line) =>
        line.includes("x CHIPS"),
      ),
    ).toHaveLength(1);
    for (const job of jobs) {
      expect(decodeTicket(job.payload)).not.toContain("Patatas fritas");
      expect(decodeTicket(job.payload)).not.toContain("Hamburguesa clásica");
    }
  });

  it("keeps an unclaimed cheese as a modifier without a Fryer job", async () => {
    const { cfg, products, lists, printers } = await setupSplitExtrasVenue();
    const jobs = await asApp(cfg, async (tx) => {
      await fireNewOrder(tx, cfg, [
        {
          productId: products.burger,
          quantity: "1",
          extras: [{ listId: lists.burger, picks: [{ productId: products.cheese, quantity: 1 }] }],
        },
      ]);
      return printJobsFor(tx);
    });
    expect(jobs.some((job) => job.printerId === printers.fryer)).toBe(false);
    const paper = decodeTicket(jobs.find((job) => job.printerId === printers.grill)!.payload);
    expect(paper).toContain("+ Cheese");
    expect(paper).not.toContain("  > ");
  });

  it("names no preparation for a water's split chips", async () => {
    const { cfg, products, lists, printers } = await setupSplitExtrasVenue();
    const jobs = await asApp(cfg, async (tx) => {
      await fireNewOrder(tx, cfg, [
        {
          productId: products.water,
          quantity: "1",
          extras: [{ listId: lists.water, picks: [{ productId: products.chips, quantity: 1 }] }],
        },
      ]);
      return printJobsFor(tx);
    });
    expect(jobs.some((job) => job.printerId === printers.grill)).toBe(false);
    expect(decodeTicket(jobs.find((job) => job.printerId === printers.fryer)!.payload)).toContain(
      "> para AGUA, sin preparación",
    );
  });

  it("keeps the Fryer and Kitchen references on separate burger lines in a reprint", async () => {
    const { cfg, products, lists, printers, stations, tables, party } =
      await setupSplitExtrasVenue();
    const jobs = await asApp(cfg, async (tx) => {
      const pick = {
        menuItemId: tables.offerFor(products.burger),
        quantity: "1",
        extras: [{ listId: lists.burger, picks: [{ productId: products.chips, quantity: 1 }] }],
      };
      const orderId = party.tabId;
      await addTabRound(tx, cfg, orderId, [pick]);
      await setStationFallback(tx, cfg, stations.fryer, stations.kitchen);
      await setStationToday(tx, cfg, stations.fryer, "closed", new Date());
      await addTabRound(tx, cfg, orderId, [pick]);
      const before = new Set((await printJobsFor(tx)).map((job) => job.id));
      await reprintOrderTickets(tx, cfg, orderId);
      return (await printJobsFor(tx)).filter((job) => !before.has(job.id));
    });
    const grill = decodeTicket(jobs.find((job) => job.printerId === printers.grill)!.payload);
    expect(grill).toContain("> con CHIPS de Fryer");
    expect(grill).toContain("> con CHIPS de Kitchen");
    expect(
      printedLines(jobs.find((job) => job.printerId === printers.grill)!.payload).filter((line) =>
        line.includes("x BURG"),
      ),
    ).toHaveLength(2);
    expect(grill).not.toContain("2.000 x BURG");
  });

  it("keeps both references on the burger and chips VOID slips", async () => {
    const { cfg, products, lists, printers } = await setupSplitExtrasVenue();
    const jobs = await asApp(cfg, async (tx) => {
      const orderId = await fireNewOrder(tx, cfg, [
        {
          productId: products.burger,
          quantity: "1",
          extras: [{ listId: lists.burger, picks: [{ productId: products.chips, quantity: 1 }] }],
        },
      ]);
      const records = await tx
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
        records.map((record) => ({ ...record, quantity: 1000, wasStarted: false })),
        "VOID",
      );
      return (await printJobsFor(tx)).filter((job) => !before.has(job.id));
    });
    expect(decodeTicket(jobs.find((job) => job.printerId === printers.grill)!.payload)).toContain(
      "> con CHIPS de Fryer",
    );
    expect(decodeTicket(jobs.find((job) => job.printerId === printers.fryer)!.payload)).toContain(
      "> para BURG en Grill",
    );
  });

  it("prints held chips once at Fryer and only as a reference at Grill", async () => {
    const { cfg, products, lists, printers, party, tables } = await setupSplitExtrasVenue();
    const jobs = await asApp(cfg, async (tx) => {
      await writePrintHeldWork(tx, true);
      await placeGroups(tx, cfg, party.partyId, {
        operatorId: OPERATOR,
        groups: [
          {
            release: "hold",
            lines: [
              {
                menuItemId: tables.offerFor(products.burger),
                quantity: "1",
                extras: [
                  { listId: lists.burger, picks: [{ productId: products.chips, quantity: 1 }] },
                ],
              },
            ],
          },
        ],
      });
      return printJobsFor(tx);
    });
    const grill = decodeTicket(jobs.find((job) => job.printerId === printers.grill)!.payload);
    const fryer = decodeTicket(jobs.find((job) => job.printerId === printers.fryer)!.payload);
    expect(grill).toContain("*** HOLD ***");
    expect(grill).toContain("> con CHIPS de Fryer");
    expect(grill).not.toContain("+ Chips");
    expect(fryer).toContain("*** HOLD ***");
    expect(
      printedLines(jobs.find((job) => job.printerId === printers.fryer)!.payload).filter((line) =>
        line.includes("x CHIPS"),
      ),
    ).toHaveLength(1);
    expect(fryer).toContain("> para BURG en Grill");
  });

  it("keeps two unclaimed extras on their dish's one kitchen record", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { orderId, parentLineId, ticketItemRows } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      // Neither extra has a claim, so both follow their dish instead of the default.
      const cortado = await makeProduct(tx, cfg, catalogueId, "Cortado", { stationId: cocina.id });
      const { listId, productIds } = await addExtras(
        tx,
        cfg,
        catalogueId,
        cortado,
        [{ name: "Nata" }, { name: "Leche avena" }],
        { staffNameOnly: true },
      );

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
      const printerId = await makePrinter(tx, cfg, "Cocina printer");
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
    expect(ticket).not.toContain("Nata montada");
    expect(ticket).not.toContain("Bebida de avena");
    expect(ticket.indexOf("Cortado")).toBeLessThan(ticket.indexOf("+ Nata"));
    expect(ticket.indexOf("Cortado")).toBeLessThan(ticket.indexOf("+ Leche avena"));
  });

  it("prints the line's note as a sub-line on the kitchen ticket (order-line customisation)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { printerId, jobs } = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer");
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
      const printerId = await makePrinter(tx, cfg, "Cocina printer");
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      const cortado = await makeProduct(tx, cfg, catalogueId, "Cortado", { stationId: cocina.id });
      const { listId, productIds } = await addExtras(
        tx,
        cfg,
        catalogueId,
        cortado,
        [
          { name: "Nata", maxQuantity: 3 }, // a per-dish cap of 3 admits a ×2
          { name: "Leche avena" }, // single pick (cap 1)
        ],
        { staffNameOnly: true },
      );
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

  it("lets an unclaimed extra follow its dish when no default station is on", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { stationId, ticketItemRows } = await asApp(cfg, async (tx) => {
      const barra = await createStation(tx, cfg, { name: "Barra", isDefault: false });
      const cafe = await makeProduct(tx, cfg, catalogueId, "Cafe", { stationId: barra.id });
      const { productIds } = await addExtras(tx, cfg, catalogueId, cafe, [{ name: "Nata" }], {
        staffNameOnly: true,
      });

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
      const pStation = await makePrinter(tx, cfg, "Cocina printer");
      const pGroup = await makeWatcherPrinter(tx, cfg, "Pase", [cocina.id]);
      await attachPrinterToStation(tx, {
        stationId: cocina.id,
        printerId: pStation,
      });
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
      await fireCourse(tx, cfg, orderId, pri.id, OPERATOR);
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
      const printerId = await makePrinter(tx, cfg, "Cocina printer");
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
      await fireCourse(tx, cfg, orderId, pri.id, OPERATOR);
      const released = (await printJobsFor(tx)).filter((job) => !beforeRelease.has(job.id));
      const beforeReprint = new Set((await printJobsFor(tx)).map((job) => job.id));
      await reprintOrderTickets(tx, cfg, orderId);
      const reprinted = (await printJobsFor(tx)).filter((job) => !beforeReprint.has(job.id));
      return { released, reprinted };
    });

    expect(released).toHaveLength(1);
    expect(decodeTicket(released[0]!.payload)).toContain(
      `${thousandthsToDecimal(2000)} x Chuleton`,
    );
    expect(reprinted).toHaveLength(1);
    const reprint = decodeTicket(reprinted[0]!.payload);
    expect(reprint).toContain(`${thousandthsToDecimal(3000)} x Sopa`);
    expect(reprint).toContain(`${thousandthsToDecimal(2000)} x Chuleton`);
  });

  it("enqueues nothing (and does NOT throw) for an order with no fired items", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const jobs = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const printerId = await makePrinter(tx, cfg, "Cocina printer");
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
    const printerId = await makePrinter(tx, cfg, "Kitchen printer");
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
    const printerId = await makePrinter(tx, cfg, "Kitchen printer");
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
    await routeProductTo(tx, cfg, productId, station.id);
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

describe("the table a slip names (spec decision 9)", () => {
  it("names every table of the party, in the order they joined", async () => {
    const v = await setupPartyVenue(db);
    // Joined Mesa 5 first: sorting by id or by label would both put Mesa 4 first.
    const mesa4 = await tableAt(v, `00000000-${randomUUID().slice(9)}`, "Mesa 4");
    const mesa5 = await tableAt(v, `ffffffff-${randomUUID().slice(9)}`, "Mesa 5");
    const { partyId, tabId } = await seat(v, mesa5);
    await join(v, partyId, mesa4);
    await orderForParty(v, partyId, ["Burger"], tabId);

    expect(await inTx(v, (tx) => orderTableLabel(tx, v.cfg, tabId))).toBe("Mesa 5, 4");
  });

  it("names the party's tables on a bill split from the tab, not the label it was split with", async () => {
    const v = await setupPartyVenue(db);
    const mesa4 = await v.table("Mesa 4");
    const mesa5 = await v.table("Mesa 5");
    const { partyId, tabId } = await seat(v, mesa4);
    await orderForParty(v, partyId, ["Burger", "Vino"], tabId);
    const checkId = await split(v, partyId, tabId, [2]);
    await join(v, partyId, mesa5);

    expect((await billRow(v, checkId)).label).toBe("Mesa 4");
    expect(await inTx(v, (tx) => orderTableLabel(tx, v.cfg, checkId))).toBe("Mesa 4, 5");
  });

  it("copies the party's tables, not its name, as a split bill's own label", async () => {
    const v = await setupPartyVenue(db);
    const mesa4 = await v.table("Mesa 4");
    const mesa5 = await v.table("Mesa 5");
    const { partyId, tabId } = await seat(v, mesa4);
    await join(v, partyId, mesa5);
    await nameParty(v, partyId, "Ana");
    await orderForParty(v, partyId, ["Burger", "Vino"], tabId);

    const checkId = await split(v, partyId, tabId, [2]);

    expect((await billRow(v, checkId)).label).toBe("Mesa 4, 5");
  });

  it("names a bill by its own label once its party holds no table", async () => {
    const v = await setupPartyVenue(db);
    const mesa4 = await v.table("Mesa 4");
    const { partyId, tabId } = await seat(v, mesa4);
    await orderForParty(v, partyId, ["Burger", "Vino"], tabId);
    const checkId = await split(v, partyId, tabId, [2]);
    await inTx(v, async (tx) => {
      await tx
        .update(partyTables)
        .set({ leftAt: nowIso() })
        .where(eq(partyTables.partyId, partyId));
      await tx.update(workingOrders).set({ label: "Ana" }).where(eq(workingOrders.id, checkId));
    });

    expect(await inTx(v, (tx) => orderTableLabel(tx, v.cfg, checkId))).toBe("Ana");
  });

  it("names a counter order's delivery table, and an unlabelled walk-up nothing", async () => {
    const v = await setupPartyVenue(db);
    const terraza = await v.table("Terraza 2");
    const [delivered, walkUp] = [randomUUID(), randomUUID()];
    await inTx(v, async (tx) => {
      await createOpenOrder(tx, v.cfg, delivered, [], null, { deliveryTableId: terraza });
      await createOpenOrder(tx, v.cfg, walkUp, [], null);
    });

    expect(await inTx(v, (tx) => orderTableLabel(tx, v.cfg, delivered))).toBe("Terraza 2");
    expect(await inTx(v, (tx) => orderTableLabel(tx, v.cfg, walkUp))).toBeNull();
  });
});
