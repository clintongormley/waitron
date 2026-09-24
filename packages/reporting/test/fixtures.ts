import { eq } from "drizzle-orm";
import {
  addDecimal,
  locationId as brandLocationId,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
  decimal,
  percentOf,
  stringToBasisPoints,
  stringToCents,
  stringToThousandths,
} from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TillId } from "@waitron/shared";
import {
  catalogues,
  diningTables,
  invoiceSeries,
  locations,
  products,
  purchaseInvoiceVat,
  purchaseInvoices,
  saleLines,
  saleSubstitutions,
  saleVoids,
  sales,
  tenders,
  tills,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import type { TenderMethod } from "../src/types.js";

/**
 * Fixtures take decimal literals and convert them at the insert, so a test states the amount it
 * seeds and the amount it expects in the same form, and the conversion under test is the READ's.
 */

export interface SeededVenue {
  locationId: string;
  tillId: TillId;
  nodeId: NodeId;
  seriesId: SeriesId;
}

export async function seedVenue(db: Database): Promise<SeededVenue> {
  await seedTenant(db);
  const [location] = await db
    .insert(locations)
    .values({ name: "Main", invoiceLocales: ["es-ES"], operationDescription: "Test op" })
    .returning({ id: locations.id });
  const locationId = location!.id;
  const [till] = await db
    .insert(tills)
    .values({ locationId, name: "Till 1" })
    .returning({ id: tills.id });
  const tillId = brandTillId(till!.id);
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const [series] = await db
    .insert(invoiceSeries)
    .values({ nodeId, code: "A" })
    .returning({ id: invoiceSeries.id });
  return { locationId, tillId, nodeId, seriesId: brandSeriesId(series!.id) };
}

/**
 * A SECOND node (with its own series) under an existing venue's location, so a test can tell a
 * node-grain aggregate from a venue-wide one.
 */
export async function seedNodeAndSeries(
  db: Database,
  venue: { locationId: string },
  seriesCode = "B",
): Promise<{ nodeId: NodeId; seriesId: SeriesId }> {
  const nodeId = await seedNode(db, brandLocationId(venue.locationId));
  const [series] = await db
    .insert(invoiceSeries)
    .values({ nodeId, code: seriesCode })
    .returning({ id: invoiceSeries.id });
  return { nodeId, seriesId: brandSeriesId(series!.id) };
}

// Till names are unique per location; seedVenue owns "Till 1".
let tillSeq = 1;

export async function seedTill(
  db: Database,
  locationId: string,
  name = `Till ${++tillSeq}`,
): Promise<TillId> {
  const [till] = await db.insert(tills).values({ locationId, name }).returning({ id: tills.id });
  return brandTillId(till!.id);
}

/**
 * The filed per-rate desglose a real sale would carry on `sales.vat_breakdown`, derived from the
 * fixture's own lines so the two agree: grouped by `vatRate`, `base` the summed `lineTotal`, `tax`
 * `percentOf(base, rate)` — the direct method.
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
  seed: { tillId: TillId; nodeId: NodeId; seriesId: SeriesId },
  opts: {
    invoiceNumber: number;
    issuedAt: string;
    total: string;
    lines: Array<{
      vatRate: string;
      lineTotal: string;
      /** Frozen staff-facing name; defaults to `"Item"`. Top-sellers groups and labels by it. */
      name?: string;
      /** Frozen customer-facing label (receipt/invoice text); defaults to `{ "es-ES": "Item" }`. */
      descriptions?: Record<string, string>;
      /** The frozen kitchen name; absent means none was frozen. */
      kitchenName?: string;
      /** The frozen VARIANT staff name; absent means the line named no variant. Top-sellers nests
       *  it under the line's `name`. */
      variantName?: string;
      /** The frozen VARIANT customer-facing label; absent means the line named no variant. */
      variantDescriptions?: Record<string, string>;
      /** The frozen VARIANT kitchen name; absent means the line named no variant. */
      variantKitchenName?: string;
      /** The line quantity as a decimal literal, converted at the insert; defaults to "1.000".
       *  May be negative on a rectificativa. */
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
      tillId: seed.tillId,
      nodeId: seed.nodeId,
      seriesId: seed.seriesId,
      invoiceNumber: opts.invoiceNumber,
      issuedAt: opts.issuedAt,
      issuedOffsetMinutes: opts.issuedOffsetMinutes ?? 0,
      total: stringToCents(opts.total),
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
      saleId,
      lineNo: i + 1,
      name: line.name ?? "Item",
      descriptions: line.descriptions ?? { "es-ES": "Item" },
      kitchenName: line.kitchenName ?? null,
      variantName: line.variantName ?? null,
      variantDescriptions: line.variantDescriptions ?? null,
      variantKitchenName: line.variantKitchenName ?? null,
      quantity: stringToThousandths(line.quantity ?? "1.000"),
      unitPrice: stringToCents(line.lineTotal),
      vatRate: stringToBasisPoints(line.vatRate),
      lineTotal: stringToCents(line.lineTotal),
    })),
  );
  return saleId;
}

