import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  kitchenStations,
  printers,
  stationPrinters,
  withTransaction,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { nodeId as brandNodeId } from "@waitron/shared";
import { createPrinter, updatePrinter } from "@waitron/printing";

import type { TradingContext } from "./trading-context.js";
import { createStation } from "./kitchen.js";
import { eq } from "drizzle-orm";
import { deletePrinter } from "./printer-delete.js";
import {
  attachPrinterToStation,
  detachPrinterFromStation,
  listStationPrinters,
  replaceStationPrinters,
} from "./station-printers.js";
import "./errors.js";

const LOCALE = "es-ES";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function setupVenue(): Promise<TradingContext> {
  await seedVenue(db, {
    name: "Main bar",
    invoiceLocales: [LOCALE],
    operationDescription: "Venta en establecimiento",
  });
  const nodeId = await seedNode(db);
  return {
    nodeId: brandNodeId(nodeId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
}

function asApp<T>(cfg: TradingContext, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

function station(cfg: TradingContext, name: string): Promise<string> {
  return asApp(cfg, (tx) => createStation(tx, { name })).then((r) => r.id);
}

/** `cloud_poll` needs only a `poll_id`, no agent to seed. */
function printer(cfg: TradingContext, name: string): Promise<string> {
  return asApp(cfg, (tx) =>
    createPrinter(tx, { name, transport: "cloud_poll", pollId: `poll-${name}` }),
  ).then((r) => r.id);
}

describe("station→printer mapping verbs", () => {
  it("attaches a mapping, lists it, and is idempotent on a repeat attach", async () => {
    const cfg = await setupVenue();
    const s1 = await station(cfg, "Main kitchen");
    const p1 = await printer(cfg, "Kitchen");

    await asApp(cfg, (tx) => attachPrinterToStation(tx, { stationId: s1, printerId: p1 }));
    expect(await asApp(cfg, (tx) => listStationPrinters(tx))).toEqual([
      { stationId: s1, printerId: p1 },
    ]);

    await asApp(cfg, (tx) => attachPrinterToStation(tx, { stationId: s1, printerId: p1 }));
    expect(await asApp(cfg, (tx) => listStationPrinters(tx))).toEqual([
      { stationId: s1, printerId: p1 },
    ]);
  });

  it("detaches a mapping and is idempotent on a repeat detach on a live station", async () => {
    const cfg = await setupVenue();
    const s1 = await station(cfg, "Main kitchen");
    const p1 = await printer(cfg, "Kitchen");
    await asApp(cfg, (tx) => attachPrinterToStation(tx, { stationId: s1, printerId: p1 }));

    await asApp(cfg, (tx) => detachPrinterFromStation(tx, { stationId: s1, printerId: p1 }));
    expect(await asApp(cfg, (tx) => listStationPrinters(tx))).toEqual([]);

    await asApp(cfg, (tx) => detachPrinterFromStation(tx, { stationId: s1, printerId: p1 }));
    expect(await asApp(cfg, (tx) => listStationPrinters(tx))).toEqual([]);
  });

  it("rejects an attach to a station that is not live (station.not_found)", async () => {
    const cfg = await setupVenue();
    const p1 = await printer(cfg, "Kitchen");
    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) =>
        attachPrinterToStation(tx, {
          stationId: missing,
          printerId: p1,
        }),
      ),
    ).rejects.toMatchObject({ code: "station.not_found", params: { stationId: missing } });
  });

  it("rejects an attach to a printer that is not live (printer.not_found)", async () => {
    const cfg = await setupVenue();
    const s1 = await station(cfg, "Main kitchen");
    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) =>
        attachPrinterToStation(tx, {
          stationId: s1,
          printerId: missing,
        }),
      ),
    ).rejects.toMatchObject({ code: "printer.not_found", params: { id: missing } });
  });

  it("filters the listing by stationId and by printerId", async () => {
    const cfg = await setupVenue();
    const s1 = await station(cfg, "Main kitchen");
    const s2 = await station(cfg, "Griddle");
    const p1 = await printer(cfg, "Kitchen");
    const p2 = await printer(cfg, "Pass");
    // A group printer (p1) on both stations; a station-local printer (p2) on s1 only.
    for (const [stationId, printerId] of [
      [s1, p1],
      [s1, p2],
      [s2, p1],
    ] as const) {
      await asApp(cfg, (tx) => attachPrinterToStation(tx, { stationId, printerId }));
    }

    const all = await asApp(cfg, (tx) => listStationPrinters(tx));
    expect(all).toHaveLength(3);
    expect(all).toContainEqual({ stationId: s1, printerId: p1 });
    expect(all).toContainEqual({ stationId: s1, printerId: p2 });
    expect(all).toContainEqual({ stationId: s2, printerId: p1 });

    const byStation = await asApp(cfg, (tx) => listStationPrinters(tx, { stationId: s1 }));
    expect(byStation).toHaveLength(2);
    expect(byStation).toContainEqual({ stationId: s1, printerId: p1 });
    expect(byStation).toContainEqual({ stationId: s1, printerId: p2 });

    const byPrinter = await asApp(cfg, (tx) => listStationPrinters(tx, { printerId: p1 }));
    expect(byPrinter).toHaveLength(2);
    expect(byPrinter).toContainEqual({ stationId: s1, printerId: p1 });
    expect(byPrinter).toContainEqual({ stationId: s2, printerId: p1 });
  });
});

