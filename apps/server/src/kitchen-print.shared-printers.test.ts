import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  kitchenPrintJobLines,
  kitchenPrintJobs,
  printJobs,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createProduct } from "@waitron/catalogue";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter, updatePrinter } from "@waitron/printing";
import { writePrintHeldWork } from "@waitron/venue-service";
import type { OriginConfig } from "./till-config.js";
import { createStation, updateStation } from "./kitchen.js";
import { reprintOrderTickets } from "./kitchen-print.js";
import { submitGroups } from "./order-groups.js";
import { seatTable } from "./parties.js";
import { createTable } from "./tables.js";
import { cancelLine } from "./testing/cancel-line.js";
import { OPERATOR } from "./testing/party-venue.js";
import { attachPrinterToStation } from "./station-printers.js";
import { printedLines } from "./testing/decode-ticket.js";
import { fireNewOrder, setupVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { offerProducts, routeProductTo } from "./testing/zone-offers.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
  useSplitExtrasDb(db);
});

async function makePrinter(tx: Transaction, cfg: OriginConfig, name: string): Promise<string> {
  const { id } = await createPrinter(
    tx,
    { locationId: cfg.locationId },
    { name, transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
  );
  return id;
}

async function makeDish(
  tx: Transaction,
  cfg: OriginConfig,
  catalogueId: string,
  name: string,
  stationId: string,
): Promise<string> {
  const { id } = await createProduct(tx, {
    catalogueId,
    categoryId: null,
    name,
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "general",
  });
  await routeProductTo(tx, cfg, id, stationId);
  return id;
}

/**
 * Three stations, named so their name order is X, Y, Z: X (Cold, dish Salad), Y (Grill, dish Steak)
 * and Z (Pastry, dish Tart), each with a printer of its own (PX, PY, PZ).
 */
async function threeStations(tx: Transaction, cfg: OriginConfig, catalogueId: string) {
  const x = await createStation(tx, cfg, { name: "Cold", isDefault: true });
  const y = await createStation(tx, cfg, { name: "Grill" });
  const z = await createStation(tx, cfg, { name: "Pastry" });
  const px = await makePrinter(tx, cfg, "PX");
  const py = await makePrinter(tx, cfg, "PY");
  const pz = await makePrinter(tx, cfg, "PZ");
  await attachPrinterToStation(tx, { stationId: x.id, printerId: px });
  await attachPrinterToStation(tx, { stationId: y.id, printerId: py });
  await attachPrinterToStation(tx, { stationId: z.id, printerId: pz });
  const salad = await makeDish(tx, cfg, catalogueId, "Salad", x.id);
  const steak = await makeDish(tx, cfg, catalogueId, "Steak", y.id);
  const tart = await makeDish(tx, cfg, catalogueId, "Tart", z.id);
  return { x: x.id, y: y.id, z: z.id, px, py, pz, salad, steak, tart };
}

const line = (productId: string) => ({ productId, quantity: "1" });

/** The send's print jobs in the order they were queued, each with the stations and lines it links. */
async function sentJobs(tx: Transaction) {
  const jobs = await tx
    .select({ id: printJobs.id, printerId: printJobs.printerId, payload: printJobs.payload })
    .from(printJobs);
  const ids = jobs.map((job) => job.id);
  const links = await tx
    .select({ printJobId: kitchenPrintJobs.printJobId, stationId: kitchenPrintJobs.stationId })
    .from(kitchenPrintJobs)
    .where(inArray(kitchenPrintJobs.printJobId, ids));
  const lines = await tx
    .select({
      printJobId: kitchenPrintJobLines.printJobId,
      lineId: kitchenPrintJobLines.workingOrderLineId,
    })
    .from(kitchenPrintJobLines)
    .where(inArray(kitchenPrintJobLines.printJobId, ids));
  return jobs.map((job) => ({
    ...job,
    printed: printedLines(job.payload),
    stationIds: links
      .filter((link) => link.printJobId === job.id)
      .map((link) => link.stationId)
      .sort(),
    lineCount: lines.filter((row) => row.printJobId === job.id).length,
  }));
}

/**
 * Seats a table on a venue that prints held groups in advance and submits `groups` for it, each a
 * fired or held group of one of each product. Answers the table's bill.
 */
async function seatAndSubmit(
  tx: Transaction,
  cfg: OriginConfig,
  groups: { release: "fire" | "hold"; productIds: string[] }[],
): Promise<string> {
  await writePrintHeldWork(tx, true);
  const offers = await offerProducts(tx, cfg, { zone: "tables" });
  const { id: tableId } = await createTable(tx, cfg, { label: "Mesa 7", zoneId: offers.zoneId });
  const { partyId, tabId, revision } = await seatTable(tx, cfg, {
    tableId,
    guestCount: 2,
    operatorId: OPERATOR,
  });
  await submitGroups(tx, cfg, partyId, {
    submissionId: randomUUID(),
    expectedPartyRevision: revision,
    operatorId: OPERATOR,
    groups: groups.map(({ release, productIds }) => ({
      release,
      lines: productIds.map((productId) => ({
        menuItemId: offers.offerFor(productId),
        quantity: "1",
      })),
    })),
  });
  return tabId;
}

function onPrinter<T extends { printerId: string }>(jobs: T[], printerId: string): T {
  const own = jobs.filter((job) => job.printerId === printerId);
  expect(own).toHaveLength(1);
  return own[0]!;
}

describe("a printer shared by several stations", () => {
  it("prints one ticket per send, with a section for each of its stations in this send", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const result = await withTransaction(db, async (tx) => {
      const venue = await threeStations(tx, cfg, catalogueId);
      const p = await makePrinter(tx, cfg, "P");
      await attachPrinterToStation(tx, { stationId: venue.y, printerId: p });
      await attachPrinterToStation(tx, { stationId: venue.z, printerId: p });
      await fireNewOrder(tx, cfg, [line(venue.salad), line(venue.steak), line(venue.tart)]);
      return { venue, p, jobs: await sentJobs(tx) };
    });
    const { venue, p, jobs } = result;

    expect(jobs).toHaveLength(4);
    const shared = onPrinter(jobs, p);
    expect(shared.printed.slice(0, 1)).toEqual(["Grill · Pastry"]);
    const sections = shared.printed.slice(4);
    expect(sections).toEqual(["Grill", "1.000 x Steak", "Pastry", "1.000 x Tart", ""]);
    expect(shared.stationIds).toEqual([venue.y, venue.z].sort());
    expect(shared.lineCount).toBe(2);

    expect(onPrinter(jobs, venue.px).printed.join("\n")).toContain("1.000 x Salad");
    expect(onPrinter(jobs, venue.py).printed[0]).toBe("Grill");
    expect(onPrinter(jobs, venue.py).printed.join("\n")).not.toContain("Tart");
    expect(onPrinter(jobs, venue.pz).printed[0]).toBe("Pastry");
    expect(onPrinter(jobs, venue.pz).printed.join("\n")).not.toContain("Steak");

    const order = jobs.map((job) => job.printerId);
    expect(order.indexOf(venue.px)).toBeLessThan(order.indexOf(p));
    expect(order.indexOf(p)).toBeLessThan(order.indexOf(venue.pz));
  });

  it("prints one ticket with every station's section on a printer every station uses", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const result = await withTransaction(db, async (tx) => {
      const venue = await threeStations(tx, cfg, catalogueId);
      const everywhere = await makePrinter(tx, cfg, "Everywhere");
      for (const stationId of [venue.x, venue.y, venue.z]) {
        await attachPrinterToStation(tx, { stationId, printerId: everywhere });
      }
      await fireNewOrder(tx, cfg, [line(venue.salad), line(venue.steak), line(venue.tart)]);
      return { venue, everywhere, jobs: await sentJobs(tx) };
    });
    const { venue, everywhere, jobs } = result;

    expect(jobs).toHaveLength(4);
    const shared = onPrinter(jobs, everywhere);
    expect(shared.printed[0]).toBe("Cold · Grill · Pastry");
    expect(shared.printed.slice(4)).toEqual([
      "Cold",
      "1.000 x Salad",
      "Grill",
      "1.000 x Steak",
      "Pastry",
      "1.000 x Tart",
      "",
    ]);
    expect(shared.stationIds).toEqual([venue.x, venue.y, venue.z].sort());
    expect(shared.lineCount).toBe(3);
  });

  it("prints the plain station ticket when only one of its stations is in the send", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const result = await withTransaction(db, async (tx) => {
      const venue = await threeStations(tx, cfg, catalogueId);
      const p = await makePrinter(tx, cfg, "P");
      await attachPrinterToStation(tx, { stationId: venue.y, printerId: p });
      await attachPrinterToStation(tx, { stationId: venue.z, printerId: p });
      await fireNewOrder(tx, cfg, [line(venue.steak)]);
      return { venue, p, jobs: await sentJobs(tx) };
    });
    const { venue, p, jobs } = result;

    expect(jobs).toHaveLength(2);
    const shared = onPrinter(jobs, p);
    // PY prints Grill's station ticket alone, at the same layout, so equal bytes mean P printed it.
    expect(Buffer.from(shared.payload).equals(Buffer.from(onPrinter(jobs, venue.py).payload))).toBe(
      true,
    );
    expect(shared.printed[0]).toBe("Grill");
    expect(shared.stationIds).toEqual([venue.y]);
  });

  it("prints one ticket on each of two shared printers of different widths", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const result = await withTransaction(db, async (tx) => {
      const venue = await threeStations(tx, cfg, catalogueId);
      const wide = await makePrinter(tx, cfg, "Wide");
      const narrow = await makePrinter(tx, cfg, "Narrow");
      await updatePrinter(tx, { locationId: cfg.locationId }, narrow, { paperWidth: "58mm" });
      for (const printerId of [wide, narrow]) {
        await attachPrinterToStation(tx, { stationId: venue.y, printerId });
        await attachPrinterToStation(tx, { stationId: venue.z, printerId });
      }
      await fireNewOrder(tx, cfg, [line(venue.steak), line(venue.tart)]);
      return { venue, wide, narrow, jobs: await sentJobs(tx) };
    });
    const { venue, wide, narrow, jobs } = result;

    expect(jobs).toHaveLength(4);
    const wideJob = onPrinter(jobs, wide);
    const narrowJob = onPrinter(jobs, narrow);
    expect(Buffer.from(wideJob.payload).equals(Buffer.from(narrowJob.payload))).toBe(false);
    for (const job of [wideJob, narrowJob]) {
      expect(job.printed[0]).toBe("Grill · Pastry");
      expect(job.printed.slice(4)).toEqual([
        "Grill",
        "1.000 x Steak",
        "Pastry",
        "1.000 x Tart",
        "",
      ]);
      expect(job.stationIds).toEqual([venue.y, venue.z].sort());
    }
  });

  it("lists only the dishes of stations not on the ticket when one of its stations shows the rest of the order", async () => {
    const { cfg, catalogueId } = await setupVenue();
    cfg.locale = "en-GB";
    const result = await withTransaction(db, async (tx) => {
      const venue = await threeStations(tx, cfg, catalogueId);
      await updateStation(tx, cfg, venue.y, { showsRestOfOrder: true });
      const p = await makePrinter(tx, cfg, "P");
      await attachPrinterToStation(tx, { stationId: venue.y, printerId: p });
      await attachPrinterToStation(tx, { stationId: venue.z, printerId: p });
      await fireNewOrder(tx, cfg, [line(venue.salad), line(venue.steak), line(venue.tart)]);
      return { venue, p, jobs: await sentJobs(tx) };
    });
    const { venue, p, jobs } = result;

    const shared = onPrinter(jobs, p);
    expect(shared.printed.slice(4)).toEqual([
      "Grill",
      "1.000 x Steak",
      "Pastry",
      "1.000 x Tart",
      "-- Also on this order (not for this",
      "station) --",
      "1.000 x Salad — Cold",
      "",
    ]);
    // Grill's own printer still lists every other station's dish, Pastry's lists none.
    const grillText = onPrinter(jobs, venue.py).printed.join("\n");
    expect(grillText).toContain("1.000 x Salad — Cold");
    expect(grillText).toContain("1.000 x Tart — Pastry");
    expect(onPrinter(jobs, venue.pz).printed.join("\n")).not.toContain("Also on this order");
  });
});

