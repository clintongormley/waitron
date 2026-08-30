import { sql } from "drizzle-orm";
import {
  addDecimal,
  locationId as brandLocationId,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
  decimal,
  percentOf,
} from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TenantId, TillId } from "@waitron/shared";
import {
  purchaseInvoiceVat,
  purchaseInvoices,
  saleLines,
  saleSubstitutions,
  saleVoids,
  sales,
  tenders,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import type { TenderMethod } from "../src/types.js";

export interface SeededVenue {
  tenantId: TenantId;
  locationId: string;
  tillId: TillId;
  nodeId: NodeId;
  seriesId: SeriesId;
}

// Tenant + node use @waitron/db's own exported seeders (they own the NIF counter and the
// tenants/nodes inserts); this file only adds the location/till/series that db has no seeder for.
export async function seedVenue(db: Database): Promise<SeededVenue> {
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Main', array['es-ES'], 'Test op') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(
    sql`insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Till 1') returning id`,
  );
  const tillId = brandTillId(till.rows[0]!.id);
  const nodeId = await seedNode(db, tenantId, brandLocationId(locationId));
  const series = await db.execute<{ id: string }>(
    sql`insert into invoice_series (tenant_id, node_id, code) values (${tenantId}, ${nodeId}, 'A') returning id`,
  );
  const seriesId = brandSeriesId(series.rows[0]!.id);
  return { tenantId, locationId, tillId, nodeId, seriesId };
}

/**
 * A SECOND node (with its own series) under an existing venue's tenant+location — for tests that need
 * two nodes in ONE tenant, which `seedVenue` (always a fresh tenant) cannot express. This is what
 * proves the `node_id` predicate, since RLS scopes by tenant only.
 */
export async function seedNodeAndSeries(
  db: Database,
  venue: { tenantId: TenantId; locationId: string },
  seriesCode = "B",
): Promise<{ nodeId: NodeId; seriesId: SeriesId }> {
  const nodeId = await seedNode(db, venue.tenantId, brandLocationId(venue.locationId));
  const series = await db.execute<{ id: string }>(
    sql`insert into invoice_series (tenant_id, node_id, code) values (${venue.tenantId}, ${nodeId}, ${seriesCode}) returning id`,
  );
  return { nodeId, seriesId: brandSeriesId(series.rows[0]!.id) };
}

export async function seedTill(
  db: Database,
  tenantId: TenantId,
  locationId: string,
): Promise<TillId> {
  const till = await db.execute<{ id: string }>(
    sql`insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Till 2') returning id`,
  );
  return brandTillId(till.rows[0]!.id);
}

/**
 * The filed per-rate desglose a real sale would carry on `sales.vat_breakdown`,
 * derived here from the fixture's own lines so the seeded breakdown is COHERENT with them: lines are
 * grouped by `vatRate`, each group's `base` is the summed `lineTotal`, and its `tax` is
 * `@waitron/shared`'s `percentOf` (`base * rate / 100` rounded to money scale) — the same
 * direct-method grouping `@waitron/core`'s `buildVatBreakdown` performs. The grouping is inlined
 * rather than imported (reporting does not depend on core); only the shared tax formula is reused.
 */
function breakdownFromLines(
  lines: Array<{ vatRate: string; lineTotal: string }>,
): { rate: string; base: string; tax: string }[] {
  const bases = new Map<string, string>();
  for (const line of lines) {
    const prev = bases.get(line.vatRate);
    bases.set(
      line.vatRate,
      prev === undefined ? line.lineTotal : addDecimal(decimal(prev), decimal(line.lineTotal)),
    );
  }
  return [...bases.entries()].map(([rate, base]) => ({
    rate,
    base,
    tax: percentOf(decimal(base), decimal(rate)),
  }));
}

