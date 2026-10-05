import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  deviceMadeHereStations,
  deviceProfiles,
  devices,
  kitchenPrintJobLines,
  kitchenPrintJobs,
  printJobs,
  printers,
  ticketItems,
  workingOrderLines,
  withTransaction,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createProduct } from "@waitron/catalogue";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter, updatePrinter } from "@waitron/printing";
import { createStation } from "./kitchen.js";
import {
  enqueueCorrectionSlips,
  enqueueExtraCancelled,
  enqueueHoldCorrections,
  enqueueKitchenTickets,
  enqueueStationMoved,
  enqueueWatcherCopies,
  reprintOrderTickets,
} from "./kitchen-print.js";
import type { WatcherCopies } from "./kitchen-print.js";
import { attachPrinterToStation, replaceStationPrinters } from "./station-printers.js";
import { printedCommands, printedLines, opensDrawer } from "./testing/decode-ticket.js";
import {
  fireNewOrder,
  setupSplitExtrasVenue,
  setupVenue,
  useSplitExtrasDb,
} from "./testing/split-extras-venue.js";
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
  it("sends correction slips to the watchers of each dish even without station paper", async () => {
    const { cfg, catalogueId } = await setupVenue();
    cfg.locale = "en-GB";
    const result = await withTransaction(db, async (tx) => {
      const grill = await createStation(tx, cfg, { name: "Grill", isDefault: true });
      const bar = await createStation(tx, cfg, { name: "Bar" });
      const watcherIds: string[] = [];
      for (const [name, stationIds] of [
        ["Both", [grill.id, bar.id]],
        ["Grill only", [grill.id]],
      ] as const) {
        const watcher = await createWatcher(tx, cfg, {
          name,
          runsPass: false,
          everyStation: false,
          stationIds: [...stationIds],
          everyZone: true,
          zoneIds: [],
        });
        const printer = await createPrinter(
          tx,
          { locationId: cfg.locationId },
          {
            name,
            transport: "cloud_poll",
            pollId: `poll-${randomUUID()}`,
          },
        );
        await setPrinterWatcher(tx, cfg, printer.id, watcher.id);
        await tx.update(printers).set({ hasCashDrawer: true }).where(eq(printers.id, printer.id));
        watcherIds.push(printer.id);
      }
      const products: string[] = [];
      for (const [name, stationId] of [
        ["Steak", grill.id],
        ["Beer", bar.id],
      ] as const) {
        const product = await createProduct(tx, {
          catalogueId,
          categoryId: null,
          name,
          kitchenName: name.toUpperCase(),
          pricingUnit: "each",
          unitPrice: "1.50",
          vatClass: "general",
        });
        await routeProductTo(tx, cfg, product.id, stationId);
        products.push(product.id);
      }
      const orderId = await fireNewOrder(
        tx,
        cfg,
        products.map((productId) => ({ productId, quantity: "1" })),
      );
      const items = await tx
        .select({ lineId: ticketItems.workingOrderLineId, stationId: ticketItems.stationId })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      const beer = items.find((item) => item.stationId === bar.id)!;
      const steak = items.find((item) => item.stationId === grill.id)!;
      await enqueueCorrectionSlips(
        tx,
        cfg,
        orderId,
        [{ workingOrderLineId: beer.lineId, stationId: bar.id, quantity: 1000, wasStarted: false }],
        "VOID",
      );
      await enqueueCorrectionSlips(
        tx,
        cfg,
        orderId,
        [
          {
            workingOrderLineId: steak.lineId,
            stationId: grill.id,
            quantity: 1000,
            wasStarted: false,
          },
        ],
        "RECALLED",
      );
      const held = {
        workingOrderLineId: beer.lineId,
        stationId: bar.id,
        quantity: 1000,
        wasStarted: false,
        group: 1,
      };
      await enqueueHoldCorrections(tx, cfg, orderId, [held], {
        kind: "HOLD CHANGED",
        direction: "added",
      });
      await enqueueHoldCorrections(tx, cfg, orderId, [held], { kind: "HOLD CANCELLED" });
      await enqueueExtraCancelled(tx, cfg, orderId, held, "LIME");
      await reprintOrderTickets(tx, cfg, orderId);
      return { watcherIds, jobs: await tx.select().from(printJobs) };
    });
    const both = result.jobs.filter((job) => job.printerId === result.watcherIds[0]);
    const grill = result.jobs.filter((job) => job.printerId === result.watcherIds[1]);
    expect(both).toHaveLength(7);
    expect(printedLines(both[1]!.payload).join(" ")).toContain("BEER");
    expect(printedLines(both[1]!.payload).join(" ")).toContain("VOID");
    expect(printedLines(both[2]!.payload).join(" ")).toContain("RECALLED");
    expect(printedLines(both[3]!.payload).join(" ")).toContain("HOLD CHANGED");
    expect(printedLines(both[4]!.payload).join(" ")).toContain("HOLD CANCELLED");
    expect(printedLines(both[5]!.payload).join(" ")).toContain("LIME");
    expect(printedLines(both[6]!.payload).join(" ")).toContain("REPRINT");
    expect(grill).toHaveLength(3);
    expect(printedLines(grill[2]!.payload).join(" ")).toContain("REPRINT");
    expect(result.jobs.every((job) => job.kind === "document")).toBe(true);
  });

  it("filters made-here records from every watcher slip and copy path", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const result = await withTransaction(db, async (tx) => {
      const grill = await createStation(tx, cfg, { name: "Grill", isDefault: true });
      const bar = await createStation(tx, cfg, { name: "Bar" });
      const printerIds: string[] = [];
      for (const [name, stationIds] of [
        ["Old", [grill.id]],
        ["New", [bar.id]],
      ] as const) {
        const watcher = await createWatcher(tx, cfg, {
          name,
          runsPass: false,
          everyStation: false,
          stationIds: [...stationIds],
          everyZone: true,
          zoneIds: [],
        });
        const printer = await createPrinter(
          tx,
          { locationId: cfg.locationId },
          {
            name,
            transport: "cloud_poll",
            pollId: `poll-${randomUUID()}`,
          },
        );
        await setPrinterWatcher(tx, cfg, printer.id, watcher.id);
        printerIds.push(printer.id);
      }
      const product = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Lager",
        kitchenName: "LAGER",
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      await routeProductTo(tx, cfg, product.id, grill.id);
      const orderId = await fireNewOrder(tx, cfg, [{ productId: product.id, quantity: "1" }]);
      const [item] = await tx
        .select({ lineId: ticketItems.workingOrderLineId })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      const baseline = await tx.select().from(printJobs);
      await tx
        .update(ticketItems)
        .set({ madeHere: true })
        .where(eq(ticketItems.workingOrderLineId, item!.lineId));
      await enqueueStationMoved(
        tx,
        cfg,
        orderId,
        [
          {
            workingOrderLineId: item!.lineId,
            stationId: grill.id,
            quantity: 1000,
            wasStarted: false,
            group: 1,
          },
        ],
        "Bar",
        bar.id,
      );
      const afterSlip = await tx.select().from(printJobs);
      await enqueueKitchenTickets(
        tx,
        cfg,
        orderId,
        [{ workingOrderLineId: item!.lineId, stationId: bar.id, quantity: 1000 }],
        { watchers: { newSince: grill.id } },
      );
      const afterNewSince = await tx.select().from(printJobs);
      await enqueueWatcherCopies(
        tx,
        cfg,
        orderId,
        [{ workingOrderLineId: item!.lineId, stationId: bar.id, quantity: 1000 }],
        {
          rerouted: new Map([[item!.lineId, { stationId: grill.id, stationName: "Grill" }]]),
        },
      );
      return {
        baseline,
        afterSlip,
        afterNewSince,
        jobs: await tx.select().from(printJobs),
        printerIds,
      };
    });
    const count = (jobs: typeof result.jobs) =>
      jobs.filter((job) => result.printerIds.includes(job.printerId)).length;
    expect(count(result.afterSlip)).toBe(count(result.baseline));
    expect(count(result.afterNewSince)).toBe(count(result.baseline));
    expect(count(result.jobs)).toBe(count(result.baseline));
  });
  it("sends a station move slip only to a watcher that stops following the dish", async () => {
    const { cfg, catalogueId } = await setupVenue();
    cfg.locale = "en-GB";
    const result = await withTransaction(db, async (tx) => {
      const grill = await createStation(tx, cfg, { name: "Grill", isDefault: true });
      const downstairs = await createStation(tx, cfg, { name: "Downstairs grill" });
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
      const ids: string[] = [];
      for (const [name, stationIds] of [
        ["Old only", [grill.id]],
        ["Both", [grill.id, downstairs.id]],
        ["New only", [downstairs.id]],
      ] as const) {
        const watcher = await createWatcher(tx, cfg, {
          name,
          runsPass: false,
          everyStation: false,
          stationIds: [...stationIds],
          everyZone: true,
          zoneIds: [],
        });
        const printer = await createPrinter(
          tx,
          { locationId: cfg.locationId },
          {
            name,
            transport: "cloud_poll",
            pollId: `poll-${randomUUID()}`,
          },
        );
        await setPrinterWatcher(tx, cfg, printer.id, watcher.id);
        ids.push(printer.id);
      }
      const orderId = await fireNewOrder(tx, cfg, [{ productId: burger, quantity: "1" }]);
      const [item] = await tx
        .select({ id: ticketItems.workingOrderLineId })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      await enqueueStationMoved(
        tx,
        cfg,
        orderId,
        [
          {
            workingOrderLineId: item!.id,
            stationId: grill.id,
            quantity: 1000,
            wasStarted: false,
          },
        ],
        "Downstairs grill",
        downstairs.id,
      );
      return ids.map((id) => ({ id, jobs: [] as string[] }));
    });
    const jobs = await withTransaction(db, (tx) => tx.select().from(printJobs));
    const slips = result.map(({ id }) =>
      jobs.filter((job) => job.printerId === id).map((job) => printedLines(job.payload).join(" ")),
    );
    expect(slips[0]).toHaveLength(2);
    expect(slips[0]![1]).toContain("MOVED TO DOWNSTAIRS GRILL");
    expect(slips[1]).toHaveLength(1);
    expect(slips[2]).toHaveLength(0);
  });
  it("builds an 80mm and a 58mm copy for two printers on one watcher", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const result = await withTransaction(db, async (tx) => {
      const grill = await createStation(tx, cfg, { name: "Grill", isDefault: true });
      const watcher = await createWatcher(tx, cfg, {
        name: "Pase",
        runsPass: true,
        everyStation: false,
        stationIds: [grill.id],
        everyZone: true,
        zoneIds: [],
      });
      const printers: string[] = [];
      for (const width of ["80mm", "58mm"] as const) {
        const { id } = await createPrinter(
          tx,
          { locationId: cfg.locationId },
          {
            name: `Pase ${width}`,
            transport: "cloud_poll",
            pollId: `poll-${randomUUID()}`,
          },
        );
        await updatePrinter(tx, { locationId: cfg.locationId }, id, { paperWidth: width });
        await setPrinterWatcher(tx, cfg, id, watcher.id);
        printers.push(id);
      }
      const { id: burger } = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Burger",
        kitchenName: "BURG with a long kitchen name for wrapping",
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      await routeProductTo(tx, cfg, burger, grill.id);
      await fireNewOrder(tx, cfg, [{ productId: burger, quantity: "1" }]);
      return { printers, jobs: await tx.select().from(printJobs) };
    });
    const [wide, narrow] = result.printers.map((printerId) => {
      const own = result.jobs.filter((job) => job.printerId === printerId);
      expect(own).toHaveLength(1);
      return own[0]!.payload;
    });
    const widths = (payload: Uint8Array) =>
      new Set(
        printedCommands(payload)
          .filter((command) => command.text !== undefined)
          .map((command) => command.widthDots),
      );
    expect(widths(wide!)).toEqual(new Set([512]));
    expect(widths(narrow!)).toEqual(new Set([360]));
    expect(printedLines(wide!)[0]).toBe("Pase");
    expect(printedLines(narrow!)[0]).toBe("Pase");
    expect(
      printedLines(wide!)
        .map((line) => line.trim())
        .join(" "),
    ).toContain("BURG with a long kitchen name for wrapping");
    expect(
      printedLines(narrow!)
        .map((line) => line.trim())
        .join(" "),
    ).toContain("BURG with a long kitchen name for wrapping");
  });

  it("leaves a made-here extra off both the station and watcher tickets on a normal send", async () => {
    const venue = await setupSplitExtrasVenue();
    const { cfg, products, lists, printers, stations } = venue;
    const result = await withTransaction(db, async (tx) => {
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({
          name: "Fryer till",
          formFactor: "till",
          capabilities: [],
        })
        .returning({ id: deviceProfiles.id });
      const [device] = await tx
        .insert(devices)
        .values({
          locationId: cfg.locationId,
          deviceProfileId: profile!.id,
          label: "Fryer till",
          tokenHash: `here-${randomUUID()}`,
        })
        .returning({ id: devices.id });
      await tx
        .insert(deviceMadeHereStations)
        .values({ deviceId: device!.id, stationId: stations.fryer });
      const orderId = await fireNewOrder(tx, { ...cfg, sendingDeviceId: device!.id }, [
        {
          productId: products.burger,
          quantity: "1",
          extras: [{ listId: lists.burger, picks: [{ productId: products.chips, quantity: 1 }] }],
        },
      ]);
      return {
        jobs: await tx.select().from(printJobs),
        items: await tx
          .select({ stationId: ticketItems.stationId, madeHere: ticketItems.madeHere })
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderId, orderId)),
      };
    });
    expect(result.items).toContainEqual({ stationId: stations.fryer, madeHere: true });
    expect(result.jobs.map((job) => job.printerId).sort()).toEqual(
      [printers.grill, printers.pass].sort(),
    );
    for (const printerId of [printers.grill, printers.pass]) {
      const lines = printedLines(result.jobs.find((job) => job.printerId === printerId)!.payload);
      expect(lines).toContain("1.000 x BURG");
      expect(lines.filter((line) => line.includes("x CHIPS"))).toEqual([]);
    }
  });

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

