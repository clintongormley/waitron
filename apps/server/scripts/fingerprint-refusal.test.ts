import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { incidents, openVenueDatabase, sales } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { registrosFacturacion } from "@waitron/fiscal-verifactu";
import { recordFixtureSale } from "./testing/sale.js";
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
  vi.useRealTimers();
});

async function box() {
  const directory = await mkdtemp(join(tmpdir(), "a1003-script-"));
  directories.push(directory);
  await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
  return {
    directory,
    venue: await provisionTestVenue(directory, "50000000R"),
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
  it("operator-origin issuance writes only its incident", async () => {
    const { directory, venue } = await box();
    const before = read(directory);
    const store = await openVenueDatabase(directory, { exclusive: false });
    try {
      await expect(
        recordFixtureSale(store.venue, {
          nodeId: venue.nodeId,
          seriesId: venue.seriesId,
          description: "Test meal",
          baseAmount: "100.00",
          vatRate: "10.00",
          tipAmount: "0.00",
        }),
      ).rejects.toMatchObject({ code: "fiscal.fingerprint_mismatch" });
    } finally {
      await store.close();
    }
    expect(read(directory)).toEqual({
      ...before,
      incidents: [
        { code: "fiscal.fingerprint_mismatch", sale_id: null, source: "operator_script" },
      ],
    });
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

it("the sale fixture keeps the venue issue date when the host is on the previous day", async () => {
  const provisionSale = createDemoVenueProvisioner(() => suite.db, {
    nifBase: 70000000,
    nifFormat: "calculated",
    invoiceLocale: "es-ES",
  });
  const venue = await provisionSale();
  fault.failAt = Number.POSITIVE_INFINITY;
  vi.stubEnv("TZ", "UTC");
  vi.setSystemTime(new Date("2026-11-01T23:30:00.000Z"));

  await recordFixtureSale(suite.db, {
    nodeId: venue.nodeId,
    seriesId: venue.seriesIds[0]!,
    description: "Test meal",
    baseAmount: "10.00",
    vatRate: "10.00",
  });

  expect(
    await suite.db
      .select({ issuedAt: sales.issuedAt, offsetMinutes: sales.issuedOffsetMinutes })
      .from(sales),
  ).toEqual([{ issuedAt: "2026-11-01T23:30:00.000Z", offsetMinutes: 60 }]);
  expect(
    await suite.db
      .select({ date: registrosFacturacion.fechaExpedicionFactura })
      .from(registrosFacturacion),
  ).toEqual([{ date: "2026-11-02" }]);
});
