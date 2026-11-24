import { seedPerson } from "@waitron/db/testing/seed.js";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { fireTableKitchenOrder } from "./testing/kitchen-table-order.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  diningTables,
  kitchenPrintJobs,
  nowIso,
  orderGroups,
  parties,
  printers,
  ticketItems,
  workingOrderLines,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { updatePrinter, endDeletedPrinterJobs } from "@waitron/printing";
import type { OriginConfig } from "./trading-context.js";
import { createCourse, createStation, updateStation } from "./kitchen.js";
import { fireOrderLines } from "./working-order-kitchen-service.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { recordHeldPaper } from "./order-group-hold-paper.js";
import { attachPrinterToStation } from "./station-printers.js";
import { ordersWithPrintProblem } from "./kitchen-ticket-problems.js";
import { reprintOrderTickets } from "./kitchen-ticket-reprint.js";
import { enqueueCorrectionSlips } from "./kitchen-ticket-corrections.js";
import { enqueueKitchenTickets } from "./kitchen-ticket-enqueue.js";
import { deletePrinter } from "./printer-delete.js";
import { JOBS_WAITING_MS } from "./print-job-trouble.js";
import { decodeTicket, printedCommands, printedLines } from "./testing/decode-ticket.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";
import {
  setupVenue,
  fireNewOrder,
  createOfferedOrder,
  useSplitExtrasDb,
  setupSplitExtrasVenue,
} from "./testing/split-extras-venue.js";
import { openPartyTab } from "./testing/serve-line.js";
import {
  bindKitchenPrintDb,
  useKitchenPrintDb,
  db,
  OPERATOR,
  LOCALE,
  asApp,
  printJobsFor,
  line,
  makeProduct,
  makePrinter,
  makeSharedPrinter,
} from "./testing/kitchen-print.test-support.js";

