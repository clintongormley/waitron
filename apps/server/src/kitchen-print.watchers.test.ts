import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  kitchenPrintJobLines,
  kitchenPrintJobs,
  printJobs,
  printers,
  workingOrderLines,
  withTransaction,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createProduct } from "@waitron/catalogue";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import { createStation } from "./kitchen.js";
import { enqueueKitchenTickets, enqueueWatcherCopies } from "./kitchen-print.js";
import type { WatcherCopies } from "./kitchen-print.js";
import { attachPrinterToStation } from "./station-printers.js";
import { printedLines } from "./testing/decode-ticket.js";
import { fireNewOrder, setupVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { offerProducts, routeProductTo } from "./testing/zone-offers.js";
import { createOpenOrder } from "./working-order.js";
import { createWatcher, setPrinterWatcher } from "./watchers.js";
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

describe("watcher paper", () => {
  it("separates work a watcher first sees after a station move from its usual FIRE copy", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const copies = await withTransaction(db, async (tx) => {
      const grill = await createStation(tx, cfg, { name: "Grill", isDefault: true });
      const bar = await createStation(tx, cfg, { name: "Bar" });
      const { id: burger } = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Burger",
        kitchenName: "BURG",
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      await routeProductTo(tx, cfg, burger, grill.id);
      const offers = await offerProducts(tx, cfg);
      const watcher = await createWatcher(tx, cfg, {
        name: "Pase",
        runsPass: true,
        everyStation: false,
        stationIds: [grill.id],
        everyZone: true,
        zoneIds: [],
      });
      const { id: printerId } = await createPrinter(
        tx,
        { locationId: cfg.locationId },
        {
          name: "Pase",
          transport: "cloud_poll",
          pollId: `poll-${randomUUID()}`,
        },
      );
      await setPrinterWatcher(tx, cfg, printerId, watcher.id);
      const orderId = randomUUID();
      await createOpenOrder(
        tx,
        cfg,
        orderId,
        offers.toOfferLines([
          { productId: burger, quantity: "1" },
          { productId: burger, quantity: "2" },
        ]),
        null,
        { zoneId: offers.zoneId },
      );
      const lines = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      await enqueueWatcherCopies(
        tx,
        cfg,
        orderId,
        lines.map((line) => ({ workingOrderLineId: line.id, stationId: grill.id })),
        {
          mark: "FIRE",
          rerouted: new Map([[lines[0]!.id, { stationId: bar.id, stationName: "Bar" }]]),
        },
      );
      return (await tx.select().from(printJobs))
        .filter((job) => job.printerId === printerId)
        .map((job) => printedLines(job.payload));
    });
    expect(copies).toHaveLength(2);
    const fromBar = copies.find((lines) => lines.includes("Viene de Bar"))!;
    expect(fromBar).toContain("1.000 x BURG");
    expect(fromBar).not.toContain("*** FIRE ***");
    expect(fromBar).not.toContain("2.000 x BURG");
    const fire = copies.find((lines) => lines.includes("*** FIRE ***"))!;
    expect(fire).toContain("2.000 x BURG");
    expect(fire).not.toContain("1.000 x BURG");
  });

  it("prints a zone runner's copy only for orders in the followed zone", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const result = await withTransaction(db, async (tx) => {
      const grill = await createStation(tx, cfg, { name: "Grill", isDefault: true });
      const { id: burger } = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Burger",
        kitchenName: "BURG",
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      await routeProductTo(tx, cfg, burger, grill.id);
      const terrace = await offerProducts(tx, cfg, { zone: "tables" });
      const indoor = await offerProducts(tx, cfg, { zone: "counter" });
      const watcher = await createWatcher(tx, cfg, {
        name: "Terrace runner",
        runsPass: false,
        everyStation: true,
        stationIds: [],
        everyZone: false,
        zoneIds: [terrace.zoneId],
      });
      const later = await createStation(tx, cfg, { name: "Late Grill" });
      await routeProductTo(tx, cfg, burger, later.id);
      const { id: printerId } = await createPrinter(
        tx,
        { locationId: cfg.locationId },
        {
          name: "Terrace runner",
          transport: "cloud_poll",
          pollId: `poll-${randomUUID()}`,
        },
      );
      await setPrinterWatcher(tx, cfg, printerId, watcher.id);
      const send = async (zone: typeof terrace, watchers?: WatcherCopies) => {
        const orderId = randomUUID();
        await createOpenOrder(
          tx,
          cfg,
          orderId,
          zone.toOfferLines([{ productId: burger, quantity: "1" }]),
          "Mesa 7",
          { zoneId: zone.zoneId },
        );
        const [line] = await tx
          .select({ id: workingOrderLines.id })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, orderId));
        return enqueueKitchenTickets(
          tx,
          cfg,
          orderId,
          [{ workingOrderLineId: line!.id, stationId: later.id }],
          { watchers },
        );
      };
      const outside = await send(terrace);
      const inside = await send(indoor);
      const alreadyFollowing = await send(terrace, { newSince: later.id });
      return {
        printerId,
        outside,
        inside,
        alreadyFollowing,
        jobs: await tx.select().from(printJobs),
      };
    });
    expect(result.outside).toBe(true);
    expect(result.inside).toBe(false);
    expect(result.alreadyFollowing).toBe(false);
    const copies = result.jobs.filter((job) => job.printerId === result.printerId);
    expect(copies).toHaveLength(1);
    expect(printedLines(copies[0]!.payload).slice(0, 3)).toEqual(["Terrace runner", "Mesa 7", "1"]);
    expect(printedLines(copies[0]!.payload)).toContain("Late Grill");
  });

  it("prints one named copy for the followed stations, alongside station tickets, without kitchen links", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const result = await withTransaction(db, async (tx) => {
      const grill = await createStation(tx, cfg, { name: "Grill", isDefault: true });
      const fryer = await createStation(tx, cfg, { name: "Fryer" });
      const bar = await createStation(tx, cfg, { name: "Bar" });
      const stationPrinters: string[] = [];
      for (const [station, name] of [
        [grill, "Grill"],
        [fryer, "Fryer"],
        [bar, "Bar"],
      ] as const) {
        const { id } = await createPrinter(
          tx,
          { locationId: cfg.locationId },
          {
            name: `${name} printer`,
            transport: "cloud_poll",
            pollId: `poll-${randomUUID()}`,
          },
        );
        await attachPrinterToStation(tx, { stationId: station.id, printerId: id });
        stationPrinters.push(id);
      }
      await tx
        .update(printers)
        .set({ ticketScope: "order" })
        .where(eq(printers.id, stationPrinters[0]!));
      const watcher = await createWatcher(tx, cfg, {
        name: "Pase",
        runsPass: true,
        everyStation: false,
        stationIds: [grill.id, fryer.id],
        everyZone: true,
        zoneIds: [],
      });
      const { id: watcherPrinter } = await createPrinter(
        tx,
        { locationId: cfg.locationId },
        {
          name: "Pase printer",
          transport: "cloud_poll",
          pollId: `poll-${randomUUID()}`,
        },
      );
      await setPrinterWatcher(tx, cfg, watcherPrinter, watcher.id);
      const products: string[] = [];
      for (const [name, station] of [
        ["Burger", grill],
        ["Chips", fryer],
        ["Lager", bar],
      ] as const) {
        const { id } = await createProduct(tx, {
          catalogueId,
          categoryId: null,
          name,
          kitchenName: `${name} kitchen`,
          pricingUnit: "each",
          unitPrice: "1.50",
          vatClass: "general",
        });
        await routeProductTo(tx, cfg, id, station.id);
        products.push(id);
      }
      await fireNewOrder(
        tx,
        cfg,
        products.map((productId) => ({ productId, quantity: "1" })),
      );
      return {
        watcherPrinter,
        stationPrinters,
        jobs: await tx.select().from(printJobs),
        links: await tx.select().from(kitchenPrintJobs),
        lineLinks: await tx.select().from(kitchenPrintJobLines),
      };
    });
    const watcherJobs = result.jobs.filter((job) => job.printerId === result.watcherPrinter);
    expect(watcherJobs).toHaveLength(1);
    const lines = printedLines(watcherJobs[0]!.payload);
    expect(lines[0]).toBe("Pase");
    expect(lines).toContain("Fryer");
    expect(lines).toContain("Grill");
    expect(lines).toContain("1.000 x Chips kitchen");
    expect(lines).toContain("1.000 x Burger kitchen");
    expect(lines.join(" ")).not.toContain("Lager");
    expect(lines.join(" ")).not.toContain("Bar");
    for (const printerId of result.stationPrinters) {
      expect(result.jobs.filter((job) => job.printerId === printerId)).toHaveLength(1);
    }
    const grillCopy = printedLines(
      result.jobs.find((job) => job.printerId === result.stationPrinters[0])!.payload,
    );
    expect(grillCopy[0]).toBe("Grill");
    expect(grillCopy.join(" ")).not.toContain("Chips kitchen");
    expect(watcherJobs[0]!.kind).toBe("document");
    expect(result.links.filter((link) => link.printJobId === watcherJobs[0]!.id)).toEqual([]);
    expect(result.lineLinks.filter((link) => link.printJobId === watcherJobs[0]!.id)).toEqual([]);
  });
});
