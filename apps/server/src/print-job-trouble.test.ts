import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  insertInChunks,
  kitchenPrintJobs,
  kitchenStations,
  printJobs,
  printers,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue, attachStationPrinterForTest } from "@waitron/db/testing/seed.js";
import { MAX_DELIVERY_ATTEMPTS, PRINTER_UNPAIRED } from "@waitron/printing";
import { SQL_VARIABLE_LIMIT } from "@waitron/store";
import { printersInTrouble, printersInTroubleQuery } from "./print-job-trouble.js";

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
  it("searches each printer's unprinted jobs, and its later printed ones, through the pull index", async () => {
    await prepareVenue();
    const plan = await withTransaction(suite.db, async (tx) => {
      const rows = await tx.execute<{ detail: string }>(
        sql`explain query plan ${printersInTroubleQuery(tx, NOW).getSQL()}`,
      );
      return rows.rows.map((row) => row.detail);
    });

    expect(plan).toContain(
      "SEARCH print_jobs USING INDEX print_jobs_pull_idx (printer_id=? AND status=?)",
    );
    expect(plan).toContain(
      "SEARCH trouble_later_printed USING INDEX print_jobs_pull_idx (printer_id=? AND status=? AND rowid>?)",
    );
  });

  it("names an active printer whose document has waited past two minutes, with how many and the oldest", async () => {
    await prepareVenue();
    const id = await seedPrinter({ name: "Bar" });
    await seedJob({ printerId: id, createdAt: minsAgo(10), status: "done" });
    await seedJob({ printerId: id, createdAt: minsAgo(5) });
    await seedJob({ printerId: id, createdAt: minsAgo(3) });

    expect(await read()).toEqual([
      {
        id,
        name: "Bar",
        count: 2,
        oldest: minsAgo(5),
        stuckSince: minsAgo(5),
        givenUp: false,
        kitchen: false,
      },
    ]);
  });

  it("counts a document still printing past two minutes", async () => {
    await prepareVenue();
    const id = await seedPrinter({ name: "Bar" });
    await seedJob({ printerId: id, createdAt: minsAgo(3), status: "printing" });

    expect(await read()).toMatchObject([{ id, count: 1, oldest: minsAgo(3) }]);
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

  it("says whether any of a printer's troubled jobs was given up, not one still being tried", async () => {
    await prepareVenue();
    const tried = await seedPrinter({ name: "Bar" });
    const gaveUp = await seedPrinter({ name: "Kitchen" });
    await seedJob({ printerId: tried, createdAt: minsAgo(10) });
    await seedJob({
      printerId: tried,
      createdAt: minsAgo(9),
      status: "failed",
      attempts: MAX_DELIVERY_ATTEMPTS - 1,
    });
    await seedJob({ printerId: tried, createdAt: minsAgo(5), status: "done" });
    await seedJob({ printerId: gaveUp, createdAt: minsAgo(10) });
    await seedJob({ printerId: gaveUp, createdAt: minsAgo(9), ...exhausted });
    await seedJob({ printerId: gaveUp, createdAt: minsAgo(5), status: "done" });

    const rows = await read();
    expect(rows.find((r) => r.id === tried)).toMatchObject({
      count: 2,
      stuckSince: null,
      givenUp: false,
    });
    expect(rows.find((r) => r.id === gaveUp)).toMatchObject({
      count: 2,
      stuckSince: null,
      givenUp: true,
    });
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

  it("reads more troubled jobs, and kitchen tickets on more bills, than one statement can bind", async () => {
    await prepareVenue();
    const id = await seedPrinter({ name: "Kitchen" });
    const [station] = await suite.db
      .insert(kitchenStations)
      .values({ name: "Kitchen", isDefault: false, active: true })
      .returning({ id: kitchenStations.id });
    await attachStationPrinterForTest(suite.db, station!.id, id);
    const many = SQL_VARIABLE_LIMIT + 1;
    const job = (createdAt: string) => ({
      id: randomUUID(),
      printerId: id,
      payload: Uint8Array.from([0x01]),
      kind: "document" as const,
      createdAt,
      ...exhausted,
    });
    const others = Array.from({ length: many }, () => job(minsAgo(5)));
    const tickets = Array.from({ length: many }, () => job(minsAgo(10)));
    const orders = tickets.map(() => ({
      id: randomUUID(),
      source: "dashboard" as const,
      orderNumber: 1,
    }));
    await withTransaction(suite.db, async (tx) => {
      await insertInChunks(tx, printJobs, [...tickets, ...others]);
      await insertInChunks(tx, workingOrders, orders);
      await insertInChunks(
        tx,
        kitchenPrintJobs,
        tickets.map((ticket, i) => ({
          printJobId: ticket.id,
          workingOrderId: orders[i]!.id,
          stationId: station!.id,
          reprint: false,
        })),
      );
    });

    // No bill has a dish a Reprint would print, so every kitchen ticket leaves nothing waiting.
    expect(await read()).toEqual([
      {
        id,
        name: "Kitchen",
        count: many,
        oldest: minsAgo(5),
        stuckSince: minsAgo(5),
        givenUp: true,
        kitchen: true,
      },
    ]);
  });

  it("a printer whose only station is switched off is not a kitchen printer", async () => {
    await prepareVenue();
    const id = await seedPrinter({ name: "Kitchen" });
    await seedStation({ printerId: id, active: false });
    await seedJob({ printerId: id, createdAt: minsAgo(10) });

    expect(await read()).toMatchObject([{ id, kitchen: false }]);
  });
});