const suite = useKitchenPrintDb();
beforeAll(() => {
  bindKitchenPrintDb(suite.db);
  useSplitExtrasDb(db);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterEach(async () => {
  await suite.db.execute(sql`delete from print_jobs`);
});

/** The dot widths of a payload's drawn lines of text. */
function lineWidths(payload: Uint8Array): Set<number> {
  return new Set(
    printedCommands(payload)
      .filter((command) => command.text !== undefined)
      .map((command) => command.widthDots!),
  );
}

describe("show the rest of the order", () => {
  it("adds other stations only to an enabled station ticket and refreshes the list on reprint", async () => {
    const { cfg } = await setupVenue();
    const result = await asApp(async (tx) => {
      const grill = await createStation(tx, { name: "Grill", isDefault: true });
      const fryer = await createStation(tx, { name: "Fryer" });
      const cold = await createStation(tx, { name: "Cold" });
      await updateStation(tx, grill.id, { showsRestOfOrder: true });
      const grillPrinter = await makePrinter(tx, "Grill printer");
      const fryerPrinter = await makePrinter(tx, "Fryer printer");
      const passPrinter = await makeSharedPrinter(tx, "Pass", [grill.id, fryer.id]);
      await attachPrinterToStation(tx, {
        stationId: grill.id,
        printerId: grillPrinter,
      });
      await attachPrinterToStation(tx, {
        stationId: fryer.id,
        printerId: fryerPrinter,
      });
      const burger = await makeProduct(tx, "Burger", { stationId: grill.id });
      const chips = await makeProduct(tx, "Chips", { stationId: fryer.id });
      const salad = await makeProduct(tx, "Salad", { stationId: cold.id });
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
        takeawayVatClass: "general",
        lineTotal: 150,
      });
      await tx.insert(ticketItems).values({
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
        takeawayVatClass: "general",
        lineTotal: 100,
      });
      await seedPerson(tx, { id: OPERATOR });
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
      const pastry = await createStation(tx, { name: "Pastry" });
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
          takeawayVatClass: "general",
          lineTotal: 100,
          groupId: group!.id,
        });
        await tx.insert(ticketItems).values({
          workingOrderLineId: id,
          stationId,
          state: "queued",
          firedAt: null,
          quantity: 1000,
        });
      };
      await held("Steak", grill.id, 5);
      await held("Dessert", pastry.id, 6);
      await recordHeldPaper(tx, group!.id, new Set([grill.id, pastry.id]));
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
        .set({ servedAt: nowIso(), servedQuantity: 1000 })
        .where(eq(workingOrderLines.id, chipsLine!.id));
      const beforeServed = new Set((await printJobsFor(tx)).map((job) => job.id));
      await reprintOrderTickets(tx, cfg, orderId);
      const served = (await printJobsFor(tx)).filter((job) => !beforeServed.has(job.id));
      await tx
        .update(workingOrderLines)
        .set({ servedAt: null, servedQuantity: 0 })
        .where(eq(workingOrderLines.id, chipsLine!.id));
      const beforeAway = new Set((await printJobsFor(tx)).map((job) => job.id));
      await reprintOrderTickets(tx, cfg, orderId);
      const away = (await printJobsFor(tx)).filter((job) => !beforeAway.has(job.id));
      return { first, later, reprinted, served, away, grillPrinter, fryerPrinter, passPrinter };
    });
    const firstAt = (id: string) =>
      printedLines(result.first.find((job) => job.printerId === id)!.payload);
    expect(firstAt(result.grillPrinter).join(" ")).toContain(kitchenTicketWords("en").alsoOnOrder);
    expect(firstAt(result.grillPrinter)).toContain(`1 x Chips — Fryer`);
    expect(firstAt(result.fryerPrinter).join(" ")).not.toContain(
      kitchenTicketWords("en").alsoOnOrder,
    );
    expect(firstAt(result.passPrinter).join(" ")).not.toContain(
      kitchenTicketWords("en").alsoOnOrder,
    );
    expect(result.later.some((job) => job.printerId === result.grillPrinter)).toBe(false);
    const grillReprint = printedLines(
      result.reprinted.find((job) => job.printerId === result.grillPrinter)!.payload,
    );
    expect(grillReprint).toContain(`1 x Chips — Fryer`);
    expect(grillReprint).toContain(`1 x Salad — Cold`);
    expect(grillReprint).toContain(`1 x Dessert — Pastry ${kitchenTicketWords("en").onHold}`);
    expect(grillReprint.join(" ").match(/Also on this order/g)).toHaveLength(1);
    expect(grillReprint.filter((entry) => entry.includes("Chips — Fryer"))).toHaveLength(1);
    expect(grillReprint.join(" ")).not.toContain("Water");
    for (const jobs of [result.served, result.away]) {
      const grillText = decodeTicket(
        jobs.find((job) => job.printerId === result.grillPrinter)!.payload,
      );
      if (jobs === result.served) expect(grillText).not.toContain("Chips — Fryer");
      else expect(grillText).toContain("Chips — Fryer");
      expect(grillText).toContain("Salad — Cold");
    }
  });
});

/** Every outbound TCP open goes through `Socket.prototype.connect`. */
function spyOnNoSocketOpened() {
  return vi.spyOn(
    net.Socket.prototype as unknown as { connect: (...args: unknown[]) => unknown },
    "connect",
  );
}