export async function seedTender(
  db: Database,
  ref: { saleId: SaleId },
  opts: { method: TenderMethod; amount: string; tipAmount?: string; settledAt: string },
): Promise<void> {
  await db.insert(tenders).values({
    saleId: ref.saleId,
    method: opts.method,
    amount: stringToCents(opts.amount),
    tipAmount: stringToCents(opts.tipAmount ?? "0.00"),
    settledAt: opts.settledAt,
  });
}

export async function seedVoid(
  db: Database,
  ref: { saleId: SaleId },
  voidedAt: string,
): Promise<void> {
  await db.insert(saleVoids).values({
    saleId: ref.saleId,
    reason: "test void",
    voidedAt,
  });
}

/**
 * Seeds one received supplier invoice (factura recibida) and its per-rate VAT lines straight into
 * the tables, so these tests take no dependency on `@waitron/purchasing`. `supplierInvoiceNumber`
 * must be unique per supplierTaxId.
 */
export async function seedPurchaseInvoice(
  db: Database,
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
      supplierTaxId: opts.supplierTaxId ?? "B00000000",
      supplierName: "Proveedor",
      supplierInvoiceNumber: opts.supplierInvoiceNumber,
      issuedOn: opts.issuedOn,
      receivedOn: opts.receivedOn,
      total: stringToCents(opts.total),
      regime: opts.regime,
      deductibleProportion:
        opts.deductibleProportion === undefined
          ? undefined
          : stringToBasisPoints(opts.deductibleProportion),
    })
    .returning({ id: purchaseInvoices.id });
  const id = row!.id;
  await db.insert(purchaseInvoiceVat).values(
    opts.lines.map((l) => ({
      purchaseInvoiceId: id,
      rate: stringToBasisPoints(l.rate),
      base: stringToCents(l.base),
      tax: stringToCents(l.tax),
      kind: l.kind,
    })),
  );
  return id;
}

export async function seedSubstitution(
  db: Database,
  ref: { substitutionSaleId: SaleId; substitutedSaleId: SaleId },
): Promise<void> {
  await db.insert(saleSubstitutions).values({
    substitutionSaleId: ref.substitutionSaleId,
    substitutedSaleId: ref.substitutedSaleId,
  });
}

/**
 * Fires ONE line onto an EXISTING working order — a throwaway catalogue + product (this package
 * takes no dependency on `@waitron/catalogue`), a `working_order_lines` row, and its `ticket_items`
 * row with `queued_at` backdated by `opts.ageMinutes`. Split out from {@link seedFiredOrder} so a
 * test can add a SECOND line to one order.
 */
