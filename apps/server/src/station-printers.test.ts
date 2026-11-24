import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  kitchenStations,
  printers,
  stationPrinterPairs,
  withTransaction,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { insertA4Printer } from "@waitron/db/testing/printers.js";
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
  });
  const nodeId = await seedNode(db);
  return {
    nodeId: brandNodeId(nodeId),
    locale: LOCALE,
    simplifiedInvoiceLimit: null,
  };
}

function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

function station(cfg: TradingContext, name: string): Promise<string> {
  return asApp((tx) => createStation(tx, { name })).then((r) => r.id);
}

/** `cloud_poll` needs only a `poll_id`, no agent to seed. */
function printer(cfg: TradingContext, name: string): Promise<string> {
  return asApp((tx) =>
    createPrinter(tx, { name, transport: "cloud_poll", pollId: `poll-${name}` }),
  ).then((r) => r.id);
}

describe("station→printer mapping verbs", () => {
  it("attaches a mapping, lists it, and is idempotent on a repeat attach", async () => {
    const cfg = await setupVenue();
    const s1 = await station(cfg, "Main kitchen");
    const p1 = await printer(cfg, "Kitchen");

    await asApp((tx) => attachPrinterToStation(tx, { stationId: s1, printerId: p1 }));
    expect(await asApp((tx) => listStationPrinters(tx))).toEqual([
      { stationId: s1, printerId: p1 },
    ]);

    await asApp((tx) => attachPrinterToStation(tx, { stationId: s1, printerId: p1 }));
    expect(await asApp((tx) => listStationPrinters(tx))).toEqual([
      { stationId: s1, printerId: p1 },
    ]);
  });

  it("detaches a mapping and is idempotent on a repeat detach on a live station", async () => {
    const cfg = await setupVenue();
    const s1 = await station(cfg, "Main kitchen");
    const p1 = await printer(cfg, "Kitchen");
    await asApp((tx) => attachPrinterToStation(tx, { stationId: s1, printerId: p1 }));

    await asApp((tx) => detachPrinterFromStation(tx, { stationId: s1, printerId: p1 }));
    expect(await asApp((tx) => listStationPrinters(tx))).toEqual([]);

    await asApp((tx) => detachPrinterFromStation(tx, { stationId: s1, printerId: p1 }));
    expect(await asApp((tx) => listStationPrinters(tx))).toEqual([]);
  });

  it("rejects an attach to a station that is not live (station.not_found)", async () => {
    const cfg = await setupVenue();
    const p1 = await printer(cfg, "Kitchen");
    const missing = randomUUID();
    await expect(
      asApp((tx) =>
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
      asApp((tx) =>
        attachPrinterToStation(tx, {
          stationId: s1,
          printerId: missing,
        }),
      ),
    ).rejects.toMatchObject({ code: "printer.not_found", params: { id: missing } });
  });

  it("refuses attaching an office printer", async () => {
    const cfg = await setupVenue();
    const stationId = await station(cfg, "Main kitchen");
    const printerId = await asApp(insertA4Printer);
    await expect(
      asApp((tx) => attachPrinterToStation(tx, { stationId, printerId })),
    ).rejects.toMatchObject({ code: "printer.not_found", params: { id: printerId } });
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
      await asApp((tx) => attachPrinterToStation(tx, { stationId, printerId }));
    }

    const all = await asApp((tx) => listStationPrinters(tx));
    expect(all).toHaveLength(3);
    expect(all).toContainEqual({ stationId: s1, printerId: p1 });
    expect(all).toContainEqual({ stationId: s1, printerId: p2 });
    expect(all).toContainEqual({ stationId: s2, printerId: p1 });

    const byStation = await asApp((tx) => listStationPrinters(tx, { stationId: s1 }));
    expect(byStation).toHaveLength(2);
    expect(byStation).toContainEqual({ stationId: s1, printerId: p1 });
    expect(byStation).toContainEqual({ stationId: s1, printerId: p2 });

    const byPrinter = await asApp((tx) => listStationPrinters(tx, { printerId: p1 }));
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
      await asApp((tx) => attachPrinterToStation(tx, { stationId: s1, printerId }));
    }
    return { cfg, s1, gone, kept };
  }

  const allLinks = () =>
    db
      .select({
        stationId: stationPrinterPairs.stationId,
        printerId: stationPrinterPairs.printerId,
      })
      .from(stationPrinterPairs)
      .orderBy(stationPrinterPairs.stationId, stationPrinterPairs.printerId);

  it("refuses attaching, detaching and listing by it with printer.not_found, changing nothing", async () => {
    const { cfg, s1, gone } = await venueWithLinks();
    const s2 = await station(cfg, "Griddle");
    await asApp((tx) => deletePrinter(tx, gone));
    const before = await allLinks();

    for (const run of [
      (tx: Transaction): Promise<unknown> =>
        attachPrinterToStation(tx, { stationId: s2, printerId: gone }),
      (tx: Transaction) => detachPrinterFromStation(tx, { stationId: s1, printerId: gone }),
      (tx: Transaction) => listStationPrinters(tx, { printerId: gone }),
      (tx: Transaction) => replaceStationPrinters(tx, s2, [gone]),
    ]) {
      await expect(asApp(run)).rejects.toMatchObject({
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
      asApp((tx) => replaceStationPrinters(tx, s1, [gone, kept, fresh])),
    ).rejects.toMatchObject({ code: "printer.not_found", params: { id: gone } });
    expect(await allLinks()).toEqual(before);
  });

  it("still replaces a list without it, after the delete", async () => {
    const { s1, gone, kept } = await venueWithLinks();
    await asApp((tx) => deletePrinter(tx, gone));

    await asApp((tx) => replaceStationPrinters(tx, s1, []));
    expect(await allLinks()).toEqual([]);
    await asApp((tx) => replaceStationPrinters(tx, s1, [kept]));
    expect(await allLinks()).toEqual([{ stationId: s1, printerId: kept }]);
  });

  it("still lists, keeps and detaches a switched-off printer's links", async () => {
    const { s1, gone, kept } = await venueWithLinks();
    await asApp((tx) => updatePrinter(tx, gone, { active: false }));

    expect(await asApp((tx) => listStationPrinters(tx, { printerId: gone }))).toEqual([
      { stationId: s1, printerId: gone },
    ]);
    await asApp((tx) => replaceStationPrinters(tx, s1, [gone, kept]));
    expect(await allLinks()).toContainEqual({ stationId: s1, printerId: gone });
    await asApp((tx) => detachPrinterFromStation(tx, { stationId: s1, printerId: gone }));
    expect(await allLinks()).toEqual([{ stationId: s1, printerId: kept }]);
  });
});

it("configuration printer lists hide removed stations", async () => {
  const cfg = await setupVenue();
  const stationId = await station(cfg, "Removed mapping");
  const printerId = await printer(cfg, "Removed mapping printer");
  await asApp((tx) => attachPrinterToStation(tx, { stationId, printerId }));
  await asApp((tx) =>
    tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, stationId)),
  );
  expect(await asApp((tx) => listStationPrinters(tx))).toEqual([]);
  for (const action of [
    () => asApp((tx) => listStationPrinters(tx, { stationId })),
    () => asApp((tx) => attachPrinterToStation(tx, { stationId, printerId })),
    () => asApp((tx) => detachPrinterFromStation(tx, { stationId, printerId })),
    () => asApp((tx) => replaceStationPrinters(tx, stationId, [])),
  ])
    await expect(action()).rejects.toMatchObject({
      code: "station.not_found",
      params: { stationId },
    });
});