describe("print-on-fire (enqueueKitchenTickets wired into fireLines / fireOrderLines)", () => {
  it("heads no group on the ticket of an order whose lines are in no group", async () => {
    const { cfg } = await setupVenue();
    const { kitchenPrinterId, pGroup, jobs } = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const kitchenPrinterId = await makePrinter(tx, "Kitchen printer");
      const pGroup = await makeSharedPrinter(tx, "Pass", [kitchenStation.id]);
      await attachPrinterToStation(tx, {
        stationId: kitchenStation.id,
        printerId: kitchenPrinterId,
      });
      const steak = await makeProduct(tx, "Ribeye", {
        stationId: kitchenStation.id,
      });

      await fireNewOrder(tx, cfg, [line(steak)]);
      return { kitchenPrinterId, pGroup, jobs: await printJobsFor(tx) };
    });

    for (const printerId of [kitchenPrinterId, pGroup]) {
      const printed = jobs.filter((j) => j.printerId === printerId);
      expect(printed).toHaveLength(1);
      expect(decodeTicket(printed[0]!.payload)).toContain("Ribeye");
      expect(decodeTicket(printed[0]!.payload)).not.toContain("GROUP");
    }
  });

  it("never opens a socket on fire, queues its jobs, and enqueues nothing to an inactive printer", async () => {
    const { cfg } = await setupVenue();
    const connectSpy = spyOnNoSocketOpened();
    const { pActive, pDead, jobs } = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const barStation = await createStation(tx, { name: "Bar" });
      const pActive = await makePrinter(tx, "Kitchen printer");
      const pDead = await makePrinter(tx, "Bar printer");
      await attachPrinterToStation(tx, {
        stationId: kitchenStation.id,
        printerId: pActive,
      });
      await attachPrinterToStation(tx, {
        stationId: barStation.id,
        printerId: pDead,
      });
      // Deactivated after attaching (attach requires a live printer): `enqueuePrintJob` would throw
      // `printer.not_found` for it, so it must never be handed this id.
      await updatePrinter(tx, pDead, { active: false });
      const steak = await makeProduct(tx, "Ribeye", {
        stationId: kitchenStation.id,
      });
      const beer = await makeProduct(tx, "Beer", { stationId: barStation.id });

      await fireNewOrder(tx, cfg, [line(steak), line(beer)]);
      return { pActive, pDead, jobs: await printJobsFor(tx) };
    });

    expect(connectSpy).not.toHaveBeenCalled();

    const activeJobs = jobs.filter((j) => j.printerId === pActive);
    expect(activeJobs).toHaveLength(1);
    expect(activeJobs[0]!.status).toBe("queued");
    expect(jobs.filter((j) => j.printerId === pDead)).toHaveLength(0);
  });

  it("a later line release prints only round-2 items and never reprints round 1", async () => {
    const { cfg } = await setupVenue();
    const { printerId, afterRound1, afterRound2, afterRefire } = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const printerId = await makePrinter(tx, "Kitchen printer");
      await attachPrinterToStation(tx, {
        stationId: kitchenStation.id,
        printerId,
      });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const soup = await makeProduct(tx, "Soup", {
        stationId: kitchenStation.id,
        courseId: starterCourse.id,
      });
      const steak = await makeProduct(tx, "Ribeye", {
        stationId: kitchenStation.id,
        courseId: mainCourse.id,
      });

      // Round 1: firing auto-fires the earliest course (Starters) and HOLDS the later one (steak).
      const orderId = await fireTableKitchenOrder(tx, cfg, [line(soup), line(steak)]);
      const afterRound1 = await printJobsFor(tx);
      const [held] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(
          and(
            eq(workingOrderLines.workingOrderId, orderId),
            eq(workingOrderLines.productId, steak),
          ),
        );
      const [beforeRelease] = await tx
        .select({ firedAt: ticketItems.firedAt })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, held!.id));
      expect(beforeRelease!.firedAt).toBeNull();
      await fireOrderLines(tx, cfg, orderId, [held!.id]);
      const afterRound2 = await printJobsFor(tx);
      // Releasing an already-fired line matches zero rows.
      await fireOrderLines(tx, cfg, orderId, [held!.id]);
      const afterRefire = await printJobsFor(tx);
      return { printerId, afterRound1, afterRound2, afterRefire };
    });

    const jobsFor = (rows: { printerId: string }[]) =>
      rows.filter((j) => j.printerId === printerId);

    // Round 1: one ticket, the soup only — the steak is held, so it is NOT printed yet.
    expect(jobsFor(afterRound1)).toHaveLength(1);
    const round1Ticket = decodeTicket(afterRound1[0]!.payload);
    expect(round1Ticket).toContain("Soup");
    expect(round1Ticket).not.toContain("Ribeye");

    // Round 2: the new job carries the steak only; round 1's soup is not reprinted.
    expect(jobsFor(afterRound2)).toHaveLength(2);
    const round1Ids = new Set(afterRound1.map((j) => j.id));
    const round2New = afterRound2.filter((j) => !round1Ids.has(j.id));
    expect(round2New).toHaveLength(1);
    expect(decodeTicket(round2New[0]!.payload)).toContain("Ribeye");
    expect(decodeTicket(round2New[0]!.payload)).not.toContain("Soup");

    expect(jobsFor(afterRefire)).toHaveLength(2);
  });

  it("stamps the dining-table label and falls back to the venue language when the till locale is absent", async () => {
    const { cfg } = await setupVenue();
    // A till whose UI locale is NOT among the venue's invoice locales — name resolution must fall back to
    // the venue-language description rather than a blank line.
    const foreignCfg: OriginConfig = { ...cfg, locale: "de-DE" };
    const { printerId, jobs } = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const printerId = await makePrinter(tx, "Kitchen printer");
      await attachPrinterToStation(tx, {
        stationId: kitchenStation.id,
        printerId,
      });
      const drink = await makeProduct(tx, "Milky coffee", {
        stationId: kitchenStation.id,
      });
      // A tab bound to a dining table → the order carries the table label the ticket header prints.
      const offers = await offerProducts(tx, { zone: "tables" });
      const [table] = await tx
        .insert(diningTables)
        .values({ label: "Table 5", zoneId: offers.zoneId })
        .returning({ id: diningTables.id });
      await tx.update(diningTables).set({ onFloor: true }).where(eq(diningTables.id, table!.id));
      const { tabId } = await openPartyTab(tx, cfg, { tableId: table!.id });
      await addTabRound(tx, foreignCfg, tabId, offers.toOfferLines([line(drink)]));
      return { printerId, jobs: await printJobsFor(tx) };
    });

    const stationJobs = jobs.filter((j) => j.printerId === printerId);
    expect(stationJobs).toHaveLength(1);
    const ticket = decodeTicket(stationJobs[0]!.payload);
    expect(ticket).toContain("Table 5"); // the dining-table label on the header
    expect(ticket).toContain("Milky coffee"); // venue-language fallback (de-DE absent → the es-ES value)
  });

  it("enqueues no print jobs when the fire transaction rolls back (same-tx atomicity)", async () => {
    const { cfg } = await setupVenue();
    const setup = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const printerId = await makePrinter(tx, "Kitchen printer");
      await attachPrinterToStation(tx, {
        stationId: kitchenStation.id,
        printerId,
      });
      const steak = await makeProduct(tx, "Ribeye", {
        stationId: kitchenStation.id,
      });
      return { printerId, steak };
    });

    // The fire's ticket items and its enqueued jobs roll back together.
    await expect(
      asApp(async (tx) => {
        await fireNewOrder(tx, cfg, [line(setup.steak)]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const jobs = await asApp((tx) => printJobsFor(tx));
    expect(jobs).toHaveLength(0);
  });

  it("resolves the table label via the counter-delivery delivery_table_id direction", async () => {
    // The seated-tab direction of the table label is tested above; this pins the counter-delivery one.
    const { cfg } = await setupVenue();
    const { printerId, jobs } = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const printerId = await makePrinter(tx, "Kitchen printer");
      await attachPrinterToStation(tx, {
        stationId: kitchenStation.id,
        printerId,
      });
      const drink = await makeProduct(tx, "Orange juice", {
        stationId: kitchenStation.id,
      });
      const orderId = randomUUID();
      await createOfferedOrder(tx, cfg, orderId, [line(drink)]);
      const [table] = await tx
        .insert(diningTables)
        .values({
          label: "Bar 3",
          zoneId: (await offerProducts(tx)).zoneId,
        })
        .returning({ id: diningTables.id });
      await tx.update(diningTables).set({ onFloor: true }).where(eq(diningTables.id, table!.id));
      await tx.execute(sql`
        update working_orders set delivery_table_id = ${table!.id} where id = ${orderId}`);
      const [lineRow] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      await enqueueKitchenTickets(tx, cfg, orderId, [
        { workingOrderLineId: lineRow!.id, stationId: kitchenStation.id },
      ]);
      return { printerId, jobs: await printJobsFor(tx) };
    });

    const stationJobs = jobs.filter((j) => j.printerId === printerId);
    expect(stationJobs).toHaveLength(1);
    expect(decodeTicket(stationJobs[0]!.payload)).toContain("Bar 3");
  });

  it("returns early after the single mapping read when the involved stations have NO attached printer", async () => {
    // Zero jobs would hold whether or not the detail reads ran, so the select count is what pins the
    // early return.
    const { cfg } = await setupVenue();
    const { selectCalls, jobs } = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const dish = await makeProduct(tx, "Omelette", {
        stationId: kitchenStation.id,
      });
      const orderId = randomUUID();
      await createOfferedOrder(tx, cfg, orderId, [line(dish)]);
      const [lineRow] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      const selectSpy = vi.spyOn(tx, "select");
      await enqueueKitchenTickets(tx, cfg, orderId, [
        { workingOrderLineId: lineRow!.id, stationId: kitchenStation.id },
      ]);
      const selectCalls = selectSpy.mock.calls.length;
      selectSpy.mockRestore();
      return { selectCalls, jobs: await printJobsFor(tx) };
    });

    expect(jobs).toHaveLength(0);
    expect(selectCalls).toBe(1);
  });

  it("reads for a second printer of the station only that printer's own check", async () => {
    // Each queued job checks its printer; the venue id the jobs are filed under is read once a send.
    const { cfg } = await setupVenue();
    const reads = await asApp(async (tx) => {
      async function readsOfSend(name: string, printerCount: number): Promise<number> {
        const station = await createStation(tx, { name });
        for (let n = 0; n < printerCount; n += 1) {
          await attachPrinterToStation(tx, {
            stationId: station.id,
            printerId: await makePrinter(tx, `${name} ${n}`),
          });
        }
        const dish = await makeProduct(tx, `${name} dish`, {
          stationId: station.id,
        });
        const orderId = randomUUID();
        await createOfferedOrder(tx, cfg, orderId, [line(dish)]);
        const [lineRow] = await tx
          .select({ id: workingOrderLines.id })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, orderId));
        const before = (await printJobsFor(tx)).length;
        const selectSpy = vi.spyOn(tx, "select");
        await enqueueKitchenTickets(tx, cfg, orderId, [
          { workingOrderLineId: lineRow!.id, stationId: station.id },
        ]);
        const calls = selectSpy.mock.calls.length;
        selectSpy.mockRestore();
        expect((await printJobsFor(tx)).length - before).toBe(printerCount);
        return calls;
      }
      return { one: await readsOfSend("Grill", 1), two: await readsOfSend("Fryer", 2) };
    });

    expect(reads.two - reads.one).toBe(1);
  });

  it("builds one kitchen ticket per distinct paper width and resolution among the printers", async () => {
    const { cfg } = await setupVenue();
    const ids = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const wide = await makePrinter(tx, "Kitchen 80 A");
      const wideTwin = await makePrinter(tx, "Kitchen 80 B");
      const narrow = await makePrinter(tx, "Kitchen 58");
      await updatePrinter(tx, narrow, { paperWidth: "58mm" });
      const pass = await makeSharedPrinter(tx, "Pass 180", [kitchenStation.id]);
      const pass203 = await makeSharedPrinter(tx, "Pass 203", [kitchenStation.id]);
      await updatePrinter(tx, pass203, { resolution: "203dpi" });
      for (const printerId of [wide, wideTwin, narrow]) {
        await attachPrinterToStation(tx, {
          stationId: kitchenStation.id,
          printerId,
        });
      }
      const steak = await makeProduct(tx, "Dry-aged beef rib from the wood fire", {
        stationId: kitchenStation.id,
      });
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
      "Dry-aged beef rib from the wood fire",
    );
    expect(payloadOf(ids.pass203).equals(payloadOf(ids.pass))).toBe(false);
    expect(lineWidths(payloadOf(ids.pass))).toEqual(new Set([512]));
    expect(lineWidths(payloadOf(ids.pass203))).toEqual(new Set([576]));
  });

  it("draws the next ticket at the paper width and resolution the printer was changed to", async () => {
    const { cfg } = await setupVenue();
    const widths = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const printerId = await makePrinter(tx, "Kitchen");
      await attachPrinterToStation(tx, {
        stationId: kitchenStation.id,
        printerId,
      });
      const steak = await makeProduct(tx, "Steak", {
        stationId: kitchenStation.id,
      });
      const seen = new Set<string>();
      const nextTicketWidths = async (): Promise<number[]> => {
        await fireNewOrder(tx, cfg, [line(steak)]);
        const fresh = (await printJobsFor(tx)).filter((job) => !seen.has(job.id));
        for (const job of fresh) seen.add(job.id);
        expect(fresh).toHaveLength(1);
        return [...lineWidths(fresh[0]!.payload)];
      };
      const before = await nextTicketWidths();
      await updatePrinter(tx, printerId, { paperWidth: "58mm" });
      const narrowed = await nextTicketWidths();
      await updatePrinter(tx, printerId, { resolution: "203dpi" });
      const finer = await nextTicketWidths();
      return [before, narrowed, finer];
    });
    expect(widths).toEqual([[512], [360], [384]]);
  });

  it("builds a correction slip once per distinct layout among the line's printers", async () => {
    const { cfg } = await setupVenue();
    const result = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const wide = await makePrinter(tx, "Kitchen 80");
      const narrow = await makePrinter(tx, "Kitchen 58");
      await updatePrinter(tx, narrow, { paperWidth: "58mm" });
      for (const printerId of [wide, narrow]) {
        await attachPrinterToStation(tx, {
          stationId: kitchenStation.id,
          printerId,
        });
      }
      const steak = await makeProduct(tx, "Dry-aged beef rib from the wood fire", {
        stationId: kitchenStation.id,
      });
      const orderId = await fireNewOrder(tx, cfg, [line(steak)]);
      const fired = await tx
        .select({
          workingOrderLineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
        })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, orderId));
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

