import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, tills, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { createPrinter } from "@waitron/printing";
import type { PrintConfig } from "@waitron/printing";
import type { TillConfig } from "./till-config.js";
import { createStation } from "./kitchen.js";
import {
  attachPrinterToStation,
  detachPrinterFromStation,
  listStationPrinters,
} from "./station-printers.js";
import "./errors.js";

const LOCALE = "es-ES";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function setupVenue(): Promise<TillConfig> {
  await seedTenant(db);
  // Inserted through the table definitions: the ids and `created_at` are `$defaultFn` generators,
  // which a raw SQL insert never reaches.
  const [loc] = await db
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: [LOCALE],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const locationId = loc!.id;
  const [till] = await db
    .insert(tills)
    .values({ locationId, name: "Caja 1" })
    .returning({ id: tills.id });
  const nodeId = await seedNode(db, brandLocationId(locationId));
  return {
    tillId: brandTillId(till!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

function printCfg(cfg: TillConfig): PrintConfig {
  return { locationId: cfg.locationId };
}

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

function station(cfg: TillConfig, name: string): Promise<string> {
  return asApp(cfg, (tx) => createStation(tx, cfg, { name })).then((r) => r.id);
}

/** `cloud_poll` needs only a `poll_id`, no agent to seed. */
function printer(cfg: TillConfig, name: string): Promise<string> {
  return asApp(cfg, (tx) =>
    createPrinter(tx, printCfg(cfg), { name, transport: "cloud_poll", pollId: `poll-${name}` }),
  ).then((r) => r.id);
}

describe("station→printer mapping verbs", () => {
  it("attaches a mapping, lists it, and is idempotent on a repeat attach", async () => {
    const cfg = await setupVenue();
    const s1 = await station(cfg, "Cocina");
    const p1 = await printer(cfg, "Kitchen");

    await asApp(cfg, (tx) => attachPrinterToStation(tx, { stationId: s1, printerId: p1 }));
    expect(await asApp(cfg, (tx) => listStationPrinters(tx, printCfg(cfg)))).toEqual([
      { stationId: s1, printerId: p1 },
    ]);

    await asApp(cfg, (tx) => attachPrinterToStation(tx, { stationId: s1, printerId: p1 }));
    expect(await asApp(cfg, (tx) => listStationPrinters(tx, printCfg(cfg)))).toEqual([
      { stationId: s1, printerId: p1 },
    ]);
  });

  it("detaches a mapping and is idempotent on a repeat detach (pure delete, no live-check)", async () => {
    const cfg = await setupVenue();
    const s1 = await station(cfg, "Cocina");
    const p1 = await printer(cfg, "Kitchen");
    await asApp(cfg, (tx) => attachPrinterToStation(tx, { stationId: s1, printerId: p1 }));

    await asApp(cfg, (tx) =>
      detachPrinterFromStation(tx, printCfg(cfg), { stationId: s1, printerId: p1 }),
    );
    expect(await asApp(cfg, (tx) => listStationPrinters(tx, printCfg(cfg)))).toEqual([]);

    await asApp(cfg, (tx) =>
      detachPrinterFromStation(tx, printCfg(cfg), { stationId: s1, printerId: p1 }),
    );
    expect(await asApp(cfg, (tx) => listStationPrinters(tx, printCfg(cfg)))).toEqual([]);
  });

  it("rejects an attach to a station that is not live (station.not_found)", async () => {
    const cfg = await setupVenue();
    const p1 = await printer(cfg, "Kitchen");
    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) => attachPrinterToStation(tx, { stationId: missing, printerId: p1 })),
    ).rejects.toMatchObject({ code: "station.not_found", params: { stationId: missing } });
  });

  it("rejects an attach to a printer that is not live (printer.not_found)", async () => {
    const cfg = await setupVenue();
    const s1 = await station(cfg, "Cocina");
    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) => attachPrinterToStation(tx, { stationId: s1, printerId: missing })),
    ).rejects.toMatchObject({ code: "printer.not_found", params: { id: missing } });
  });

  it("filters the listing by stationId and by printerId", async () => {
    const cfg = await setupVenue();
    const s1 = await station(cfg, "Cocina");
    const s2 = await station(cfg, "Plancha");
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

    const all = await asApp(cfg, (tx) => listStationPrinters(tx, printCfg(cfg)));
    expect(all).toHaveLength(3);
    expect(all).toContainEqual({ stationId: s1, printerId: p1 });
    expect(all).toContainEqual({ stationId: s1, printerId: p2 });
    expect(all).toContainEqual({ stationId: s2, printerId: p1 });

    const byStation = await asApp(cfg, (tx) =>
      listStationPrinters(tx, printCfg(cfg), { stationId: s1 }),
    );
    expect(byStation).toHaveLength(2);
    expect(byStation).toContainEqual({ stationId: s1, printerId: p1 });
    expect(byStation).toContainEqual({ stationId: s1, printerId: p2 });

    const byPrinter = await asApp(cfg, (tx) =>
      listStationPrinters(tx, printCfg(cfg), { printerId: p1 }),
    );
    expect(byPrinter).toHaveLength(2);
    expect(byPrinter).toContainEqual({ stationId: s1, printerId: p1 });
    expect(byPrinter).toContainEqual({ stationId: s2, printerId: p1 });
  });
});