it("attaches one sorted copy and replaces it with exactly the requested sorted list", async () => {
  const cfg = await setupVenue();
  const id = await station(cfg, "Sorted links");
  const ids = [
    await printer(cfg, "One"),
    await printer(cfg, "Two"),
    await printer(cfg, "Three"),
  ].sort();
  const stored = async () =>
    (await db.select().from(kitchenStations).where(eq(kitchenStations.id, id)))[0]!.printerIds;
  for (const printerId of [ids[1]!, ids[0]!, ids[1]!])
    await asApp((tx) => attachPrinterToStation(tx, { stationId: id, printerId }));
  expect(await stored()).toEqual([ids[0], ids[1]]);
  await asApp((tx) => replaceStationPrinters(tx, id, [ids[2]!, ids[0]!, ids[2]!]));
  expect(await stored()).toEqual([ids[0], ids[2]]);
});

it("refuses a newly attached switched-off printer without changing the list", async () => {
  const cfg = await setupVenue();
  const stationId = await station(cfg, "Off printer");
  const printerId = await printer(cfg, "Off");
  await asApp((tx) => updatePrinter(tx, printerId, { active: false }));
  await expect(
    asApp((tx) => attachPrinterToStation(tx, { stationId, printerId })),
  ).rejects.toMatchObject({ code: "printer.not_found", params: { id: printerId } });
  expect(
    (await db.select().from(kitchenStations).where(eq(kitchenStations.id, stationId)))[0]!
      .printerIds,
  ).toEqual([]);
});

it("deleting a printer removes it from every station's stored list and reports both", async () => {
  const cfg = await setupVenue();
  const first = await station(cfg, "First");
  const second = await station(cfg, "Second");
  const removed = await printer(cfg, "Removed");
  const kept = await printer(cfg, "Keep");
  await db
    .update(kitchenStations)
    .set({ printerIds: [removed, kept].sort() })
    .where(eq(kitchenStations.id, first));
  await db
    .update(kitchenStations)
    .set({ printerIds: [removed] })
    .where(eq(kitchenStations.id, second));
  const impact = await asApp((tx) => deletePrinter(tx, removed));
  expect(impact.removes).toContainEqual({
    key: "station_printers",
    count: 2,
    targets: [
      { id: first, name: "First" },
      { id: second, name: "Second" },
    ],
  });
  expect(
    await db
      .select({ id: kitchenStations.id, printerIds: kitchenStations.printerIds })
      .from(kitchenStations)
      .orderBy(kitchenStations.name),
  ).toEqual([
    { id: first, printerIds: [kept] },
    { id: second, printerIds: [] },
  ]);
});