describe("a station printer that was deleted", () => {
  async function stationWithTwo(tx: Transaction, cfg: OriginConfig) {
    const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
    const p = await makePrinter(tx, "Old kitchen");
    const q = await makePrinter(tx, "Kitchen Q");
    await attachPrinterToStation(tx, {
      stationId: kitchenStation.id,
      printerId: p,
    });
    await attachPrinterToStation(tx, {
      stationId: kitchenStation.id,
      printerId: q,
    });
    const steak = await makeProduct(tx, "Ribeye", {
      stationId: kitchenStation.id,
    });
    const orderId = await fireNewOrder(tx, cfg, [line(steak)]);
    return { kitchenStation, p, q, steak, orderId };
  }

  it("leaves fire, correction and reprint printing on the station's other printer only", async () => {
    const { cfg } = await setupVenue();
    const { p, q, fired, reprinted, corrected, problems, before } = await asApp(async (tx) => {
      const { kitchenStation, p, q, steak, orderId } = await stationWithTwo(tx, cfg);
      await deletePrinter(tx, p);
      const before = await printJobsFor(tx);
      const known = new Set(before.map((job) => job.id));
      const fresh = async () => {
        const jobs = (await printJobsFor(tx)).filter((job) => !known.has(job.id));
        for (const job of jobs) known.add(job.id);
        return jobs.map((job) => job.printerId);
      };
      await fireNewOrder(tx, cfg, [line(steak)]);
      const fired = await fresh();
      await reprintOrderTickets(tx, cfg, orderId);
      const reprinted = await fresh();
      const [item] = await tx
        .select({
          workingOrderLineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
        })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, orderId));
      await enqueueCorrectionSlips(
        tx,
        cfg,
        orderId,
        [{ ...item!, stationId: item!.stationId!, quantity: 1000, wasStarted: false }],
        "RECALLED",
      );
      const corrected = await fresh();
      const problems = await ordersWithPrintProblem(tx, kitchenStation.id, [orderId], new Date());
      return { p, q, fired, reprinted, corrected, problems, before };
    });

    expect(fired).toEqual([q]);
    expect(reprinted).toEqual([q]);
    expect(corrected).toEqual([q]);
    expect(problems).toEqual(new Set());
    // P's own ticket stays in history, ended.
    expect(before.filter((job) => job.printerId === p).map((job) => job.status)).toEqual([
      "failed",
    ]);
  });

  it("leaves a fire with no output, and no problem, when the deleted printer was the station's only one, keeping its ticket's link", async () => {
    const { cfg } = await setupVenue();
    const { orderId, added, problemsBefore, problems, linksBefore, linksAfter } = await asApp(
      async (tx) => {
        const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
        const p = await makePrinter(tx, "Old kitchen");
        await attachPrinterToStation(tx, {
          stationId: kitchenStation.id,
          printerId: p,
        });
        const steak = await makeProduct(tx, "Ribeye", {
          stationId: kitchenStation.id,
        });
        const orderId = await fireNewOrder(tx, cfg, [line(steak)]);
        // Past the waiting window, so P's unprinted ticket is a printing problem before the delete.
        const later = new Date(Date.now() + JOBS_WAITING_MS + 60_000);
        const problemsBefore = await ordersWithPrintProblem(
          tx,
          kitchenStation.id,
          [orderId],
          later,
        );
        const links = () =>
          tx.select().from(kitchenPrintJobs).where(eq(kitchenPrintJobs.workingOrderId, orderId));
        const linksBefore = await links();
        await deletePrinter(tx, p);
        const count = (await printJobsFor(tx)).length;
        await reprintOrderTickets(tx, cfg, orderId);
        await fireNewOrder(tx, cfg, [line(steak)]);
        return {
          orderId,
          added: (await printJobsFor(tx)).length - count,
          problemsBefore,
          problems: await ordersWithPrintProblem(tx, kitchenStation.id, [orderId], later),
          linksBefore,
          linksAfter: await links(),
        };
      },
    );
    expect(problemsBefore).toEqual(new Set([orderId]));
    expect(added).toBe(0);
    expect(problems).toEqual(new Set());
    expect(linksBefore).toHaveLength(1);
    expect(linksAfter).toEqual(linksBefore);
  });

  it.each([
    ["on the station's other printer", true],
    ["nowhere at that station when it was the only one", false],
  ] as const)("prints a HOLD ticket %s", async (_label, withOther) => {
    const {
      cfg,
      products,
      tables,
      party,
      stations,
      printers: venuePrinters,
    } = await setupSplitExtrasVenue();
    const { added, q } = await asApp(async (tx) => {
      const q = withOther ? await makePrinter(tx, "Grill Q") : null;
      if (q !== null)
        await attachPrinterToStation(tx, {
          stationId: stations.grill,
          printerId: q,
        });
      await deletePrinter(tx, venuePrinters.grill);
      await setStationPrinting(tx, { printHeldWork: true });
      const known = new Set((await printJobsFor(tx)).map((job) => job.id));
      await placeGroups(tx, cfg, party.partyId, {
        operatorId: OPERATOR,
        groups: [
          {
            release: "hold",
            lines: [{ menuItemId: tables.offerFor(products.burger), quantity: "1", extras: [] }],
          },
        ],
      });
      return { added: (await printJobsFor(tx)).filter((job) => !known.has(job.id)), q };
    });
    expect(added.filter((job) => job.printerId === venuePrinters.grill)).toEqual([]);
    const onQ = added.filter((job) => job.printerId === q);
    expect(onQ).toHaveLength(withOther ? 1 : 0);
    if (withOther) expect(decodeTicket(onQ[0]!.payload)).toContain("*** HOLD ***");
  });

  it("raises no printing problem for a deleted printer even while a station link to it is still stored", async () => {
    const { cfg } = await setupVenue();
    const problems = await asApp(async (tx) => {
      const { kitchenStation, p, orderId } = await stationWithTwo(tx, cfg);
      // Only the tombstone and its ended jobs: a real delete removes the link too, so this pins
      // the switched-off-inclusive read's own guard.
      await endDeletedPrinterJobs(tx, p);
      await tx
        .update(printers)
        .set({ active: false, deletedAt: new Date().toISOString() })
        .where(eq(printers.id, p));
      return ordersWithPrintProblem(tx, kitchenStation.id, [orderId], new Date());
    });
    expect(problems).toEqual(new Set());
  });
});
