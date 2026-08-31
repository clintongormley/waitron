// Real-Postgres proof of `seedSales` (Phase 2, Task 10): it fills the last N days with back-dated,
// PREPRODUCTION, hash-chained sales through the real `recordSale` path so the reports screens
// (VAT summary, cash-up) are non-blank in the demo. Real Postgres, not PGlite: the fiscal write is
// the whole point, and PGlite's superuser connection bypasses the RLS/immutability guards that make
// a `registros_facturacion` row real (CLAUDE.md §4). Uses the shared `manifest` template, cloned per
// file via `useTemplateDb`, the same pattern as `till-sale.test.ts` / `seed-catalogue.test.ts`.
//
// Runs under preproduction: `WAITRON_ENV` is left unset, which `deploymentEnvironment` resolves to
// `preproduction` — the safe default, and the environment every `entorno` row below is asserted to
// carry. This suite MUST NOT run under `production` (a wrong `entorno` stamp is unrecoverable, §5).

import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, sales, saleLines, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import { hashPassword, hashPin } from "@waitron/identity";
import { registrosFacturacion } from "@waitron/fiscal-verifactu";
import { computeDailyClose } from "@waitron/reporting";
import {
  addDecimal,
  compareDecimal,
  decimal,
  nodeId as brandNodeId,
  tenantId as brandTenantId,
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
    descriptions: { [LOCALE]: "Solomillo" },
    unitPrice: "18.50",
    vatClass: "general",
  },
  {
    id: "p-reduced",
    descriptions: { [LOCALE]: "Pan de la casa" },
    unitPrice: "2.40",
    vatClass: "reduced",
  },
  {
    id: "p-super",
    descriptions: { [LOCALE]: "Leche" },
    unitPrice: "1.30",
    vatClass: "super_reduced",
  },
  { id: "p-zero", descriptions: { [LOCALE]: "Agua" }, unitPrice: "1.00", vatClass: "zero" },
];

async function provisionVenue(): Promise<VenueResult> {
  return applyVenue(
    planVenue({
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
      },
    }),
    { db: suite.admin },
  );
}

function venueFor(v: VenueResult): SeedSalesVenue {
  return {
    tenantId: v.tenantId,
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

    const read = await withTenant(suite.admin, brandTenantId(venue.tenantId), async (tx) => {
      await asAppUser(tx);
      const saleRows = await tx
        .select({ id: sales.id, issuedAt: sales.issuedAt, total: sales.total })
        .from(sales);
      const registros = await tx
        .select({ entorno: registrosFacturacion.entorno })
        .from(registrosFacturacion);
      const sampled = saleRows[0]!;
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
        join tenders t on t.sale_id = s.id and t.tenant_id = s.tenant_id
        where s.id = ${sampled.id}
        group by s.total`);
      // Business day = yesterday (UTC), which the generator always fills fully and in the past.
      const businessDay = new Date(start - DAY_MS).toISOString().slice(0, 10);
      const close = await computeDailyClose(tx, {
        tenantId: brandTenantId(venue.tenantId),
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
    const expected = addDecimal(decimal(read.coverage.total), decimal(read.coverage.tips));
    expect(compareDecimal(decimal(read.coverage.tendered), expected)).toBe(0);

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

    const saleRows = await withTenant(suite.admin, brandTenantId(venue.tenantId), async (tx) => {
      await asAppUser(tx);
      return tx.select({ id: sales.id }).from(sales);
    });
    expect(saleRows.length).toBe(0);
  });

  // One REQUIRED group (always fires — a real order can never leave it unsatisfied) plus one OPTIONAL
  // group (fires roughly half the time, per `selectOptions`'s coin-flip) — proves both the "always
  // resolve required" and the "occasionally select optional" halves of the modifier generator, and the
  // VAT-override path (`vatClass: "reduced"` on one option vs `null`-inherit on the rest).
  const COFFEE_WITH_OPTIONS: SeedSalesProduct = {
    id: "p-coffee",
    descriptions: { [LOCALE]: "Café" },
    unitPrice: "1.60",
    vatClass: "general",
    optionGroups: [
      {
        id: "g-size",
        name: { [LOCALE]: "Size" },
        minSelect: 1,
        maxSelect: 1,
        required: true,
        items: [
          { id: "i-small", name: { [LOCALE]: "Small" }, priceDelta: "0.00", vatClass: null },
          { id: "i-large", name: { [LOCALE]: "Large" }, priceDelta: "0.50", vatClass: null },
        ],
      },
      {
        id: "g-extras",
        name: { [LOCALE]: "Extras" },
        minSelect: 0,
        maxSelect: 2,
        required: false,
        items: [
          {
            id: "i-shot",
            name: { [LOCALE]: "Extra shot" },
            priceDelta: "0.60",
            vatClass: "reduced",
          },
          { id: "i-syrup", name: { [LOCALE]: "Syrup" }, priceDelta: "0.40", vatClass: null },
        ],
      },
    ],
  };

  const OPTION_NAMES = new Set(["Small", "Large", "Extra shot", "Syrup"]);

  it("emits modifier sub-lines linked by parent_line_id when a product carries option groups", async () => {
    const venue = await provisionVenue();

    const { count } = await seedSales(suite.admin, {
      venue: venueFor(venue),
      locale: LOCALE,
      days: 2,
      products: [COFFEE_WITH_OPTIONS],
    });
    expect(count).toBeGreaterThan(0);

    const rows = await withTenant(suite.admin, brandTenantId(venue.tenantId), async (tx) => {
      await asAppUser(tx);
      return tx
        .select({
          id: saleLines.id,
          saleId: saleLines.saleId,
          parentLineId: saleLines.parentLineId,
          descriptions: saleLines.descriptions,
          vatRate: saleLines.vatRate,
        })
        .from(saleLines);
    });

    const parents = rows.filter((r) => r.parentLineId === null);
    const children = rows.filter((r) => r.parentLineId !== null);

    // Every sale rings the SAME product, whose Size group is REQUIRED, so every dish line has at
    // least one child (Size) — and at least one child overall.
    expect(children.length).toBeGreaterThan(0);
    expect(children.length).toBeGreaterThanOrEqual(parents.length);

    // Every child's description is one of the authored option item names, and its filed VAT rate
    // matches that item's override (Extra shot → reduced 10%) or the dish's own rate (general 21%)
    // when the item inherits (`vatClass: null`). Filed sale-line descriptions are re-keyed to the
    // FULL invoice tag (`toInvoiceLineDescriptions`), not the bare content locale — `es` here files
    // under `es-ES`.
    const invoiceLocale = SEED_INVOICE_LOCALE[LOCALE];
    for (const child of children) {
      const desc = child.descriptions[invoiceLocale];
      expect(OPTION_NAMES.has(desc as string)).toBe(true);
      expect(child.vatRate).toBe(desc === "Extra shot" ? "10.00" : "21.00");
    }

    // Every child's parent id resolves to a real top-level line in the SAME sale (proper linkage, not
    // a dangling reference into another sale).
    const idsBySale = new Map<string, Set<string>>();
    for (const row of rows) {
      const ids = idsBySale.get(row.saleId) ?? new Set<string>();
      ids.add(row.id);
      idsBySale.set(row.saleId, ids);
    }
    for (const child of children) {
      expect(idsBySale.get(child.saleId)!.has(child.parentLineId!)).toBe(true);
    }
  });
});
