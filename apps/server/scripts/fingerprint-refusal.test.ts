import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { incidents, sales } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { recordOneSale } from "./record-one-sale.js";
import { settleInvoiceFirst } from "./settle-invoice-first.js";
import { provisionTestVenue } from "./testing/venue.js";
import { createDemoVenueProvisioner } from "./demo-seed/testing/provision-venue.js";
import { seedSales } from "./demo-seed/seed-sales.js";

const fault = vi.hoisted(() => ({ calls: 0, failAt: 1 }));
vi.mock("@waitron/verifactu", async (importOriginal) => {
  const real = await importOriginal<typeof import("@waitron/verifactu")>();
  return {
    ...real,
    buildAltaRecord: (...args: Parameters<typeof real.buildAltaRecord>) => {
      const record = real.buildAltaRecord(...args);
      if (++fault.calls === fault.failAt)
        record.Huella = (record.Huella[0] === "A" ? "B" : "A") + record.Huella.slice(1);
      return record;
    },
  };
});

const directories: string[] = [];
afterEach(async () => {
  fault.calls = 0;
  fault.failAt = 1;
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.unstubAllEnvs();
});

async function box() {
  const directory = await mkdtemp(join(tmpdir(), "a1003-script-"));
  directories.push(directory);
  await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
  return {
    directory,
    venue: await provisionTestVenue(directory, "50000000R"),
    env: { WAITRON_VENUE_DIR: directory, WAITRON_ENV: "preproduction" },
  };
}

function read(directory: string) {
  const db = new DatabaseSync(join(directory, "venue.db"), { readOnly: true });
  try {
    return {
      sales: db.prepare("select total from sales order by invoice_number").all(),
      counters: db.prepare("select id, code, next_number from invoice_series order by code").all(),
      records: db.prepare("select count(*) as count from registros_facturacion").get(),
      outbox: db.prepare("select count(*) as count from envios").get(),
      incidents: db.prepare("select code, sale_id, source from incidents").all(),
    };
  } finally {
    db.close();
  }
}

describe("operator scripts retain the refusal after their issuance rolls back", () => {
  it("recordOneSale writes only its incident", async () => {
    const { directory, venue, env } = await box();
    const before = read(directory);
    await expect(
      recordOneSale(
        {
          nodeId: venue.nodeId,
          seriesId: venue.seriesId,
          description: "Test meal",
          baseAmount: "100.00",
          vatRate: "10.00",
          tipAmount: "0.00",
        },
        env,
      ),
    ).rejects.toMatchObject({ code: "fiscal.fingerprint_mismatch" });
    expect(read(directory)).toEqual({
      ...before,
      incidents: [
        { code: "fiscal.fingerprint_mismatch", sale_id: null, source: "operator_script" },
      ],
    });
  });

  it("settleInvoiceFirst keeps its original when the correction is refused", async () => {
    const { directory, venue, env } = await box();
    fault.failAt = 2;
    const before = read(directory);
    await expect(
      settleInvoiceFirst(
        {
          nodeId: venue.nodeId,
          standardSeriesId: venue.seriesId,
          rectificativeSeriesId: venue.rectificativeSeriesId,
        },
        env,
        () => {},
      ),
    ).rejects.toMatchObject({ code: "fiscal.fingerprint_mismatch" });
    const after = read(directory);
    expect(after.sales).toEqual([{ total: 11000 }]);
    expect(after.records).toEqual({ count: 1 });
    expect(after.outbox).toEqual({ count: 1 });
    expect(after.counters).toEqual(
      before.counters.map((row) => ({ ...row, next_number: row.id === venue.seriesId ? 2 : 1 })),
    );
    expect(after.incidents).toEqual([
      { code: "fiscal.fingerprint_mismatch", sale_id: null, source: "operator_script" },
    ]);
  });
});

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const provision = createDemoVenueProvisioner(() => suite.db, {
  nifBase: 80000000,
  invoiceLocale: "es",
});

it("demo seeding stops at a refused issuance without keeping that sale", async () => {
  vi.stubEnv("WAITRON_ENV", "preproduction");
  const venue = await provision();
  await expect(
    seedSales(suite.db, {
      venue: { nodeId: venue.nodeId, seriesId: venue.seriesIds[0]! },
      invoiceLocale: "es",
      days: 2,
      products: [
        {
          id: "test-meal",
          name: "Test meal",
          customerName: { es: "Test meal" },
          unitPrice: "10.00",
          vatClass: "general",
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "fiscal.fingerprint_mismatch" });
  expect(await suite.db.select().from(sales)).toEqual([]);
  expect(
    (await suite.db.select().from(incidents)).map((row) => ({
      code: row.code,
      saleId: row.saleId,
      source: row.source,
    })),
  ).toEqual([{ code: "fiscal.fingerprint_mismatch", saleId: null, source: "demo_seed" }]);
});