describe("a printer shared by several stations, on the rest of the order", () => {
  it("prints the rest of the order when only the ticket's second station shows it", async () => {
    const { cfg, catalogueId } = await setupVenue();
    cfg.locale = "en-GB";
    const result = await withTransaction(db, async (tx) => {
      const venue = await threeStations(tx, cfg, catalogueId);
      await updateStation(tx, cfg, venue.z, { showsRestOfOrder: true });
      const p = await makePrinter(tx, cfg, "P");
      await attachPrinterToStation(tx, { stationId: venue.y, printerId: p });
      await attachPrinterToStation(tx, { stationId: venue.z, printerId: p });
      await fireNewOrder(tx, cfg, [line(venue.salad), line(venue.steak), line(venue.tart)]);
      return { venue, p, jobs: await sentJobs(tx) };
    });
    const { venue, p, jobs } = result;

    expect(onPrinter(jobs, p).printed.slice(4)).toEqual([
      "Grill",
      "1.000 x Steak",
      "Pastry",
      "1.000 x Tart",
      "-- Also on this order (not for this",
      "station) --",
      "1.000 x Salad — Cold",
      "",
    ]);
    expect(onPrinter(jobs, venue.py).printed.join("\n")).not.toContain("Also on this order");
  });

  // The reprint's HOLD part leaves the rest of the order to the fired part. Z is fired, Y is not, and
  // only Y shows the rest of the order: Y's own HOLD ticket prints it, the combined one does not.
  it("leaves the rest of the order off a combined HOLD reprint when any of its stations has fired work", async () => {
    const { cfg, catalogueId } = await setupVenue();
    cfg.locale = "en-GB";
    const result = await withTransaction(db, async (tx) => {
      const venue = await threeStations(tx, cfg, catalogueId);
      await updateStation(tx, cfg, venue.y, { showsRestOfOrder: true });
      const p = await makePrinter(tx, cfg, "P");
      await attachPrinterToStation(tx, { stationId: venue.y, printerId: p });
      await attachPrinterToStation(tx, { stationId: venue.z, printerId: p });
      const tabId = await seatAndSubmit(tx, cfg, [
        { release: "fire", productIds: [venue.salad, venue.tart] },
        { release: "hold", productIds: [venue.steak, venue.tart] },
      ]);
      const before = (await sentJobs(tx)).length;
      await reprintOrderTickets(tx, cfg, tabId);
      return { venue, p, reprints: (await sentJobs(tx)).slice(before) };
    });
    const { venue, p, reprints } = result;

    const shared = onPrinter(reprints, p).printed;
    expect(shared).toContain("*** HOLD ***");
    expect(shared.join("\n")).toContain("Steak");
    expect(shared.join("\n")).not.toContain("Also on this order");
    const grill = onPrinter(reprints, venue.py).printed;
    expect(grill).toContain("*** HOLD ***");
    expect(grill.join("\n")).toContain("Also on this order");
  });
});