it("fires and reprints through a replaced station printer set with one watcher copy and no drawer pulse", async () => {
  const { cfg, catalogueId } = await setupVenue();
  const result = await withTransaction(db, async (tx) => {
    const station = await createStation(tx, cfg, { name: "Kitchen", isDefault: true });
    const other = await createStation(tx, cfg, { name: "Bar" });
    const ids: string[] = [];
    for (const name of ["Old", "New", "Shared", "Watcher"]) {
      const printer = await createPrinter(
        tx,
        { locationId: cfg.locationId },
        { name, transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
      );
      await tx.update(printers).set({ hasCashDrawer: true }).where(eq(printers.id, printer.id));
      ids.push(printer.id);
    }
    const [old, next, shared, watcherPrinter] = ids as [string, string, string, string];
    await attachPrinterToStation(tx, { stationId: station.id, printerId: old });
    await attachPrinterToStation(tx, { stationId: other.id, printerId: shared });
    const watcher = await createWatcher(tx, cfg, {
      name: "Pass",
      everyStation: true,
      stationIds: [],
      everyZone: true,
      zoneIds: [],
      runsPass: true,
    });
    await setPrinterWatcher(tx, cfg, watcherPrinter, watcher.id);
    const { id: productId } = await createProduct(tx, {
      catalogueId,
      categoryId: null,
      name: "Staff stew",
      customerName: { "es-ES": "Diner stew" },
      kitchenName: "Kitchen stew",
      pricingUnit: "each",
      unitPrice: "3.50",
      vatClass: "general",
    });
    await routeProductTo(tx, cfg, productId, station.id);
    await replaceStationPrinters(tx, { locationId: cfg.locationId }, station.id, [next, shared]);
    const orderId = await fireNewOrder(tx, cfg, [{ productId, quantity: "1" }]);
    const fired = await tx.select().from(printJobs);
    const beforeReprint = new Set(fired.map((job) => job.id));
    await replaceStationPrinters(tx, { locationId: cfg.locationId }, station.id, [shared]);
    await reprintOrderTickets(tx, cfg, orderId);
    const reprinted = (await tx.select().from(printJobs)).filter(
      (job) => !beforeReprint.has(job.id),
    );
    return { old, next, shared, watcherPrinter, fired, reprinted };
  });
  expect(result.fired.map((job) => job.printerId).sort()).toEqual(
    [result.next, result.shared, result.watcherPrinter].sort(),
  );
  expect(result.reprinted.map((job) => job.printerId).sort()).toEqual(
    [result.shared, result.watcherPrinter].sort(),
  );
  for (const job of [...result.fired, ...result.reprinted]) {
    expect(job.kind).toBe("document");
    expect(printedLines(job.payload)).toContain("1.000 x Kitchen stew");
    expect(opensDrawer(job.payload)).toBe(false);
  }
});
