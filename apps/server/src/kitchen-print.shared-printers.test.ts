import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { kitchenPrintJobLines, kitchenPrintJobs, printJobs, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createProduct } from "@waitron/catalogue";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter, updatePrinter } from "@waitron/printing";
import type { OriginConfig } from "./till-config.js";
import { createStation, updateStation } from "./kitchen.js";
import { attachPrinterToStation } from "./station-printers.js";
import { printedLines } from "./testing/decode-ticket.js";
import { fireNewOrder, setupVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { routeProductTo } from "./testing/zone-offers.js";
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
