import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  kitchenStations,
  printJobs,
  printers,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue, attachStationPrinterForTest } from "@waitron/db/testing/seed.js";
import { MAX_DELIVERY_ATTEMPTS, PRINTER_UNPAIRED } from "@waitron/printing";
import { printersInTrouble } from "./print-job-trouble.js";

const NOW = new Date("2026-09-15T12:00:00Z");

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});

function minsAgo(mins: number): string {
  return new Date(NOW.getTime() - mins * 60_000).toISOString();
}

async function prepareVenue(name = "Counter"): Promise<void> {
  await seedVenue(suite.db, { name, invoiceLocales: ["es-ES"], operationDescription: "Retail" });
}

async function seedPrinter(t: { name: string; active?: boolean }): Promise<string> {
  const [row] = await suite.db
    .insert(printers)
    .values({
      name: t.name,
      transport: "network_tcp",
      host: "10.0.0.1",
      active: t.active ?? true,
    })
    .returning({ id: printers.id });
  return row!.id;
}

async function seedJob(t: {
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

async function seedStation(t: { printerId: string; active: boolean }): Promise<void> {
  const [station] = await suite.db
    .insert(kitchenStations)
    .values({ name: "Kitchen", isDefault: false, active: t.active })
    .returning({ id: kitchenStations.id });
  await attachStationPrinterForTest(suite.db, station!.id, t.printerId);
}

const exhausted = { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS } as const;

async function read() {
  return withTransaction(suite.db, (tx) => printersInTrouble(tx, NOW));
}

describe("printersInTrouble", () => {
  it("names an active printer whose document has waited past two minutes, with how many and the oldest", async () => {
    await prepareVenue();
    const id = await seedPrinter({ name: "Bar" });
    await seedJob({ printerId: id, createdAt: minsAgo(10), status: "done" });
    await seedJob({ printerId: id, createdAt: minsAgo(5) });
    await seedJob({ printerId: id, createdAt: minsAgo(3) });

    expect(await read()).toEqual([
      { id, name: "Bar", count: 2, oldest: minsAgo(5), stuckSince: minsAgo(5), kitchen: false },
    ]);
  });

  it("names nothing for a young job, a drawer pulse, a job an Unpair ended, or a switched-off printer", async () => {
    await prepareVenue();
    const bar = await seedPrinter({ name: "Bar" });
    const off = await seedPrinter({ name: "Kitchen", active: false });
    await seedJob({ printerId: bar, createdAt: minsAgo(1) });
    await seedJob({ printerId: bar, createdAt: minsAgo(10), kind: "drawer" });
    await seedJob({
      printerId: bar,
      createdAt: minsAgo(10),
      status: "failed",
      lastError: PRINTER_UNPAIRED,
    });
    await seedJob({ printerId: off, createdAt: minsAgo(10) });

    expect(await read()).toEqual([]);
  });

  it("a printer that has printed a later document is in trouble but not stuck", async () => {
    await prepareVenue();
    const id = await seedPrinter({ name: "Bar" });
    await seedJob({ printerId: id, createdAt: minsAgo(10), ...exhausted });
    await seedJob({ printerId: id, createdAt: minsAgo(5), status: "done" });

    expect(await read()).toMatchObject([{ count: 1, oldest: minsAgo(10), stuckSince: null }]);
  });

  it("a printer whose only printed document came before its stuck one stays stuck", async () => {
    await prepareVenue();
    const id = await seedPrinter({ name: "Bar" });
    await seedJob({ printerId: id, createdAt: minsAgo(5), status: "done" });
    await seedJob({ printerId: id, createdAt: minsAgo(10), ...exhausted });

    expect(await read()).toMatchObject([{ count: 1, stuckSince: minsAgo(10) }]);

    await seedJob({
      printerId: id,
      createdAt: minsAgo(4),
      kind: "drawer",
      status: "done",
    });

    expect(await read()).toMatchObject([{ count: 1, stuckSince: minsAgo(10) }]);
  });

  it("marks a printer an active kitchen station prints to", async () => {
    await prepareVenue();
    const id = await seedPrinter({ name: "Kitchen" });
    await seedStation({ printerId: id, active: true });
    await seedJob({ printerId: id, createdAt: minsAgo(10) });

    expect(await read()).toMatchObject([{ id, kitchen: true }]);
  });

  it("a printer whose only station is switched off is not a kitchen printer", async () => {
    await prepareVenue();
    const id = await seedPrinter({ name: "Kitchen" });
    await seedStation({ printerId: id, active: false });
    await seedJob({ printerId: id, createdAt: minsAgo(10) });

    expect(await read()).toMatchObject([{ id, kitchen: false }]);
  });
});
