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
 * Money crosses into the database as a count of whole cents (`columns.ts`'s `money`), so every
 * fixture below takes the decimal literal a test reads and writes `decimalToCents` of it. Keeping
 * the literals here means a reporting test still states the amount it seeds and the amount it
 * expects in the same form, and the conversion under test is the one the READ does.
 */

export interface SeededVenue {
  locationId: string;
  tillId: TillId;
  nodeId: NodeId;
  seriesId: SeriesId;
}

// The taxpayer row and the node use @waitron/db's own exported seeders (they own the NIF counter
// and the tenants/nodes inserts); this file only adds the location/till/series db has no seeder for.
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
 * A SECOND node (with its own series) under an existing venue's location — for tests that need
 * two nodes in one venue, which `seedVenue` cannot express. Two nodes in one
 * database let a test tell a node-grain aggregate from a venue-wide one.
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

// A venue-scoped unique index on tills(location_id, name) means two seeded tills in one
// venue cannot share a name; the counter gives each a distinct one (seedVenue owns "Till 1").
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
 * Seeds one received supplier invoice (factura recibida) and its per-rate VAT lines directly, as the
 * connection owner for fixture setup. Inserts the raw tables rather than going
 * through `@waitron/purchasing`, so `@waitron/reporting`'s tests take no dependency on that package
 * (it reads the tables directly, exactly as it reads `sales`). `supplierInvoiceNumber` must be unique
 * per supplierTaxId.
 */
export async function seedPurchaseInvoice(
  db: Database,
  // Inert: callers still pass the seeded venue; the parameter goes when they stop.
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
 * Fires ONE line onto an EXISTING working order — a fresh throwaway catalogue + product (this
 * package takes no dependency on `@waitron/catalogue`, and `computeOverdueOrders` never reads
 * either), a `working_order_lines` row, and its `ticket_items` row with `queued_at` backdated by
 * `opts.ageMinutes` — the same `now() - N minutes` idiom `apps/server/src/working-order.test.ts`/
 * `tables.test.ts` use to control a band's age precisely. Split out from {@link seedFiredOrder} so a
 * test can add a SECOND line to one order (proving the worst-line reduction), which minting a whole
 * new order each time cannot express. Every insert runs as the connection owner for fixture setup.
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
    /** Marks the LINE served (drops it off the age clock — design §3). Defaults to unserved. */
    served?: boolean;
    /** An explicit ISO timestamp for `ticket_items.queued_at`, overriding `ageMinutes`. Lets a test
     *  give TWO lines the BIT-IDENTICAL `queued_at` a real multi-line fire produces (one INSERT, one
     *  shared `defaultNow()` — `apps/server/src/working-order.ts`'s `fireLines`) — two SEPARATE calls
     *  each computing its own `now() - N minutes` do NOT tie exactly, since each runs in its own
     *  implicit transaction a few milliseconds apart, which is precisely wrong for a tie-break test. */
    queuedAt?: string;
  },
): Promise<void> {
  // One clock reading for this line's three stamps. It was `now()` — this engine has no such
  // function, and `now()` was transaction time, so the three agreed; taking one reading here keeps
  // them agreeing. The backdated `queued_at` is the same subtraction `now() - N * interval '1
  // minute'` performed, moved onto a Date because there is no interval type either.
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

/**
 * Seeds one KITCHEN order with a single fired line (via {@link seedFiredLine}) — the fixture
 * `overdue-orders.test.ts` uses for the common one-order-one-line case.
 */
export interface FiredOrderSeed {
  tillId: TillId;
  nodeId: NodeId;
  locationId: string;
  stationId: string;
}

/**
 * Creates a bare OPEN working order with no lines — split out of {@link seedFiredOrder} so a test can
 * control the ORDER lines are fired in (via separate {@link seedFiredLine} calls) independently of
 * their `line_no`, which is exactly what a tie-break regression test needs (insertion order must be
 * able to DIFFER from `line_no` order, to prove the query's tiebreak — not insertion order — decides
 * which tied line wins).
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
    /** Marks the LINE served (drops it off the age clock — design §3). Defaults to unserved. */
    served?: boolean;
    /** Marks the ORDER collected (drops the whole order off the clock). Defaults to not collected. */
    collected?: boolean;
    status?: "open" | "placed" | "settled" | "abandoned";
    /** Seeds a dining table whose `tab_id` back-points at this order, for the `tableLabel` projection. */
    tableLabel?: string;
  },
): Promise<{ orderId: string }> {
  // Always CREATE the order `open` and fire the line before applying a terminal status/collected_at:
  // `working_order_lines_require_open_parent` rejects writing a line onto
  // a non-open parent, exactly as the real fire path would (a line is fired onto an open order, and
  // only THEN does it settle/place/abandon or get collected).
  const { orderId } = await seedOpenOrder(db, seed, opts.orderNumber);
  await seedFiredLine(
    db,
    { nodeId: seed.nodeId, stationId: seed.stationId },
    { orderId, lineNo: 1, ageMinutes: opts.ageMinutes, served: opts.served },
  );
  const status = opts.status ?? "open";
  if (status !== "open" || opts.collected) {
    // One reading for both stamps — what `now()` gave by being transaction time.
    const terminalAt = new Date().toISOString();
    await db
      .update(workingOrders)
      .set({
        status,
        // The settled_at CHECK (working_orders_settled_at_ck) is biconditional on status='settled'.
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

/** Re-exported so `overdue-orders.test.ts` seeds a station without a second import path into
 * `@waitron/db/testing/seed.js` — the same convenience `seedVenue` gives for tenant/node/location. */
export { seedKitchenStation };
