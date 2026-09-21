// Exercise backdated preproduction sales through recordSale on PostgreSQL as app_user.
// Clone the whole manifest once per file and assert the stored environment and chain.

import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, sales, withTransaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";
import type { VenueResult } from "@waitron/provisioning";
import { hashPassword, hashPin } from "@waitron/identity";
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

const LOCALE: SeedLocale = "es";
const DAY_MS = 24 * 60 * 60 * 1000;

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is
// unique, so each provisioned venue needs its own NIF. A distinct base (80_000_000) keeps this
// suite's NIFs from colliding with `till-sale`/`seed-catalogue`'s 50_000_000 range on the shared
// container.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(80_000_000 + nifCounter).padStart(8, "0")}K`;
}

// One product per standing Spanish VAT class, so the filed desglose spans several rates and the VAT
// summary has more than one `byRate` line. Prices are GROSS (VAT-inclusive), the same convention as
// `products.unit_price`.
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

async function provisionVenue(): Promise<VenueResult> {
  return applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Casa Delgado SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [SEED_INVOICE_LOCALE[LOCALE]],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );
}

function venueFor(v: VenueResult): SeedSalesVenue {
  return {
    tillId: v.tillId,
    nodeId: v.nodeId,
    // planVenue emits the standard series first, then the rectificative one.
    seriesId: v.seriesIds[0]!,
  };
}

describe("seedSales", () => {
  it("fills the last 3 days with back-dated preproduction sales that light up the reports", async () => {
    const venue = await provisionVenue();
    const start = Date.now();

    const { count } = await seedSales(suite.admin, {
      venue: venueFor(venue),
      locale: LOCALE,
      days: 3,
      products: PRODUCTS,
    });

    // (a) It recorded something.
    expect(count).toBeGreaterThan(0);

    const read = await withTransaction(suite.admin, async (tx) => {
      await asAppUser(tx);
      const saleRows = await tx
        .select({ id: sales.id, issuedAt: sales.issuedAt, total: sales.total })
        .from(sales);
      const registros = await tx
        .select({ entorno: registrosFacturacion.entorno })
        .from(registrosFacturacion);
      const sampled = saleRows[0]!;
      // Three money columns, all counts of whole cents read raw and converted by
      // `rawCentsToDecimal` at the assertion — see its doc comment. The identity below is checked
      // in the decimal domain, never in cents.
      const { rows: coverage } = await tx.execute<{
        total: string;
        tendered: string;
        tips: string;
      }>(sql`
        select
          s.total::text as total,
          coalesce(sum(t.amount), 0)::text as tendered,
          coalesce(sum(t.tip_amount), 0)::text as tips
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

    // Count matches: one sale row per recorded sale, one fiscal record per sale.
    expect(read.saleRows.length).toBe(count);
    expect(read.registros.length).toBe(count);

    // (b) Every sale is back-dated: strictly in the past, and within the last 3 days.
    for (const row of read.saleRows) {
      const t = new Date(row.issuedAt).getTime();
      expect(t).toBeLessThan(start);
      expect(t).toBeGreaterThan(start - 3.5 * DAY_MS);
    }

    // (c) Every fiscal record carries the preproduction stamp — never production.
    expect(read.registros.length).toBeGreaterThan(0);
    for (const r of read.registros) {
      expect(r.entorno).toBe("preproduction");
    }

    // (d) Coverage identity for the sampled sale: Σ tender amount = total + Σ tip.
    const expected = addDecimal(
      rawCentsToDecimal(read.coverage.total),
      rawCentsToDecimal(read.coverage.tips),
    );
    expect(compareDecimal(rawCentsToDecimal(read.coverage.tendered), expected)).toBe(0);

    // (e) The reports are non-blank for a seeded business day: a per-rate VAT summary and a cash-up
    // with real tenders. This is the whole point of the task.
    expect(read.close.vat.byRate.length).toBeGreaterThan(0);
    expect(compareDecimal(read.close.vat.taxTotal, decimal("0.00"))).toBeGreaterThan(0);
    expect(read.close.cash.byTill.length).toBeGreaterThan(0);
    expect(compareDecimal(read.close.cash.tenderTotal, decimal("0.00"))).toBeGreaterThan(0);
  });

  it("writes nothing when days is 0 (guard by deletion)", async () => {
    const venue = await provisionVenue();

    const { count } = await seedSales(suite.admin, {
      venue: venueFor(venue),
      locale: LOCALE,
      days: 0,
      products: PRODUCTS,
    });

    expect(count).toBe(0);

    const saleRows = await withTransaction(suite.admin, async (tx) => {
      await asAppUser(tx);
      return tx.select({ id: sales.id }).from(sales);
    });
    expect(saleRows.length).toBe(0);
  });
});