describe("station→printer mapping verbs naming a deleted printer", () => {
  async function venueWithLinks() {
    const cfg = await setupVenue();
    const s1 = await station(cfg, "Main kitchen");
    const gone = await printer(cfg, "Gone");
    const kept = await printer(cfg, "Kept");
    for (const printerId of [gone, kept]) {
      await asApp(cfg, (tx) => attachPrinterToStation(tx, { stationId: s1, printerId }));
    }
    return { cfg, s1, gone, kept };
  }

  const allLinks = () =>
    db.select().from(stationPrinters).orderBy(stationPrinters.stationId, stationPrinters.printerId);

  it("refuses attaching, detaching and listing by it with printer.not_found, changing nothing", async () => {
    const { cfg, s1, gone } = await venueWithLinks();
    const s2 = await station(cfg, "Griddle");
    await asApp(cfg, (tx) => deletePrinter(tx, gone));
    const before = await allLinks();

    for (const run of [
      (tx: Transaction): Promise<unknown> =>
        attachPrinterToStation(tx, { stationId: s2, printerId: gone }),
      (tx: Transaction) => detachPrinterFromStation(tx, { stationId: s1, printerId: gone }),
      (tx: Transaction) => listStationPrinters(tx, { printerId: gone }),
      (tx: Transaction) => replaceStationPrinters(tx, s2, [gone]),
    ]) {
      await expect(asApp(cfg, run)).rejects.toMatchObject({
        code: "printer.not_found",
        params: { id: gone },
      });
    }
    expect(await allLinks()).toEqual(before);
  });

  it("refuses a replacement list still naming one it already stores, changing nothing", async () => {
    const { cfg, s1, gone, kept } = await venueWithLinks();
    const fresh = await printer(cfg, "Fresh");
    // Only the tombstone: a real delete removes the link, so this pins a backstop for a state it
    // never leaves.
    await db
      .update(printers)
      .set({ active: false, deletedAt: new Date().toISOString() })
      .where(eq(printers.id, gone));
    const before = await allLinks();

    await expect(
      asApp(cfg, (tx) => replaceStationPrinters(tx, s1, [gone, kept, fresh])),
    ).rejects.toMatchObject({ code: "printer.not_found", params: { id: gone } });
    expect(await allLinks()).toEqual(before);
  });

  it("still replaces a list without it, after the delete", async () => {
    const { cfg, s1, gone, kept } = await venueWithLinks();
    await asApp(cfg, (tx) => deletePrinter(tx, gone));

    await asApp(cfg, (tx) => replaceStationPrinters(tx, s1, []));
    expect(await allLinks()).toEqual([]);
    await asApp(cfg, (tx) => replaceStationPrinters(tx, s1, [kept]));
    expect(await allLinks()).toEqual([{ stationId: s1, printerId: kept }]);
  });

  it("still lists, keeps and detaches a switched-off printer's links", async () => {
    const { cfg, s1, gone, kept } = await venueWithLinks();
    await asApp(cfg, (tx) => updatePrinter(tx, gone, { active: false }));

    expect(await asApp(cfg, (tx) => listStationPrinters(tx, { printerId: gone }))).toEqual([
      { stationId: s1, printerId: gone },
    ]);
    await asApp(cfg, (tx) => replaceStationPrinters(tx, s1, [gone, kept]));
    expect(await allLinks()).toContainEqual({ stationId: s1, printerId: gone });
    await asApp(cfg, (tx) => detachPrinterFromStation(tx, { stationId: s1, printerId: gone }));
    expect(await allLinks()).toEqual([{ stationId: s1, printerId: kept }]);
  });
});

it("configuration printer lists hide removed stations", async () => {
  const cfg = await setupVenue();
  const stationId = await station(cfg, "Removed mapping");
  const printerId = await printer(cfg, "Removed mapping printer");
  await asApp(cfg, (tx) => attachPrinterToStation(tx, { stationId, printerId }));
  await asApp(cfg, (tx) =>
    tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, stationId)),
  );
  expect(await asApp(cfg, (tx) => listStationPrinters(tx))).toEqual([]);
  for (const action of [
    () => asApp(cfg, (tx) => listStationPrinters(tx, { stationId })),
    () => asApp(cfg, (tx) => attachPrinterToStation(tx, { stationId, printerId })),
    () => asApp(cfg, (tx) => detachPrinterFromStation(tx, { stationId, printerId })),
    () => asApp(cfg, (tx) => replaceStationPrinters(tx, stationId, [])),
  ])
    await expect(action()).rejects.toMatchObject({
      code: "station.not_found",
      params: { stationId },
    });
});
