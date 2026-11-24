import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { addGroupedTabRound } from "./testing/order-writer-fixture.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  diningTables,
  kitchenPrintJobLines,
  kitchenPrintJobs,
  ticketItems,
  workingOrderLines,
} from "@waitron/db";
import { updatePrinter } from "@waitron/printing";
import { createStation } from "./kitchen.js";
import { listStationNotices } from "@waitron/venue-service";
import { attachPrinterToStation } from "./station-printers.js";
import { enqueueCorrectionSlips, enqueueStationMoved } from "./kitchen-ticket-corrections.js";
import { enqueueKitchenTickets } from "./kitchen-ticket-enqueue.js";
import { decodeTicket, printedLines } from "./testing/decode-ticket.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";
import {
  setupVenue,
  fireNewOrder,
  createOfferedOrder,
  useSplitExtrasDb,
} from "./testing/split-extras-venue.js";
import { openPartyTab } from "./testing/serve-line.js";
import { cancelLine } from "./testing/cancel-line.js";
import {
  bindKitchenPrintDb,
  useKitchenPrintDb,
  db,
  asApp,
  printJobsFor,
  line,
  makeProduct,
  makePrinter,
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

describe("paper for a move to another station", () => {
  it.each([
    ["fired", false, false],
    ["held", true, false],
    ["printer off", false, true],
  ] as const)(
    "records the reroute and corrects %s work at the old station",
    async (_case, held, printerOff) => {
      const { cfg } = await setupVenue();
      const result = await asApp(async (tx) => {
        const bar = await createStation(tx, { name: "Bar", isDefault: true });
        const grill = await createStation(tx, { name: "Grill", isDefault: false });
        const barPrinter = await makePrinter(tx, "Bar printer");
        const grillPrinter = await makePrinter(tx, "Grill printer");
        await attachPrinterToStation(tx, {
          stationId: bar.id,
          printerId: barPrinter,
        });
        await attachPrinterToStation(tx, {
          stationId: grill.id,
          printerId: grillPrinter,
        });
        const dish = await makeProduct(tx, "Steak", { stationId: bar.id });
        const orderId = await fireNewOrder(tx, cfg, [line(dish)]);
        const [fired] = await tx
          .select({ workingOrderLineId: ticketItems.workingOrderLineId })
          .from(ticketItems)
          .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
          .where(eq(workingOrderLines.workingOrderId, orderId));
        const before = new Set((await printJobsFor(tx)).map((job) => job.id));
        if (printerOff) await updatePrinter(tx, barPrinter, { active: false });
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
          notices: await listStationNotices(tx, bar.id),
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
        expect(lines[0]).toBe(
          held ? "*** HOLD CANCELLED ***" : `*** ${kitchenTicketWords("en").movedTo} GRILL ***`,
        );
        if (held) expect(lines).toContain("GROUP 2");
        expect(lines).toContain("1 x Steak");
      }
    },
  );

  it("prints the origin on the new station's linked ticket", async () => {
    const { cfg } = await setupVenue();
    const result = await asApp(async (tx) => {
      const grill = await createStation(tx, { name: "Grill", isDefault: true });
      const printerId = await makePrinter(tx, "Grill printer");
      await attachPrinterToStation(tx, {
        stationId: grill.id,
        printerId,
      });
      const dish = await makeProduct(tx, "Steak", { stationId: grill.id });
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
    expect(printedLines(result.jobs[0]!.payload)).toContain(
      `${kitchenTicketWords("en").fromStation} Bar`,
    );
    expect(result.links).toMatchObject([
      { printJobId: result.jobs[0]!.id, stationId: result.stationId },
    ]);
    expect(result.lines).toMatchObject([
      { printJobId: result.jobs[0]!.id, workingOrderLineId: result.lineId },
    ]);
  });
});

describe("correction slips for a station with no printer", () => {
  it("sends a correction slip only for the lines whose station has an active printer", async () => {
    const { cfg } = await setupVenue();
    const { printerId, slips } = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const barStation = await createStation(tx, { name: "Bar", isDefault: false });
      const printerId = await makePrinter(tx, "Kitchen printer");
      await attachPrinterToStation(tx, {
        stationId: kitchenStation.id,
        printerId,
      });
      const steak = await makeProduct(tx, "Ribeye", {
        stationId: kitchenStation.id,
      });
      const beer = await makeProduct(tx, "Beer", { stationId: barStation.id });
      const orderId = await fireNewOrder(tx, cfg, [line(steak), line(beer)]);
      const fired = await tx
        .select({
          workingOrderLineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
        })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, orderId));
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
    expect(slip).toContain("Ribeye");
    expect(slip).not.toContain("Beer");
  });
});

describe("every correction reaches the station as a notice, printer or not", () => {
  it("records the notice at a station with no printer, and enqueues no print job", async () => {
    const { cfg } = await setupVenue();
    const { stationId, notices, jobs } = await asApp(async (tx) => {
      const barStation = await createStation(tx, { name: "Bar", isDefault: true });
      const beer = await makeProduct(tx, "Beer", { stationId: barStation.id });
      const orderId = await fireNewOrder(tx, cfg, [line(beer)]);
      const [fired] = await tx
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
        [{ ...fired!, stationId: fired!.stationId!, quantity: 1000, wasStarted: true }],
        "VOID",
      );
      return {
        stationId: barStation.id,
        notices: await listStationNotices(tx, barStation.id),
        jobs: await printJobsFor(tx),
      };
    });

    expect(notices).toMatchObject([
      { stationId, kind: "void", lineName: "Beer", quantity: "1.000", wasStarted: true },
    ]);
    expect(jobs).toEqual([]);
  });

  it("records the notice and prints the slip where the station has a printer", async () => {
    const { cfg } = await setupVenue();
    const { printerId, notices, slips } = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const printerId = await makePrinter(tx, "Kitchen printer");
      await attachPrinterToStation(tx, {
        stationId: kitchenStation.id,
        printerId,
      });
      const steak = await makeProduct(tx, "Ribeye", {
        stationId: kitchenStation.id,
      });
      const orderId = await fireNewOrder(tx, cfg, [line(steak)]);
      const [fired] = await tx
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
        [{ ...fired!, stationId: fired!.stationId!, quantity: 1000, wasStarted: false }],
        "RECALLED",
      );
      return {
        printerId,
        notices: await listStationNotices(tx, kitchenStation.id),
        slips: (await printJobsFor(tx)).filter((job) => !before.has(job.id)),
      };
    });

    expect(notices).toMatchObject([{ kind: "recalled", lineName: "Ribeye", wasStarted: false }]);
    expect(slips.map((slip) => slip.printerId)).toEqual([printerId]);
    expect(decodeTicket(slips[0]!.payload)).toContain("Ribeye");
  });

  it("a partial void's slip prints the quantity removed, not what is left", async () => {
    const { cfg } = await setupVenue();
    const slips = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const printerId = await makePrinter(tx, "Kitchen printer");
      await attachPrinterToStation(tx, {
        stationId: kitchenStation.id,
        printerId,
      });
      const steak = await makeProduct(tx, "Ribeye", {
        stationId: kitchenStation.id,
      });
      const offers = await offerProducts(tx, { zone: "tables" });
      const [table] = await tx
        .insert(diningTables)
        .values({ label: "T1", zoneId: offers.zoneId })
        .returning({ id: diningTables.id });
      await tx.update(diningTables).set({ onFloor: true }).where(eq(diningTables.id, table!.id));
      const { tabId } = await openPartyTab(tx, cfg, { tableId: table!.id });
      await addGroupedTabRound(tx, cfg, tabId, [
        { menuItemId: offers.offerFor(steak), quantity: "3" },
      ]);
      const before = new Set((await printJobsFor(tx)).map((job) => job.id));
      await cancelLine(tx, cfg, tabId, 1, "2");
      return (await printJobsFor(tx)).filter((job) => !before.has(job.id));
    });

    expect(slips).toHaveLength(1);
    const slip = decodeTicket(slips[0]!.payload);
    expect(slip).toContain(`2 x Ribeye`);
  });
});