describe("a reprint on a printer shared by several stations", () => {
  it("prints the order once on the shared printer, linked to each of its stations", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const result = await withTransaction(db, async (tx) => {
      const venue = await threeStations(tx, cfg, catalogueId);
      const p = await makePrinter(tx, cfg, "P");
      await attachPrinterToStation(tx, { stationId: venue.y, printerId: p });
      await attachPrinterToStation(tx, { stationId: venue.z, printerId: p });
      const orderId = await fireNewOrder(tx, cfg, [
        line(venue.salad),
        line(venue.steak),
        line(venue.tart),
      ]);
      const before = (await sentJobs(tx)).length;
      await reprintOrderTickets(tx, cfg, orderId);
      return { venue, p, reprints: (await sentJobs(tx)).slice(before) };
    });
    const { venue, p, reprints } = result;

    expect(reprints).toHaveLength(4);
    const shared = onPrinter(reprints, p);
    expect(shared.printed.slice(0, 2)).toEqual(["*** REPRINT ***", "Grill · Pastry"]);
    expect(shared.printed.slice(5)).toEqual([
      "Grill",
      "1.000 x Steak",
      "Pastry",
      "1.000 x Tart",
      "",
    ]);
    expect(shared.stationIds).toEqual([venue.y, venue.z].sort());
    expect(shared.lineCount).toBe(2);
  });

  it.each([
    { fired: ["steak", "tart"], held: ["steak"] },
    { fired: ["steak", "tart"], held: ["tart"] },
    { fired: ["steak"], held: ["tart"] },
    { fired: ["tart"], held: ["steak"] },
  ] as const)(
    "merges fired $fired and held $held work into one job on the shared printer",
    async ({ fired, held }) => {
      const { cfg, catalogueId } = await setupVenue();
      const result = await withTransaction(db, async (tx) => {
        const venue = await threeStations(tx, cfg, catalogueId);
        const p = await makePrinter(tx, cfg, "P");
        await attachPrinterToStation(tx, { stationId: venue.y, printerId: p });
        await attachPrinterToStation(tx, { stationId: venue.z, printerId: p });
        const tabId = await seatAndSubmit(tx, cfg, [
          { release: "fire", productIds: fired.map((dish) => venue[dish]) },
          { release: "hold", productIds: held.map((dish) => venue[dish]) },
        ]);
        const before = (await sentJobs(tx)).length;
        await reprintOrderTickets(tx, cfg, tabId);
        return { venue, p, reprints: (await sentJobs(tx)).slice(before) };
      });
      const { venue, p, reprints } = result;

      const shared = onPrinter(reprints, p);
      expect(shared.printed.filter((text) => text === "*** REPRINT ***")).toHaveLength(2);
      expect(shared.printed.filter((text) => text === "*** HOLD ***")).toHaveLength(1);
      expect(shared.stationIds).toEqual([venue.y, venue.z].sort());
      expect(shared.lineCount).toBe(fired.length + held.length);
    },
  );
});

