/**
 * Back-dated preproduction sales through `recordSale`: the stored environment, the chain, and the
 * reports they light up — and the refusal of a production stamp.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { sales, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { VenueResult } from "@waitron/provisioning";
import { registrosFacturacion } from "@waitron/fiscal-verifactu";
import { computeDailyClose } from "@waitron/reporting";
import {
  addDecimal,
  compareDecimal,
  decimal,
  nodeId as brandNodeId,
  rawCentsToDecimal,
} from "@waitron/shared";
import { seedSales } from "./seed-sales.js";
import type { SeedSalesProduct, SeedSalesVenue } from "./seed-sales.js";

import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";
import { createDemoVenueProvisioner } from "./testing/provision-venue.js";

const LOCALE: SeedLocale = "es";
const DAY_MS = 24 * 60 * 60 * 1000;

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// One product per Spanish VAT class, so the VAT summary has more than one `byRate` line. Prices are
// GROSS (VAT-inclusive).
const PRODUCTS: SeedSalesProduct[] = [
  {
    id: "p-general",
    name: "Solomillo",
    customerName: { [LOCALE]: "Solomillo" },
    unitPrice: "18.50",
    vatClass: "general",
  },
  {
    id: "p-reduced",
    name: "Pan de la casa",
    customerName: { [LOCALE]: "Pan de la casa" },
    unitPrice: "2.40",
    vatClass: "reduced",
  },
  {
    id: "p-super",
    name: "Leche",
    customerName: { [LOCALE]: "Leche" },
    unitPrice: "1.30",
    vatClass: "super_reduced",
  },
  {
    id: "p-zero",
    name: "Agua",
    customerName: { [LOCALE]: "Agua" },
    unitPrice: "1.00",
    vatClass: "zero",
  },
];

const provisionVenue = createDemoVenueProvisioner(() => suite.db, {
  nifBase: 80_000_000,
  invoiceLocale: SEED_INVOICE_LOCALE[LOCALE],
});

function venueFor(v: VenueResult): SeedSalesVenue {
  return {
    nodeId: v.nodeId,
    // planVenue emits the standard series first, then the rectificative one.
    seriesId: v.seriesIds[0]!,
  };
}

describe("seedSales", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fills the last 3 days with back-dated preproduction sales that light up the reports", async () => {
    const venue = await provisionVenue();
    const start = Date.now();

    const { count } = await seedSales(suite.db, {
      venue: venueFor(venue),
      invoiceLocale: SEED_INVOICE_LOCALE[LOCALE],
      days: 3,
      products: PRODUCTS,
    });

    expect(count).toBeGreaterThan(0);

    const read = await withTransaction(suite.db, async (tx) => {
      const saleRows = await tx
        .select({ id: sales.id, issuedAt: sales.issuedAt, total: sales.total })
        .from(sales);
      const registros = await tx
        .select({ entorno: registrosFacturacion.entorno })
        .from(registrosFacturacion);
      const sampled = saleRows[0]!;
      // Money columns read raw are counts of whole cents; `rawCentsToDecimal` converts them at the
      // assertion.
      const { rows: coverage } = await tx.execute<{
        total: string;
        tendered: string;
        tips: string;
      }>(sql`
        select
          cast(s.total as text) as total,
          cast(coalesce(sum(t.amount), 0) as text) as tendered,
          cast(coalesce(sum(t.tip_amount), 0) as text) as tips
        from sales s
        join tenders t on t.sale_id = s.id
        where s.id = ${sampled.id}
        group by s.total`);
      // Business day = yesterday (UTC), which the generator always fills fully and in the past.
      const businessDay = new Date(start - DAY_MS).toISOString().slice(0, 10);
      const close = await computeDailyClose(tx, {
        nodeId: brandNodeId(venue.nodeId),
        businessDay,
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
      });
      return { saleRows, registros, coverage: coverage[0]!, close };
    });

    expect(read.saleRows.length).toBe(count);
    expect(read.registros.length).toBe(count);

    for (const row of read.saleRows) {
      const t = new Date(row.issuedAt).getTime();
      expect(t).toBeLessThan(start);
      expect(t).toBeGreaterThan(start - 3.5 * DAY_MS);
    }

    expect(read.registros.length).toBeGreaterThan(0);
    for (const r of read.registros) {
      expect(r.entorno).toBe("preproduction");
    }

    // Σ tender amount = total + Σ tip.
    const expected = addDecimal(
      rawCentsToDecimal(read.coverage.total),
      rawCentsToDecimal(read.coverage.tips),
    );
    expect(compareDecimal(rawCentsToDecimal(read.coverage.tendered), expected)).toBe(0);

    expect(read.close.vat.byRate.length).toBeGreaterThan(0);
    expect(compareDecimal(read.close.vat.taxTotal, decimal("0.00"))).toBeGreaterThan(0);
    expect(read.close.cash.byOrigin.length).toBeGreaterThan(0);
    expect(compareDecimal(read.close.cash.tenderTotal, decimal("0.00"))).toBeGreaterThan(0);
  });

  it("records every demo sale and its fiscal record as the demo seed's, with no device", async () => {
    // Its own provisioner: the shared one's fixed `K` letter is a valid NIF for its first venue only.
    const venue = await createDemoVenueProvisioner(() => suite.db, {
      nifBase: 81_000_000,
      nifFormat: "calculated",
      invoiceLocale: SEED_INVOICE_LOCALE[LOCALE],
    })();
    // Two days, not one: before the day's first service slot every one of today's sales would be in
    // the future, so only yesterday guarantees any.
    const { count } = await seedSales(suite.db, {
      venue: venueFor(venue),
      invoiceLocale: SEED_INVOICE_LOCALE[LOCALE],
      days: 2,
      products: PRODUCTS,
    });
    expect(count).toBeGreaterThan(0);

    const pairs = (table: string) =>
      suite.db.all<{ source: string | null; device_id: string | null }>(
        sql`select source, device_id from ${sql.raw(table)}`,
      );
    const expected = Array.from({ length: count }, () => ({
      source: "demo_seed",
      device_id: null,
    }));
    expect(pairs("sales")).toEqual(expected);
    expect(pairs("registros_facturacion")).toEqual(expected);
  });

  it("refuses to file demo sales into a production environment, and writes nothing", async () => {
    const venue = await provisionVenue();
    vi.stubEnv("WAITRON_ENV", "production");

    await expect(
      seedSales(suite.db, {
        venue: venueFor(venue),
        invoiceLocale: SEED_INVOICE_LOCALE[LOCALE],
        days: 3,
        products: PRODUCTS,
      }),
    ).rejects.toMatchObject({ code: "deployment.demo_data_refused" });

    const read = await withTransaction(suite.db, async (tx) => ({
      sales: await tx.select({ id: sales.id }).from(sales),
      registros: await tx
        .select({ entorno: registrosFacturacion.entorno })
        .from(registrosFacturacion),
    }));
    expect(read.sales.length).toBe(0);
    expect(read.registros.length).toBe(0);
  });

  it("writes nothing when days is 0 (guard by deletion)", async () => {
    const venue = await provisionVenue();

    const { count } = await seedSales(suite.db, {
      venue: venueFor(venue),
      invoiceLocale: SEED_INVOICE_LOCALE[LOCALE],
      days: 0,
      products: PRODUCTS,
    });

    expect(count).toBe(0);

    const saleRows = await withTransaction(suite.db, async (tx) => {
      return tx.select({ id: sales.id }).from(sales);
    });
    expect(saleRows.length).toBe(0);
  });
});