export async function seedSale(
  db: Database,
  seed: { tenantId: TenantId; tillId: TillId; nodeId: NodeId; seriesId: SeriesId },
  opts: {
    invoiceNumber: number;
    issuedAt: string;
    total: string;
    lines: Array<{
      vatRate: string;
      lineTotal: string;
      /** Frozen analytics label; defaults to `{ "es-ES": "Item" }`. Top-sellers groups by it. */
      descriptions?: Record<string, string>;
      /** numeric(12,3) line quantity; defaults to "1.000". May be negative on a rectificativa. */
      quantity?: string;
    }>;
    correctsSaleId?: SaleId;
    /** Overrides the breakdown derived from `lines`, for a test that needs a specific desglose. */
    vatBreakdown?: { rate: string; base: string; tax: string }[];
    /**
     * The snapshotted UTC offset (minutes) filed with the sale; defaults to 0. A test that needs the
     * filed *fecha de expedición* to differ from the UTC calendar date (the modelo 303 civil-date
     * bucketing) sets this to the venue's real offset, e.g. Madrid's summer +120.
     */
    issuedOffsetMinutes?: number;
  },
): Promise<SaleId> {
  const [row] = await db
    .insert(sales)
    .values({
      tenantId: seed.tenantId,
      tillId: seed.tillId,
      nodeId: seed.nodeId,
      seriesId: seed.seriesId,
      invoiceNumber: opts.invoiceNumber,
      issuedAt: opts.issuedAt,
      issuedOffsetMinutes: opts.issuedOffsetMinutes ?? 0,
      total: opts.total,
      vatBreakdown: opts.vatBreakdown ?? breakdownFromLines(opts.lines),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      fiscalBackend: "fake",
      fiscalState: "recorded",
      correctsSaleId: opts.correctsSaleId,
    })
    .returning({ id: sales.id });
  const saleId = brandSaleId(row!.id);
  await db.insert(saleLines).values(
    opts.lines.map((line, i) => ({
      tenantId: seed.tenantId,
      saleId,
      lineNo: i + 1,
      descriptions: line.descriptions ?? { "es-ES": "Item" },
      quantity: line.quantity ?? "1.000",
      unitPrice: line.lineTotal,
      vatRate: line.vatRate,
      lineTotal: line.lineTotal,
    })),
  );
  return saleId;
}

export async function seedTender(
  db: Database,
  ref: { tenantId: TenantId; saleId: SaleId },
  opts: { method: TenderMethod; amount: string; tipAmount?: string; settledAt: string },
): Promise<void> {
  await db.insert(tenders).values({
    tenantId: ref.tenantId,
    saleId: ref.saleId,
    method: opts.method,
    amount: opts.amount,
    tipAmount: opts.tipAmount ?? "0.00",
    settledAt: opts.settledAt,
  });
}

export async function seedVoid(
  db: Database,
  ref: { tenantId: TenantId; saleId: SaleId },
  voidedAt: string,
): Promise<void> {
  await db.insert(saleVoids).values({
    tenantId: ref.tenantId,
    saleId: ref.saleId,
    reason: "test void",
    voidedAt,
  });
}

/**
 * Seeds one received supplier invoice (factura recibida) and its per-rate VAT lines directly, as the
 * connection owner (superuser bypasses RLS — pure setup). Inserts the raw tables rather than going
 * through `@waitron/purchasing`, so `@waitron/reporting`'s tests take no dependency on that package
 * (it reads the tables directly, exactly as it reads `sales`). `supplierInvoiceNumber` must be unique
 * per (tenant, supplierTaxId).
 */
export async function seedPurchaseInvoice(
  db: Database,
  seed: { tenantId: TenantId },
  opts: {
    supplierTaxId?: string;
    supplierInvoiceNumber: string;
    issuedOn: string;
    receivedOn: string;
    total: string;
    regime?: "general" | "equivalence_surcharge";
    deductibleProportion?: string;
    lines: Array<{ rate: string; base: string; tax: string; kind?: "ordinary" | "capital" }>;
  },
): Promise<string> {
  const [row] = await db
    .insert(purchaseInvoices)
    .values({
      tenantId: seed.tenantId,
      supplierTaxId: opts.supplierTaxId ?? "B00000000",
      supplierName: "Proveedor",
      supplierInvoiceNumber: opts.supplierInvoiceNumber,
      issuedOn: opts.issuedOn,
      receivedOn: opts.receivedOn,
      total: opts.total,
      regime: opts.regime,
      deductibleProportion: opts.deductibleProportion,
    })
    .returning({ id: purchaseInvoices.id });
  const id = row!.id;
  await db.insert(purchaseInvoiceVat).values(
    opts.lines.map((l) => ({
      tenantId: seed.tenantId,
      purchaseInvoiceId: id,
      rate: l.rate,
      base: l.base,
      tax: l.tax,
      kind: l.kind,
    })),
  );
  return id;
}

export async function seedSubstitution(
  db: Database,
  ref: { tenantId: TenantId; substitutionSaleId: SaleId; substitutedSaleId: SaleId },
): Promise<void> {
  await db.insert(saleSubstitutions).values({
    tenantId: ref.tenantId,
    substitutionSaleId: ref.substitutionSaleId,
    substitutedSaleId: ref.substitutedSaleId,
  });
}
