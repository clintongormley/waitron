/**
 * Back-dated preproduction sales through `recordSale`: the stored environment, the chain, and the
 * reports they light up — and the refusal of a production stamp.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { TrustedClock } from "@waitron/fiscal";
import { saleLines, sales, withTransaction, workingOrders } from "@waitron/db";
import { previewCorrectionAmounts } from "@waitron/core";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { VenueResult } from "@waitron/provisioning";
import { verifactuRecords } from "@waitron/fiscal-verifactu";
import { computeDailyClose } from "@waitron/reporting";
import {
  addDecimal,
  centsToDecimal,
  compareDecimal,
  decimal,
  nodeId as brandNodeId,
  rawCentsToDecimal,
  saleId as brandSaleId,
  thousandthsToDecimal,
} from "@waitron/shared";
import { listOrders, readOrderDetail } from "../../src/orders-list.js";
import { nodeBackend, seedSales } from "./seed-sales.js";
import type { SeedSalesDeliProduct, SeedSalesProduct, SeedSalesVenue } from "./seed-sales.js";

import type { SeedLocale } from "./locale.js";
import { createDemoVenueProvisioner } from "./testing/provision-venue.js";

const LOCALE: SeedLocale = "es";
const DAY_MS = 24 * 60 * 60 * 1000;

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// Prices are GROSS (VAT-inclusive).
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

// Prices whose VAT taken as base × rate rounds a cent away from gross − base: 5.00 eaten in at 10%
// has base 4.55 and VAT 0.46, 2.10 taken away at 21% has base 1.74 and VAT 0.37.
const CENT_SPLIT_PRODUCTS: SeedSalesProduct[] = [
  {
    id: "p-reduced-split",
    name: "Tostada",
    customerName: { [LOCALE]: "Tostada" },
    unitPrice: "5.00",
    vatClass: "reduced",
  },
];
const CENT_SPLIT_DELI_PRODUCTS: SeedSalesDeliProduct[] = [
  {
    id: "p-general-split",
    name: "Refresco",
    customerName: { [LOCALE]: "Refresco" },
    unitPrice: "2.10",
    vatClass: "general",
    takeawayVatRate: "21.00",
  },
];

// Two takeaway rates; only the cola keeps a takeaway class for its stored line.
const DELI_PRODUCTS: SeedSalesDeliProduct[] = [
  {
    id: "p-deli-cola",
    name: "Cola",
    customerName: { [LOCALE]: "Cola" },
    unitPrice: "2.50",
    vatClass: "reduced",
    takeawayVatClass: "general",
    takeawayVatRate: "21.00",
  },
  {
    id: "p-deli-ham",
    name: "Jamón",
    customerName: { [LOCALE]: "Jamón" },
    unitPrice: "12.00",
    vatClass: "reduced",
    takeawayVatRate: "10.00",
  },
];

// Reading a preview stamps nothing, so no clock is ever asked.
const PREVIEW_CLOCK: TrustedClock = {
  now: () => {
    throw new Error("the correction preview read the clock");
  },
  anchor: () => {
    throw new Error("the correction preview anchored the clock");
  },
  currentAnchor: () => null,
};

const provisionVenue = createDemoVenueProvisioner(() => suite.db, {
  nifBase: 80_000_000,
  invoiceLocale: "es-ES",
});

function venueFor(v: VenueResult): SeedSalesVenue {
  return {
    operationDescription: "Sale on premises",
    nodeId: v.nodeId,
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
      invoiceLocale: "es-ES",
      days: 3,
      products: PRODUCTS,
    });

    expect(count).toBeGreaterThan(0);

    const read = await withTransaction(suite.db, async (tx) => {
      const saleRows = await tx
        .select({ id: sales.id, issuedAt: sales.issuedAt, total: sales.total })
        .from(sales);
      const recordRows = await tx
        .select({ entorno: verifactuRecords.entorno })
        .from(verifactuRecords);
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
        cutoverChanges: [],
        nodeIds: [brandNodeId(venue.nodeId)],
        businessDay,
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
      });
      return { saleRows, recordRows, coverage: coverage[0]!, close };
    });

    expect(read.saleRows.length).toBe(count);
    expect(read.recordRows.length).toBe(count);

    for (const row of read.saleRows) {
      const t = new Date(row.issuedAt).getTime();
      expect(t).toBeLessThan(start);
      expect(t).toBeGreaterThan(start - 3.5 * DAY_MS);
    }

    expect(read.recordRows.length).toBeGreaterThan(0);
    for (const r of read.recordRows) {
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

  it("files each sale under a bill settled at its instant, so Bills closed equals the day's sales", async () => {
    const venue = await createDemoVenueProvisioner(() => suite.db, {
      nifBase: 83_000_000,
      nifFormat: "calculated",
      invoiceLocale: "es-ES",
    })();
    const start = Date.now();
    await seedSales(suite.db, {
      venue: venueFor(venue),
      invoiceLocale: "es-ES",
      days: 2,
      products: PRODUCTS,
    });

    const businessDay = new Date(start - DAY_MS).toISOString().slice(0, 10);
    const read = await withTransaction(suite.db, async (tx) => {
      const saleRows = await tx
        .select({
          issuedAt: sales.issuedAt,
          total: sales.total,
          status: workingOrders.status,
          settledAt: workingOrders.settledAt,
        })
        .from(sales)
        .leftJoin(workingOrders, eq(workingOrders.id, sales.workingOrderId));
      const close = await computeDailyClose(tx, {
        cutoverChanges: [],
        nodeIds: [brandNodeId(venue.nodeId)],
        businessDay,
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
      });
      return { saleRows, close };
    });

    expect(read.saleRows.length).toBeGreaterThan(0);
    for (const row of read.saleRows) {
      expect({ status: row.status, settledAt: row.settledAt }).toEqual({
        status: "settled",
        settledAt: row.issuedAt,
      });
    }

    const daySales = read.saleRows.filter((row) => row.issuedAt.slice(0, 10) === businessDay);
    expect(daySales.length).toBeGreaterThan(0);
    const billsClosed = read.close.departmentTakings.map((row) => row.billsClosed);
    expect(billsClosed.reduce((n, bills) => n + bills.count, 0)).toBe(daySales.length);
    const billed = billsClosed.reduce(
      (sum, bills) => addDecimal(sum, bills.total),
      decimal("0.00"),
    );
    const sold = daySales.reduce(
      (sum, row) => addDecimal(sum, centsToDecimal(row.total)),
      decimal("0.00"),
    );
    expect(compareDecimal(billed, sold)).toBe(0);
  });

  it("shows each demo order's dishes on the Orders screen as its invoice lists them", async () => {
    const venue = await createDemoVenueProvisioner(() => suite.db, {
      nifBase: 84_000_000,
      nifFormat: "calculated",
      invoiceLocale: "es-ES",
    })();
    const { count } = await seedSales(suite.db, {
      venue: venueFor(venue),
      invoiceLocale: "es-ES",
      days: 3,
      products: PRODUCTS,
      deliProducts: DELI_PRODUCTS,
    });

    const read = await withTransaction(suite.db, async (tx) => {
      const { rows } = await listOrders(tx, {
        status: "all",
        dates: "any",
        credited: false,
        limit: count + 1,
        scope: "all",
      });
      const orders = [];
      for (const row of rows) {
        const detail = await readOrderDetail(tx, row.id, "all", false);
        const filed = await tx
          .select({
            name: saleLines.name,
            quantity: saleLines.quantity,
            gross: saleLines.lineGross,
          })
          .from(saleLines)
          .where(eq(saleLines.saleId, row.saleId!))
          .orderBy(saleLines.lineNo);
        orders.push({ row, detail, filed });
      }
      return orders;
    });

    expect(read.length).toBe(count);
    for (const { row, detail, filed } of read) {
      expect({ kind: row.kind, status: row.status }).toEqual({ kind: "bill", status: "paid" });
      expect(filed.length).toBeGreaterThan(0);
      expect(
        detail.lines.map((line) => ({
          name: line.name,
          quantity: String(line.quantity),
          total: String(line.total),
        })),
      ).toEqual(
        filed.map((line) => ({
          name: line.name,
          quantity: String(thousandthsToDecimal(line.quantity)),
          total: String(centsToDecimal(line.gross!)),
        })),
      );
    }

    // The classes a till stores: a dish with no takeaway class keeps its served one for takeaway.
    const stored = suite.db.all<{
      dining: string;
      name: string;
      vat_class: string;
      takeaway_vat_class: string;
      unit_price_gross: number;
    }>(sql`select o.dining, l.name, l.vat_class, l.takeaway_vat_class, l.unit_price_gross
           from working_order_lines l join working_orders o on o.id = l.working_order_id`);
    expect(new Set(stored.map((line) => line.dining))).toEqual(new Set(["eat_in", "takeaway"]));
    const byName = new Map([...PRODUCTS, ...DELI_PRODUCTS].map((p) => [p.name, p]));
    for (const line of stored) {
      const product = byName.get(line.name)!;
      expect([line.vat_class, line.takeaway_vat_class]).toEqual([
        product.vatClass,
        product.takeawayVatClass ?? product.vatClass,
      ]);
      expect(
        compareDecimal(centsToDecimal(line.unit_price_gross), decimal(product.unitPrice)),
      ).toBe(0);
    }
  });

  it("rates a deli sale's lines at their own takeaway rate", async () => {
    const venue = await createDemoVenueProvisioner(() => suite.db, {
      nifBase: 82_000_000,
      nifFormat: "calculated",
      invoiceLocale: "es-ES",
    })();
    const cola: SeedSalesDeliProduct = {
      id: "p-cola",
      name: "Cola",
      customerName: { [LOCALE]: "Cola" },
      unitPrice: "2.50",
      vatClass: "reduced",
      takeawayVatRate: "21.00",
    };
    const ham: SeedSalesDeliProduct = {
      id: "p-ham",
      name: "Jamón",
      customerName: { [LOCALE]: "Jamón" },
      unitPrice: "12.00",
      vatClass: "reduced",
      takeawayVatRate: "10.00",
    };
    await seedSales(suite.db, {
      venue: venueFor(venue),
      invoiceLocale: "es-ES",
      days: 3,
      products: [cola],
      deliProducts: [cola, ham],
    });
    const lines = await withTransaction(suite.db, (tx) =>
      tx
        .select({ saleId: saleLines.saleId, name: saleLines.name, vatRate: saleLines.vatRate })
        .from(saleLines),
    );
    const deliSales = new Set(lines.filter((line) => line.name === "Jamón").map((l) => l.saleId));
    expect(deliSales.size).toBeGreaterThan(0);
    const rateOf = (line: (typeof lines)[number]) => Number(line.vatRate);
    expect(lines.filter((line) => line.name === "Jamón").map(rateOf)).toEqual(
      lines.filter((line) => line.name === "Jamón").map(() => 1000),
    );
    const colaInDeli = lines.filter((line) => line.name === "Cola" && deliSales.has(line.saleId));
    expect(colaInDeli.length).toBeGreaterThan(0);
    expect(new Set(colaInDeli.map(rateOf))).toEqual(new Set([2100]));
    expect(new Set(lines.filter((line) => line.name === "Cola").map(rateOf))).toEqual(
      new Set([1000, 2100]),
    );
  });

  it("records every demo sale, its fiscal record and its bill as the demo seed's, with no device", async () => {
    // Its own provisioner: the shared one's fixed `K` letter is a valid NIF for its first venue only.
    const venue = await createDemoVenueProvisioner(() => suite.db, {
      nifBase: 81_000_000,
      nifFormat: "calculated",
      invoiceLocale: "es-ES",
    })();
    // Two days, not one: before the day's first service slot every one of today's sales would be in
    // the future, so only yesterday guarantees any.
    const { count } = await seedSales(suite.db, {
      venue: venueFor(venue),
      invoiceLocale: "es-ES",
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
    expect(pairs("verifactu_records")).toEqual(expected);
    expect(pairs("working_orders")).toEqual(expected);
  });

  it("files demo sales whose every line can be corrected: the preview takes back each whole sale", async () => {
    const venue = await createDemoVenueProvisioner(() => suite.db, {
      nifBase: 82_000_000,
      nifFormat: "calculated",
      invoiceLocale: "es-ES",
    })();
    const { count } = await seedSales(suite.db, {
      venue: venueFor(venue),
      invoiceLocale: "es-ES",
      days: 2,
      products: CENT_SPLIT_PRODUCTS,
      deliProducts: CENT_SPLIT_DELI_PRODUCTS,
    });
    expect(count).toBeGreaterThan(0);
    const rates = await suite.db.selectDistinct({ vatRate: saleLines.vatRate }).from(saleLines);
    expect(new Set(rates.map(({ vatRate }) => vatRate))).toEqual(new Set([1000, 2100]));

    const previews = await withTransaction(suite.db, async (tx) => {
      const backend = await nodeBackend(suite.db, tx, venue.nodeId, PREVIEW_CLOCK, "preproduction");
      const results = [];
      for (const sale of await tx.select({ id: sales.id, total: sales.total }).from(sales)) {
        const lines = await tx
          .select({ id: saleLines.id })
          .from(saleLines)
          .where(eq(saleLines.saleId, sale.id));
        const total = rawCentsToDecimal(String(sale.total));
        const preview = await previewCorrectionAmounts(
          tx,
          backend,
          brandSaleId(sale.id),
          brandNodeId(venue.nodeId),
          { gross: total, lineIds: lines.map((line) => line.id) },
        );
        results.push({ total, gross: preview.gross });
      }
      return results;
    });
    expect(previews.length).toBe(count);
    for (const { total, gross } of previews) expect(compareDecimal(gross, total)).toBe(0);
  });

  it("refuses to file demo sales into a production environment, and writes nothing", async () => {
    const venue = await provisionVenue();
    vi.stubEnv("WAITRON_ENV", "production");

    await expect(
      seedSales(suite.db, {
        venue: venueFor(venue),
        invoiceLocale: "es-ES",
        days: 3,
        products: PRODUCTS,
      }),
    ).rejects.toMatchObject({ code: "deployment.demo_data_refused" });

    const read = await withTransaction(suite.db, async (tx) => ({
      sales: await tx.select({ id: sales.id }).from(sales),
      recordRows: await tx.select({ entorno: verifactuRecords.entorno }).from(verifactuRecords),
    }));
    expect(read.sales.length).toBe(0);
    expect(read.recordRows.length).toBe(0);
  });

  it("writes nothing when days is 0 (guard by deletion)", async () => {
    const venue = await provisionVenue();

    const { count } = await seedSales(suite.db, {
      venue: venueFor(venue),
      invoiceLocale: "es-ES",
      days: 0,
      products: PRODUCTS,
    });

    expect(count).toBe(0);

    const saleRows = await withTransaction(suite.db, async (tx) => {
      return tx.select({ id: sales.id }).from(sales);
    });
    expect(saleRows.length).toBe(0);
  });

  it("records a United Kingdom venue's practice sales through its own module, with no fiscal record", async () => {
    const venue = await createDemoVenueProvisioner(() => suite.db, {
      country: "GB",
      nifBase: 100_000_000,
      invoiceLocale: "en-GB",
    })();

    const { count } = await seedSales(suite.db, {
      venue: venueFor(venue),
      invoiceLocale: "en-GB",
      days: 3,
      products: PRODUCTS,
    });

    const { rows: backends } = await suite.db.execute<{ fiscal_backend: string }>(
      sql`select fiscal_backend from sales`,
    );
    const { rows: fiscalRows } = await suite.db.execute<{
      recordCount: number;
      verifactu_submissions: number;
    }>(
      sql`select (select count(*) from verifactu_records) as recordCount,
                 (select count(*) from verifactu_submissions) as verifactu_submissions`,
    );
    expect(count).toBeGreaterThan(0);
    expect(backends.length).toBe(count);
    expect(new Set(backends.map((row) => row.fiscal_backend))).toEqual(new Set(["none"]));
    expect(fiscalRows[0]).toEqual({ recordCount: 0, verifactu_submissions: 0 });
  });
});
