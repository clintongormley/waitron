import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  addDecimal,
  locationId as brandLocationId,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  decimal,
  percentOf,
  stringToBasisPoints,
  stringToCents,
  stringToThousandths,
} from "@waitron/shared";
import type { DeviceId, NodeId, SaleId, SaleLineClassification, SeriesId } from "@waitron/shared";
import {
  billPaymentRefunds,
  billPayments,
  catalogues,
  diningTables,
  invoiceSeries,
  locations,
  kitchenTimingDefaults,
  parties,
  partyTables,
  products,
  purchaseInvoiceVat,
  purchaseInvoices,
  saleLines,
  saleSubstitutions,
  saleVoids,
  sales,
  tenders,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { seedKitchenStation, seedNode, seedTenant, seedDevice } from "@waitron/db/testing/seed.js";
import type { TenderMethod } from "../src/types.js";

/**
 * Fixtures take decimal literals and convert them at the insert, so a test states the amount it
 * seeds and the amount it expects in the same form, and the conversion under test is the READ's.
 */

export interface SeededVenue {
  locationId: string;
  /** A till device at that location: the origin of every money row the fixtures write. */
  deviceId: DeviceId;
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
  await db.insert(kitchenTimingDefaults).values({ locationId });
  const { deviceId } = await seedDevice(db, { locationId });
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const [series] = await db
    .insert(invoiceSeries)
    .values({ nodeId, code: "A" })
    .returning({ id: invoiceSeries.id });
  return { locationId, deviceId, nodeId, seriesId: brandSeriesId(series!.id) };
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

/** Another device at `locationId`, for a test that needs money taken on two. */
export async function seedVenueDevice(db: Database, locationId: string): Promise<DeviceId> {
  return (await seedDevice(db, { locationId: brandLocationId(locationId) })).deviceId;
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
  seed: { deviceId: DeviceId; nodeId: NodeId; seriesId: SeriesId },
  opts: {
    invoiceNumber: number;
    /** A sample sale the Demo seed recorded, with no device; otherwise `seed.deviceId` rang it. */
    source?: "demo_seed";
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
      /** A fixed line id, so another line of the same sale can name it as `parentLineId`. */
      id?: string;
      /** The dish line an extras pick belongs to. */
      parentLineId?: string;
      /** The free-text category; absent means none. */
      category?: string;
      /** The product sold; absent means none was recorded, as on a line filed before it was. */
      productId?: string;
      /** The VAT-inclusive total as a decimal literal; absent means none was recorded. */
      lineGross?: string;
      /** The recorded classification snapshot; absent means none was recorded. */
      classification?: SaleLineClassification;
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
      source: opts.source ?? "device",
      deviceId: opts.source === undefined ? seed.deviceId : null,
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
      id: line.id,
      parentLineId: line.parentLineId ?? null,
      category: line.category ?? null,
      productId: line.productId ?? null,
      lineGross: line.lineGross === undefined ? null : stringToCents(line.lineGross),
      classification: line.classification ?? null,
    })),
  );
  return saleId;
}

export async function seedTender(
  db: Database,
  ref: { saleId: SaleId },
  opts: {
    method: TenderMethod;
    amount: string;
    tipAmount?: string;
    settledAt: string;
    /** The bill payment this tender was issued from, as the invoice at full payment writes it. */
    billPaymentId?: string;
  },
): Promise<void> {
  await db.insert(tenders).values({
    saleId: ref.saleId,
    method: opts.method,
    amount: stringToCents(opts.amount),
    tipAmount: stringToCents(opts.tipAmount ?? "0.00"),
    settledAt: opts.settledAt,
    billPaymentId: opts.billPaymentId ?? null,
  });
}

// A plain person id: `requested_by` and its siblings carry no key.
const PERSON = "dddddddd-0000-4000-8000-000000000001";

/**
 * One payment taken against a bill before its invoice. `at` is when it moved out of `pending`:
 * `received_at` for `received` and `declined`, `failed_at` for `failed`; a `pending` one has
 * neither.
 */