describe("a correction slip on a printer shared by several stations", () => {
  it("prints a voided dish's slip once on the shared printer and once on its station's own", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const result = await withTransaction(db, async (tx) => {
      const venue = await threeStations(tx, cfg, catalogueId);
      const p = await makePrinter(tx, cfg, "P");
      await attachPrinterToStation(tx, { stationId: venue.y, printerId: p });
      await attachPrinterToStation(tx, { stationId: venue.z, printerId: p });
      const tabId = await seatAndSubmit(tx, cfg, [
        { release: "fire", productIds: [venue.salad, venue.steak, venue.tart] },
      ]);
      const [steak] = await tx
        .select({ lineNo: workingOrderLines.lineNo })
        .from(workingOrderLines)
        .where(
          and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.name, "Steak")),
        );
      const before = (await sentJobs(tx)).length;
      await cancelLine(tx, cfg, tabId, steak!.lineNo);
      return { venue, p, slips: (await sentJobs(tx)).slice(before) };
    });
    const { venue, p, slips } = result;

    expect(slips.map((slip) => slip.printerId).sort()).toEqual([p, venue.py].sort());
    for (const slip of slips) {
      expect(slip.printed[0]).toBe("*** VOID ***");
      expect(slip.printed.join("\n")).toContain("Steak");
      expect(slip.printed.join("\n")).not.toContain("Tart");
      expect(slip.stationIds).toEqual([]);
    }
  });
});
