import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  drawerOpens,
  invoiceSeries,
  kitchenPrintJobs,
  kitchenStations,
  locations,
  openVenueDatabase,
  printers,
  printJobs,
  receiptReprints,
  withTransaction,
  workingOrders,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { recordSale } from "@waitron/core";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import type { TrustedClock } from "@waitron/fiscal";
import { jobOrigin, locationId as brandLocationId, nodeId, seriesId } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import { restoreDatabase } from "./restore.js";
import { deletePrinter } from "./printer-delete.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

const DELETED_AT = new Date("2026-10-10T10:00:00.000Z");
const clock: TrustedClock = {
  now: () => ({
    instant: new Date("2026-10-10T09:00:00.000Z"),
    offsetMinutes: 0,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("Unused anchor");
  },
  currentAnchor: () => null,
};

async function newSale(): Promise<string> {
  const [series] = await suite.db.select().from(invoiceSeries);
  const modules = enabledModules(
    ALL_MODULES,
    venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat"),
  );
  const backend = fiscalSlot(modules, null).makeBackend({
    db: suite.db,
    clock,
    environment: "preproduction",
  });
  const sale = await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, {
      origin: jobOrigin("operator_script"),
      nodeId: nodeId(series!.nodeId),
      seriesId: seriesId(series!.id),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      total: "1.00",
      lines: [
        {
          lineNo: 1,
          name: "Coffee",
          descriptions: { "es-ES": "Café" },
          quantity: "1",
          unitPrice: "1.00",
          vatRate: "0",
          lineTotal: "1.00",
        },
      ],
      clock,
      settlement: { kind: "deferred" },
    }),
  );
  return sale.saleId;
}

/** "Old kitchen" with a printed receipt, its reprint audit, a kitchen ticket, a drawer calibration
 * and one job still waiting; deleted, then replaced by "New kitchen" on the same address. */
async function seedDeletedAndReplaced() {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Bar", invoiceLocales: ["es-ES"], operationDescription: "Sale on premises" })
    .returning({ id: locations.id });
  const locationId = location!.id;
  const node = await seedNode(suite.db, brandLocationId(locationId));
  await suite.db.insert(invoiceSeries).values({ nodeId: node, code: "F", purpose: "standard" });
  const [old] = await suite.db
    .insert(printers)
    .values({ locationId, name: "Old kitchen", transport: "network_tcp", host: "10.0.4.1" })
    .returning({ id: printers.id });
  const saleId = await newSale();
  const job = async (values: Partial<typeof printJobs.$inferInsert>) =>
    (
      await suite.db
        .insert(printJobs)
        .values({ locationId, printerId: old!.id, payload: new Uint8Array([27, 64]), ...values })
        .returning({ id: printJobs.id })
    )[0]!.id;
  await job({ status: "done", attempts: 1, saleId, receiptCopy: false });
  const copy = await job({ status: "done", attempts: 1, saleId, receiptCopy: true });
  const ticket = await job({ status: "done", attempts: 1 });
  const waiting = await job({});
  await suite.db
    .insert(receiptReprints)
    .values({ saleId, printJobId: copy, personId: "staff-one" });
  await suite.db
    .insert(drawerOpens)
    .values({ printerId: old!.id, personId: "manager-one", reason: "calibration" });
  const [station] = await suite.db
    .insert(kitchenStations)
    .values({ locationId, name: "Grill" })
    .returning({ id: kitchenStations.id });
  const [order] = await suite.db
    .insert(workingOrders)
    .values({ source: "dashboard", locationId, orderNumber: 1 })
    .returning({ id: workingOrders.id });
  await suite.db
    .insert(kitchenPrintJobs)
    .values({
      printJobId: ticket,
      workingOrderId: order!.id,
      stationId: station!.id,
      reprint: false,
    });

  await withTransaction(suite.db, (tx) => deletePrinter(tx, { locationId }, old!.id, DELETED_AT));
  const [replacement] = await suite.db
    .insert(printers)
    .values({ locationId, name: "New kitchen", transport: "network_tcp", host: "10.0.4.1" })
    .returning({ id: printers.id });
  return { old: old!.id, replacement: replacement!.id, waiting };
}

/** The rows of the tables a deleted printer's history lives in, each in a fixed order. */
function history(db: Database) {
  const all = (query: ReturnType<typeof sql>) => db.all<Record<string, unknown>>(query);
  return {
    printers: all(sql`select * from printers order by id`),
    print_jobs: all(sql`select * from print_jobs order by id`),
    receipt_reprints: all(sql`select * from receipt_reprints order by id`),
    drawer_opens: all(sql`select * from drawer_opens order by id`),
    kitchen_print_jobs: all(sql`select * from kitchen_print_jobs order by print_job_id`),
    named_jobs: all(sql`
      select print_jobs.id, print_jobs.status, printers.name
      from print_jobs join printers on printers.id = print_jobs.printer_id
      order by print_jobs.id
    `),
  };
}

describe("a deleted printer's history in a full archive", () => {
  it("keeps the deleted printer, its ended jobs, their names and every key naming it, through an archive and a restore", async () => {
    const { old, replacement, waiting } = await seedDeletedAndReplaced();
    const before = history(suite.db);
    const scratch = await mkdtemp(join(tmpdir(), "waitron-printer-history-"));
    const venueDir = join(scratch, "venue");
    try {
      await suite.db.archiveTo(join(scratch, "venue.dump"));
      await restoreDatabase({
        dumpBytes: await readFile(join(scratch, "venue.dump")),
        venueDir,
        log: () => {},
      });
      const restored = await openVenueDatabase(venueDir);
      try {
        const after = history(restored.venue);
        expect(after).toEqual(before);
        expect(after.printers.map((row) => [row.id, row.name, row.active, row.deleted_at])).toEqual(
          [
            [old, "Old kitchen", 0, DELETED_AT.toISOString()],
            [replacement, "New kitchen", 1, null],
          ].sort((a, b) => (a[0]! < b[0]! ? -1 : 1)),
        );
        const oldJobs = after.print_jobs.filter((row) => row.printer_id === old);
        expect(oldJobs).toHaveLength(4);
        expect(oldJobs.map((row) => row.status).sort()).toEqual(["done", "done", "done", "failed"]);
        expect(oldJobs.find((row) => row.id === waiting)?.last_error).toBe("printer.deleted");
        expect(new Set(after.named_jobs.map((row) => row.name))).toEqual(new Set(["Old kitchen"]));
        expect(after.receipt_reprints).toHaveLength(1);
        expect(after.drawer_opens.map((row) => row.printer_id)).toEqual([old]);
        expect(after.kitchen_print_jobs).toHaveLength(1);
        expect(restored.venue.all(sql`pragma foreign_key_check`)).toEqual([]);
      } finally {
        await restored.close();
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