export async function seedFiredLine(
  db: Database,
  seed: { nodeId: NodeId; stationId: string },
  opts: {
    orderId: string;
    lineNo: number;
    /** Backdates `ticket_items.queued_at` by this many minutes — the age the classifier sees. Ignored
     *  when `queuedAt` is given. */
    ageMinutes: number;
    /** Marks the LINE served (drops it off the age clock). Defaults to unserved. */
    served?: boolean;
    /** An explicit ISO timestamp for `ticket_items.queued_at`, overriding `ageMinutes`, so two lines
     *  can share one exactly; two calls each backdating from their own clock reading need not tie. */
    queuedAt?: string;
  },
): Promise<void> {
  // One clock reading for this line's three stamps, so they agree.
  const firedAtMs = Date.now();
  const firedAt = new Date(firedAtMs).toISOString();
  const [catalogue] = await db
    .insert(catalogues)
    .values({ name: "Test catalogue" })
    .returning({ id: catalogues.id });
  const [product] = await db
    .insert(products)
    .values({
      catalogueId: catalogue!.id,
      name: "Item",
      pricingUnit: "each",
      unitPrice: stringToCents("1.00"),
      vatClass: "general",
    })
    .returning({ id: products.id });
  const [line] = await db
    .insert(workingOrderLines)
    .values({
      workingOrderId: opts.orderId,
      lineNo: opts.lineNo,
      productId: product!.id,
      name: "Item",
      descriptions: { "es-ES": "Item" },
      quantity: stringToThousandths("1.000"),
      unitPrice: stringToCents("1.00"),
      unitPriceGross: stringToCents("1.00"),
      vatRate: stringToBasisPoints("10.00"),
      lineTotal: stringToCents("1.00"),
      servedAt: opts.served ? firedAt : null,
    })
    .returning({ id: workingOrderLines.id });
  await db.insert(ticketItems).values({
    nodeId: seed.nodeId,
    workingOrderId: opts.orderId,
    workingOrderLineId: line!.id,
    stationId: seed.stationId,
    queuedAt: opts.queuedAt ?? new Date(firedAtMs - opts.ageMinutes * 60_000).toISOString(),
    firedAt,
  });
}

/** What {@link seedFiredOrder} needs to seed one KITCHEN order with a single fired line. */
export interface FiredOrderSeed {
  tillId: TillId;
  nodeId: NodeId;
  locationId: string;
  stationId: string;
}

/**
 * Creates a bare OPEN working order with no lines, so a test can fire lines in an order that differs
 * from their `line_no`.
 */
export async function seedOpenOrder(
  db: Database,
  seed: { tillId: TillId; nodeId: NodeId },
  orderNumber: number,
): Promise<{ orderId: string }> {
  const [order] = await db
    .insert(workingOrders)
    .values({
      tillId: seed.tillId,
      nodeId: seed.nodeId,
      orderNumber,
      status: "open",
    })
    .returning({ id: workingOrders.id });
  return { orderId: order!.id };
}

export async function seedFiredOrder(
  db: Database,
  seed: FiredOrderSeed,
  opts: {
    orderNumber: number;
    /** Backdates `ticket_items.queued_at` by this many minutes — the age the classifier sees. */
    ageMinutes: number;
    /** Marks the LINE served (drops it off the age clock). Defaults to unserved. */
    served?: boolean;
    /** Marks the ORDER collected (drops the whole order off the clock). Defaults to not collected. */
    collected?: boolean;
    status?: "open" | "placed" | "settled" | "abandoned";
    /** Seeds a dining table whose `tab_id` back-points at this order, for the `tableLabel` projection. */
    tableLabel?: string;
  },
): Promise<{ orderId: string }> {
  // Created `open` and fired before any terminal status: the
  // `working_order_lines_require_open_parent_*` triggers refuse a line on a non-open parent.
  const { orderId } = await seedOpenOrder(db, seed, opts.orderNumber);
  await seedFiredLine(
    db,
    { nodeId: seed.nodeId, stationId: seed.stationId },
    { orderId, lineNo: 1, ageMinutes: opts.ageMinutes, served: opts.served },
  );
  const status = opts.status ?? "open";
  if (status !== "open" || opts.collected) {
    const terminalAt = new Date().toISOString();
    await db
      .update(workingOrders)
      .set({
        status,
        // working_orders_settled_at_ck: settled_at is set exactly when status is 'settled'.
        settledAt: status === "settled" ? terminalAt : null,
        collectedAt: opts.collected ? terminalAt : null,
      })
      .where(eq(workingOrders.id, orderId));
  }
  if (opts.tableLabel !== undefined) {
    await db.insert(diningTables).values({
      locationId: seed.locationId,
      label: opts.tableLabel,
      tabId: orderId,
    });
  }
  return { orderId };
}

/** Re-exported so `overdue-orders.test.ts` needs no second import path into
 * `@waitron/db/testing/seed.js`. */
export { seedKitchenStation };