export async function seedBillPayment(
  db: Database,
  ref: { workingOrderId: string; deviceId: DeviceId },
  opts: {
    method: "cash" | "card";
    applied: string;
    tip?: string;
    /** Cash handed over; defaults to exactly `applied + tip`. Ignored for a card. */
    tendered?: string;
    state: "pending" | "received" | "failed" | "declined";
    at?: string;
  },
): Promise<string> {
  const tip = opts.tip ?? "0.00";
  const owed = addDecimal(decimal(opts.applied), decimal(tip));
  const moved = opts.state === "received" || opts.state === "declined";
  const [row] = await db
    .insert(billPayments)
    .values({
      workingOrderId: ref.workingOrderId,
      submissionId: randomUUID(),
      fingerprint: "fixture",
      kind: "contribution",
      method: opts.method,
      applied: stringToCents(opts.applied),
      tip: stringToCents(tip),
      tendered: opts.method === "cash" ? stringToCents(opts.tendered ?? owed) : null,
      state: opts.state,
      requestedBy: PERSON,
      source: "device",
      deviceId: ref.deviceId,
      receivedAt: moved ? opts.at! : null,
      failedAt: opts.state === "failed" ? opts.at! : null,
    })
    .returning({ id: billPayments.id });
  return row!.id;
}

/** Money given back from one bill payment, on `deviceId`. `at` is `completed_at` or `failed_at`. */
export async function seedBillRefund(
  db: Database,
  ref: { billPaymentId: string; deviceId: DeviceId },
  opts: {
    applied: string;
    tip?: string;
    state: "pending" | "completed" | "failed";
    at?: string;
  },
): Promise<void> {
  await db.insert(billPaymentRefunds).values({
    billPaymentId: ref.billPaymentId,
    submissionId: randomUUID(),
    fingerprint: "fixture",
    appliedAmount: stringToCents(opts.applied),
    tipAmount: stringToCents(opts.tip ?? "0.00"),
    reason: "fixture",
    authorizedBy: PERSON,
    requestedBy: PERSON,
    source: "device",
    deviceId: ref.deviceId,
    state: opts.state,
    completedAt: opts.state === "completed" ? opts.at! : null,
    failedAt: opts.state === "failed" ? opts.at! : null,
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
      unitPriceGross: stringToCents("1.00"),
      vatClass: "reduced",
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
  deviceId: DeviceId;
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
  seed: { deviceId: DeviceId; locationId: string; nodeId: NodeId },
  orderNumber: number,
): Promise<{ orderId: string }> {
  const [order] = await db
    .insert(workingOrders)
    .values({
      source: "device",
      deviceId: seed.deviceId,
      locationId: seed.locationId,
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
    /** Seeds a dining table the order is delivered to, for the `tableLabel` projection. */
    tableLabel?: string;
  },
): Promise<{ orderId: string }> {
  // Created `open` and fired before any terminal status: the
  // `working_order_lines_require_open_parent_*` triggers refuse a line on a non-open parent.
  const { orderId } = await seedOpenOrder(db, seed, opts.orderNumber);
  if (opts.tableLabel !== undefined) {
    const [table] = await db
      .insert(diningTables)
      .values({ locationId: seed.locationId, label: opts.tableLabel })
      .returning({ id: diningTables.id });
    await db
      .update(workingOrders)
      .set({ deliveryTableId: table!.id })
      .where(eq(workingOrders.id, orderId));
  }
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
  return { orderId };
}

/**
 * Puts the order on a new party seated at a new table per entry, each joined at its own `joinedAt`,
 * and left at `leftAt` where one is given; a table gets a random id unless the entry names one.
 * Returns the party's id.
 */
export async function seedPartyAt(
  db: Database,
  seed: { locationId: string; orderId: string },
  tables: { id?: string; label: string; joinedAt: string; leftAt?: string }[],
): Promise<string> {
  const [party] = await db
    .insert(parties)
    .values({ openedBy: randomUUID() })
    .returning({ id: parties.id });
  for (const table of tables) {
    const [row] = await db
      .insert(diningTables)
      .values({ id: table.id, locationId: seed.locationId, label: table.label })
      .returning({ id: diningTables.id });
    await db.insert(partyTables).values({
      partyId: party!.id,
      tableId: row!.id,
      joinedAt: table.joinedAt,
      leftAt: table.leftAt ?? null,
    });
  }
  await db
    .update(workingOrders)
    .set({ partyId: party!.id })
    .where(eq(workingOrders.id, seed.orderId));
  return party!.id;
}

/** Re-exported so `overdue-orders.test.ts` needs no second import path into
 * `@waitron/db/testing/seed.js`. */
export { seedKitchenStation };
