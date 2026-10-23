import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import {
  CORE_MIGRATIONS,
  kitchenStations,
  locations,
  printJobs,
  printers,
  stationPrinters,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { MAX_DELIVERY_ATTEMPTS, PRINTER_UNPAIRED } from "@waitron/printing";
import { printersInTrouble } from "./print-job-trouble.js";

const NOW = new Date("2026-09-15T12:00:00Z");

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});

function minsAgo(mins: number): string {
  return new Date(NOW.getTime() - mins * 60_000).toISOString();
}

async function seedLocation(name = "Counter"): Promise<string> {
  const [row] = await suite.db
    .insert(locations)
    .values({ name, invoiceLocales: ["es-ES"], operationDescription: "Retail" })
    .returning({ id: locations.id });
  return row!.id;
}

async function seedPrinter(t: {
  locationId: string;
  name: string;
  active?: boolean;
}): Promise<string> {
  const [row] = await suite.db
    .insert(printers)
    .values({
      locationId: t.locationId,
      name: t.name,
      transport: "network_tcp",
      host: "10.0.0.1",
      active: t.active ?? true,
    })
    .returning({ id: printers.id });
  return row!.id;
}

async function seedJob(t: {
  locationId: string;
  printerId: string;
  createdAt: string;
  kind?: "document" | "drawer";
  status?: "queued" | "printing" | "done" | "failed";
  attempts?: number;
  lastError?: string;
}): Promise<string> {
  const [row] = await suite.db
    .insert(printJobs)
    .values({
      locationId: t.locationId,
      printerId: t.printerId,
      payload: Uint8Array.from([0x01]),
      kind: t.kind ?? "document",
      status: t.status ?? "queued",
      attempts: t.attempts ?? 0,
      lastError: t.lastError ?? null,
      createdAt: t.createdAt,
    })
    .returning({ id: printJobs.id });
  return row!.id;
}

async function seedStation(t: {
  locationId: string;
  printerId: string;
  active: boolean;
}): Promise<void> {
  const [station] = await suite.db
    .insert(kitchenStations)
    .values({ locationId: t.locationId, name: "Kitchen", isDefault: false, active: t.active })
    .returning({ id: kitchenStations.id });
  await suite.db.insert(stationPrinters).values({ stationId: station!.id, printerId: t.printerId });
}

const exhausted = { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS } as const;

async function read(options?: { locationId?: string }) {
  return withTransaction(suite.db, (tx) => printersInTrouble(tx, NOW, options));
}

describe("printersInTrouble", () => {
  it("names an active printer whose document has waited past two minutes, with how many and the oldest", async () => {
    await seedTenant(suite.db);
    const locationId = await seedLocation();
    const id = await seedPrinter({ locationId, name: "Bar" });
    await seedJob({ locationId, printerId: id, createdAt: minsAgo(10), status: "done" });
    await seedJob({ locationId, printerId: id, createdAt: minsAgo(5) });
    await seedJob({ locationId, printerId: id, createdAt: minsAgo(3) });

    expect(await read()).toEqual([
      { id, name: "Bar", count: 2, oldest: minsAgo(5), stuckSince: minsAgo(5), kitchen: false },
    ]);
  });

  it("names nothing for a young job, a drawer pulse, a job an Unpair ended, or a switched-off printer", async () => {
    await seedTenant(suite.db);
    const locationId = await seedLocation();
    const bar = await seedPrinter({ locationId, name: "Bar" });
    const off = await seedPrinter({ locationId, name: "Kitchen", active: false });
    await seedJob({ locationId, printerId: bar, createdAt: minsAgo(1) });
    await seedJob({ locationId, printerId: bar, createdAt: minsAgo(10), kind: "drawer" });
    await seedJob({
      locationId,
      printerId: bar,
      createdAt: minsAgo(10),
      status: "failed",
      lastError: PRINTER_UNPAIRED,
    });
    await seedJob({ locationId, printerId: off, createdAt: minsAgo(10) });

    expect(await read()).toEqual([]);
  });

  it("a printer that has printed a later document is in trouble but not stuck", async () => {
    await seedTenant(suite.db);
    const locationId = await seedLocation();
    const id = await seedPrinter({ locationId, name: "Bar" });
    await seedJob({ locationId, printerId: id, createdAt: minsAgo(10), ...exhausted });
    await seedJob({ locationId, printerId: id, createdAt: minsAgo(5), status: "done" });

    expect(await read()).toMatchObject([{ count: 1, oldest: minsAgo(10), stuckSince: null }]);
  });

  it("a printer whose only printed document came before its stuck one stays stuck", async () => {
    await seedTenant(suite.db);
    const locationId = await seedLocation();
    const id = await seedPrinter({ locationId, name: "Bar" });
    await seedJob({ locationId, printerId: id, createdAt: minsAgo(5), status: "done" });
    await seedJob({ locationId, printerId: id, createdAt: minsAgo(10), ...exhausted });

    expect(await read()).toMatchObject([{ count: 1, stuckSince: minsAgo(10) }]);

    await seedJob({
      locationId,
      printerId: id,
      createdAt: minsAgo(4),
      kind: "drawer",
      status: "done",
    });

    expect(await read()).toMatchObject([{ count: 1, stuckSince: minsAgo(10) }]);
  });

  it("marks a printer an active kitchen station prints to", async () => {
    await seedTenant(suite.db);
    const locationId = await seedLocation();
    const id = await seedPrinter({ locationId, name: "Kitchen" });
    await seedStation({ locationId, printerId: id, active: true });
    await seedJob({ locationId, printerId: id, createdAt: minsAgo(10) });

    expect(await read()).toMatchObject([{ id, kitchen: true }]);
  });

  it("a printer whose only station is switched off is not a kitchen printer", async () => {
    await seedTenant(suite.db);
    const locationId = await seedLocation();
    const id = await seedPrinter({ locationId, name: "Kitchen" });
    await seedStation({ locationId, printerId: id, active: false });
    await seedJob({ locationId, printerId: id, createdAt: minsAgo(10) });

    expect(await read()).toMatchObject([{ id, kitchen: false }]);
  });

  it("given a location, names only that location's printers", async () => {
    await seedTenant(suite.db);
    const first = await seedLocation("Counter");
    const second = await seedLocation("Terrace");
    const bar = await seedPrinter({ locationId: first, name: "Bar" });
    const kitchen = await seedPrinter({ locationId: second, name: "Kitchen" });
    await seedJob({ locationId: first, printerId: bar, createdAt: minsAgo(10) });
    await seedJob({ locationId: second, printerId: kitchen, createdAt: minsAgo(10) });

    expect((await read({ locationId: first })).map((p) => p.id)).toEqual([bar]);
    expect((await read()).map((p) => p.id).sort()).toEqual([bar, kitchen].sort());
  });
});
