import { buildLineExtras, matchExtraChildren, sameOptionSelections } from "./modifier-selection.js";
import type { ExtraChild, ExtraProductFacts } from "./modifier-selection.js";
import type { ExtraSelection, OptionSelection, OptionSnapshot } from "@waitron/shared";
import { readReceiptIssuer } from "./receipt-issuer.js";
// Side-effect only: keeps this host's error registry (errors.ts) reachable from a file that throws
// its codes.
import "./errors.js";
import { randomUUID } from "node:crypto";
import { and, eq, exists, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { GetColumnData } from "drizzle-orm";
import {
  AppError,
  basisPointsToDecimal,
  centsToDecimal,
  classifyBand,
  compareDecimal,
  type Decimal,
  decimal,
  decimalToBasisPoints,
  decimalToCents,
  decimalToThousandths,
  locationId as brandLocationId,
  MONEY_SCALE,
  multiplyDecimal,
  perDishOptionQuantity,
  rawCentsToDecimal,
  type SaleId,
  type StationThresholds,
  stringToBasisPoints,
  stringToCents,
  stringToThousandths,
  subtractDecimal,
  thousandthsToDecimal,
  type TillId,
  type TimingBand,
  toScale,
  workingOrderId as brandWorkingOrderId,
  worstBand,
} from "@waitron/shared";
import {
  allocateOrderNumber,
  appendOrderAmendment,
  categories,
  diningTables,
  invoiceSeries,
  isUniqueViolation,
  kitchenCourses,
  kitchenStations,
  nowIso,
  products,
  sales,
  ticketItems,
  ticketState,
  withTransaction,
  workingOrderLines,
  workingOrders,
  workingOrderStatus,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import {
  expandDietaryDeclarations,
  priceBasket,
  priceBasketWithOptions,
  priceLockedLines,
  resolveAttachedModifiers,
  resolveVatRate,
  toInvoiceLineDescriptions,
  readContentLanguages,
  readInvoiceLocales,
  parentsWithActiveVariants,
  selectMenuVariant,
  customerPresentationText,
  fillBlankLocalesWithStaffName,
  effectiveProductColumns,
  kitchenPresentationName,
  parentJoin,
  parentProducts,
  staffPresentationName,
} from "@waitron/catalogue";
import type {
  AttachedModifiers,
  BasketItemWithOptions,
  DietaryLabel,
  DietProfile,
  LockedLine,
  PricedLines,
  ProductAllergens,
  VatClass,
} from "@waitron/catalogue";
import { formatInvoiceNumber, recordSale } from "@waitron/core";
import type { FloorAnnotator, PreparationRoute } from "@waitron/module";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { FloorTableShape } from "./tables.js";
import { issuancePass } from "./issuance-pass.js";
import { VENUE_SERVICE } from "./modules.js";
import { requireCourse, requireLiveCourse } from "./kitchen.js";
import { enqueueCorrectionSlips, enqueueKitchenTickets } from "./kitchen-print.js";
import { requireNullableString } from "@waitron/server-kit";
import { isUuid } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import { readReceiptOrder } from "./receipt-order.js";
import { ticketLinesFrom } from "./receipt-lines.js";
import { enqueueOriginalReceipt } from "./receipt-print.js";
import type { TillSaleResult } from "./till-sale.js";

export interface WorkingOrderDeps {
  db: Database;
}

/** `db` plus the fiscal backend and trusted clock that a path filing a sale needs. */
export interface TillSaleDeps {
  db: Database;
  backend: FiscalBackend;
  clock: TrustedClock;
}

type WorkingOrderLineInsert = typeof workingOrderLines.$inferInsert;

/** Threaded out so a caller that persists the order and files its sale in one transaction reuses
 * this price rather than pricing the basket twice. */
type PricedBasket = PricedLines;

/** `note` is a free-text kitchen note on the parent dish line: non-fiscal, never part of a sale. */
export type LineExtras = { note?: string; variantId?: string };

/**
 * Every extras and options definition the dishes in one basket offer, read ONCE before the line
 * loop (CLAUDE.md §3). The lists come from the same body the till's picker is drawn from, so what
 * the till is offered is the set the validators answer. Receipt: docs/developers/modifiers.md.
 */
interface BasketModifiers extends AttachedModifiers {
  /** Every product an ACTIVE list offers, by id — what {@link buildLineExtras} freezes onto a child.
   * When the basket is priced afresh, only the Active and Available ones (see `sellableOnly`). */
  extraProducts: ReadonlyMap<string, ExtraProductFacts>;
}

/**
 * Only an ACTIVE list's products are read: only an active list can be answered at all
 * (`validateExtraSelections`).
 *
 * `sellableOnly` drops Inactive and Unavailable products from every list, so a pick of one is
 * refused exactly as a pick the list never offered. The held-order edit that keeps lines already
 * rung passes `false`, so a line kept at or below its stored quantity keeps a pick that has since
 * sold out; a raised line is checked by {@link updateHeldOrder}.
 */
async function resolveBasketModifiers(
  tx: Transaction,
  dishes: readonly { productId: string; menuItemId: string }[],
  defaultLanguage: string,
  sellableOnly: boolean,
): Promise<BasketModifiers> {
  const attached = await resolveAttachedModifiers(tx, dishes);

  const offeredProductIds = [
    ...new Set(
      [...attached.extrasByHolder.values()].flatMap((lists) =>
        lists.flatMap((list) => (list.active ? list.items.map((item) => item.productId) : [])),
      ),
    ),
  ];
  const extraProducts = new Map<string, ExtraProductFacts>();
  if (offeredProductIds.length > 0) {
    const rows = await tx
      .select({
        id: products.id,
        name: products.name,
        customerName: products.customerName,
        kitchenName: products.kitchenName,
        // A variant that leaves its VAT blank is taxed at its parent's rate.
        vatClass: effectiveProductColumns.vatClass,
      })
      .from(products)
      .leftJoin(parentProducts, parentJoin)
      .where(
        sellableOnly
          ? and(
              inArray(products.id, offeredProductIds),
              eq(products.active, true),
              eq(products.available, true),
            )
          : inArray(products.id, offeredProductIds),
      );
    for (const row of rows) {
      extraProducts.set(row.id, {
        id: row.id,
        name: row.name,
        descriptions: customerPresentationText(
          {
            name: row.name,
            customerName: row.customerName,
            kitchenName: row.kitchenName,
            variantName: null,
            variantCustomerName: null,
            variantKitchenName: null,
          },
          defaultLanguage,
        ).product,
        kitchenName: row.kitchenName,
        vatClass: row.vatClass as VatClass,
      });
    }
  }
  if (!sellableOnly) return { ...attached, extraProducts };
  const extrasByHolder = new Map(
    [...attached.extrasByHolder].map(([holder, lists]) => [
      holder,
      lists.map((list) => ({
        ...list,
        items: list.items.filter((item) => extraProducts.has(item.productId)),
      })),
    ]),
  );
  return { ...attached, extrasByHolder, extraProducts };
}

/**
 * Price requested lines from the order's zone's menu offers. Return both the insertable line
 * snapshots and the basket result so a caller filing the same basket can reuse it. Stored gross
 * unit prices preserve the price agreed at add time.
 */
async function priceOrderLines(
  tx: Transaction,
  cfg: TillConfig,
  workingOrderId: string,
  // `courseId` absent or null = the offer's default course; a string is an override.
  // Each extras pick becomes a CHILD row taxed at the picked product's VAT class, never the dish's.
  // An ACTIVE options list must be answered even when `options` is absent.
  requestedLines: ({
    menuItemId: string;
    quantity: string;
    courseId?: string | null;
    extras?: ExtraSelection[];
    options?: OptionSelection[];
  } & LineExtras)[],
  zoneId?: string,
): Promise<{
  lineRows: WorkingOrderLineInsert[];
  priced: PricedBasket;
  identities: OrderLineIdentity[];
  lineContexts: { workingOrderLineId: string; menuItemId: string }[];
}> {
  if (requestedLines.length === 0) {
    // A lineless call (splitOffCheck, openTab, unjoin) needs no zone and reads nothing.
    return { lineRows: [], priced: priceBasket([]), identities: [], lineContexts: [] };
  }
  if (zoneId === undefined) {
    throw new AppError("order.service_context_missing", { workingOrderId });
  }
  const offers = await VENUE_SERVICE.listZoneOffers(tx, cfg, zoneId);
  const availableById = new Map(offers.offers.map((offer) => [offer.id, offer]));
  const lines = requestedLines.map((line) => {
    // The wire body is JSON, so a line may still name a product the types no longer carry.
    if (typeof line.menuItemId !== "string" || Object.hasOwn(line, "productId")) {
      throw new AppError("management.request_invalid", { field: "lines" });
    }
    const offer = availableById.get(line.menuItemId);
    if (offer === undefined) {
      throw new AppError("service_zone.offer_not_allowed", {
        zoneId,
        menuItemId: line.menuItemId,
      });
    }
    return { ...line, offer };
  });
  const invoiceLocales = await readInvoiceLocales(tx, cfg.locationId);
  const contentConfig = await readContentLanguages(tx, cfg.locale);

  // One read per definition kind for the whole basket, never per line (CLAUDE.md §3).
  const modifiers = await resolveBasketModifiers(
    tx,
    lines.map((line) => ({ productId: line.offer.productId, menuItemId: line.menuItemId })),
    contentConfig.defaultLanguage,
    true,
  );
  // A product with an Active variant is never sold as itself, and an extras pick cannot name a
  // variant, so a pick of such a product is refused below.
  const requiresVariant = await parentsWithActiveVariants(tx, [...modifiers.extraProducts.keys()]);

  // `priceBasketWithOptions` expands each item to a parent row then its child rows in this same
  // order, so `lineMeta[i]` lines up with `priced.lines[i]` one-for-one.
  type LineMeta =
    | {
        kind: "parent";
        productId: string;
        menuItemId: string;
        courseId: string | null;
        note: string | null;
      }
    | { kind: "child"; productId: string; menuItemId: string; extraListId: string };
  const items: BasketItemWithOptions[] = [];
  const lineMeta: LineMeta[] = [];
  for (const line of lines) {
    const { offer } = line;
    const selection = selectMenuVariant(offer, line.variantId ?? null);
    const customerText = customerPresentationText(selection, contentConfig.defaultLanguage);
    const product = {
      name: selection.name,
      unitPrice: selection.unitPrice,
      unit: selection.unit,
      pricingUnit: selection.unit.hardwareUnit === null ? ("each" as const) : ("weight" as const),
      vatClass: selection.vatClass as VatClass,
      category: selection.category,
      courseId: selection.courseId,
      descriptions: customerText.product,
      variantName: selection.variantName,
      variantDescriptions: customerText.variant,
      variantKitchenName: selection.variantKitchenName,
      kitchenName: selection.kitchenName,
    };

    // Validated before pricing, so a bad note aborts the whole basket. The body is JSON, so a
    // non-string is screened out before it can reach `.trim()` as a TypeError.
    const NOTE_LIMIT = 200;
    const screenedNote = line.note === undefined ? null : requireNullableString(line.note, "note");
    const trimmedNote = screenedNote?.trim() ?? "";
    if (trimmedNote.length > NOTE_LIMIT) {
      throw new AppError("working_order.note_too_long", {
        length: trimmedNote.length,
        limit: NOTE_LIMIT,
      });
    }
    const note = trimmedNote.length === 0 ? null : trimmedNote;

    const { extraChildren, optionSnapshots } = buildLineExtras(
      {
        extras: modifiers.extrasByHolder.get(line.menuItemId) ?? [],
        options: modifiers.optionsByProduct.get(offer.productId) ?? [],
      },
      modifiers.extraProducts,
      { extras: line.extras, options: line.options },
      contentConfig.defaultLanguage,
    );
    for (const child of extraChildren) {
      if (requiresVariant.has(child.productId)) {
        throw new AppError("product.variant_required", { productId: child.productId });
      }
    }

    // A child is priced at dish quantity × pick quantity, so a dish sold by weight would bill a
    // fraction of each extra.
    if (extraChildren.length > 0 && product.pricingUnit !== "each") {
      throw new AppError("extras.unsupported_product", {
        productId: offer.productId,
        pricingUnit: product.pricingUnit,
      });
    }

    items.push({
      product,
      quantity: line.quantity,
      optionSnapshots,
      options: extraChildren.map((child) => ({
        name: child.name,
        descriptions: child.descriptions,
        kitchenName: child.kitchenName,
        // The GROSS price of ONE of this extra.
        priceDelta: child.price,
        // Never null, so the dish's rate is never inherited.
        vatClass: child.vatClass,
        quantity: child.quantity,
      })),
    });
    // A CHILD row takes no course: kitchen coursing is per dish.
    lineMeta.push({
      kind: "parent",
      productId: selection.productId,
      menuItemId: line.menuItemId,
      courseId: line.courseId ?? product.courseId ?? null,
      note,
    });
    for (const child of extraChildren) {
      lineMeta.push({
        kind: "child",
        productId: child.productId,
        menuItemId: line.menuItemId,
        extraListId: child.listId,
      });
    }
  }

  // Only an OVERRIDE is screened: the product's default course is already a stored key, and
  // re-validating it would refuse a product whose default course was since deactivated.
  const overrideCourseIds = new Set(
    lines
      .map((line) => line.courseId)
      .filter((courseId): courseId is string => courseId !== null && courseId !== undefined),
  );
  for (const courseId of overrideCourseIds) {
    if (!isUuid(courseId)) {
      throw new AppError("course.not_found", { courseId });
    }
    await requireLiveCourse(tx, cfg, courseId);
  }

  const priced = priceBasketWithOptions(items);

  // New lines snapshot the location's receipt languages; locked and issued lines keep their stored
  // text. A locale a variant's text leaves blank takes the variant's own staff name, never the
  // parent's.
  for (const line of priced.lines) {
    line.descriptions = toInvoiceLineDescriptions(
      line.descriptions,
      invoiceLocales,
      contentConfig.defaultLanguage,
    );
    if (line.variantDescriptions != null) {
      line.variantDescriptions = fillBlankLocalesWithStaffName(
        toInvoiceLineDescriptions(
          line.variantDescriptions,
          invoiceLocales,
          contentConfig.defaultLanguage,
        ),
        line.variantName ?? "",
      );
    }
  }

  // Pre-generated so a CHILD row's `parent_line_id` can name its parent's id in the same insert.
  const ids = priced.lines.map(() => randomUUID());
  const byLineNo = new Map(priced.lines.map((line, i) => [line.lineNo, ids[i]!]));
  const lineRows = priced.lines.map((line, i) => {
    const meta = lineMeta[i]!;
    return {
      id: ids[i]!,
      workingOrderId,
      lineNo: line.lineNo,
      parentLineId: line.parentLineNo == null ? null : byLineNo.get(line.parentLineNo)!,
      productId: meta.productId,
      name: line.name,
      descriptions: line.descriptions,
      // Read off the priced line, so this row and a walk-up's sale filed from the same `priced`
      // result cannot describe different answers.
      optionSnapshots: line.optionSnapshots,
      unitName: line.unitName,
      unitPrecision: line.unitPrecision,
      quantity: stringToThousandths(line.quantity),
      unitPrice: stringToCents(line.unitPrice),
      // The gross unit price LOCKED at add time: a retrieved order is filed from it without a
      // re-price, so a later catalogue price change never moves the filed total. Never derived as
      // `line_total ÷ quantity`, which drifts for a weighed line.
      unitPriceGross: decimalToCents(priced.grossUnitPrices[i]!),
      vatRate: stringToBasisPoints(line.vatRate),
      // GROSS, unlike the filed `sale_lines.line_total`'s net base: every total the operator and
      // customer see is gross, so the held-orders list's `sum(line_total)` must be too.
      lineTotal: decimalToCents(priced.grossLineTotals[i]!),
      category: line.category ?? null,
      courseId: meta.kind === "parent" ? meta.courseId : null,
      note: meta.kind === "parent" ? meta.note : null,
      extraListId: meta.kind === "child" ? meta.extraListId : null,
      // From the priced row, never the request: only it holds the re-keyed customer text.
      variantName: line.variantName ?? null,
      variantDescriptions: line.variantDescriptions ?? null,
      variantKitchenName: line.variantKitchenName ?? null,
      kitchenName: line.kitchenName ?? null,
    };
  });
  const identities = lineMeta.map((meta, index) => ({
    id: ids[index]!,
    productId: meta.productId,
  }));
  const lineContexts = lineMeta.map((meta, index) => ({
    workingOrderLineId: ids[index]!,
    menuItemId: meta.menuItemId,
  }));
  return { lineRows, priced, identities, lineContexts };
}

/**
 * What the kitchen was asked to make: the ticket item's fired quantity. A ticket item fired before
 * `ticket_items.quantity` existed carries none, and reads its line's current quantity instead.
 */
const firedQuantity = sql<number>`coalesce(${ticketItems.quantity}, ${workingOrderLines.quantity})`;

const storedLineColumns = {
  id: workingOrderLines.id,
  productId: workingOrderLines.productId,
  parentLineId: workingOrderLines.parentLineId,
  grossUnitPrice: workingOrderLines.unitPriceGross,
  quantity: workingOrderLines.quantity,
  vatRate: workingOrderLines.vatRate,
  name: workingOrderLines.name,
  descriptions: workingOrderLines.descriptions,
  optionSnapshots: workingOrderLines.optionSnapshots,
  category: workingOrderLines.category,
  unitName: workingOrderLines.unitName,
  unitPrecision: workingOrderLines.unitPrecision,
  variantName: workingOrderLines.variantName,
  variantDescriptions: workingOrderLines.variantDescriptions,
  variantKitchenName: workingOrderLines.variantKitchenName,
  kitchenName: workingOrderLines.kitchenName,
};

type StoredLineRow = {
  [K in keyof typeof storedLineColumns]: GetColumnData<(typeof storedLineColumns)[K]>;
};

/**
 * Read a persisted order's STORED lines, snapshotted at add time, so every path that files a
 * persisted order files the same locked composition and a later catalogue price change never moves
 * the filed total. Each line's rate is the stored one; issuance replaces it while the order is open
 * ({@link priceStoredOrderForIssuance}).
 *
 * Refuses a LINELESS order with `sale.empty_basket`: an empty tab is a reachable state, and this is
 * the last check before its pay or place reaches a fiscal write or a card charge.
 */
export async function readLockedLines(
  tx: Transaction,
  workingOrderId: string,
): Promise<StoredOrderLine[]> {
  return toStoredLines(
    await tx
      .select(storedLineColumns)
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, workingOrderId))
      .orderBy(workingOrderLines.lineNo),
  );
}

/**
 * {@link readLockedLines}, with each line's product's CURRENT effective VAT class read in the same
 * query — a variant with none of its own reads its parent's — or `null` for a line that names no
 * product.
 */
async function readLockedLinesForIssuance(
  tx: Transaction,
  workingOrderId: string,
): Promise<(StoredOrderLine & { vatClass: VatClass | null })[]> {
  const rows = await tx
    .select({ ...storedLineColumns, vatClass: effectiveProductColumns.vatClass })
    .from(workingOrderLines)
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(parentProducts, parentJoin)
    .where(eq(workingOrderLines.workingOrderId, workingOrderId))
    .orderBy(workingOrderLines.lineNo);
  return toStoredLines(rows).map((line, i) => ({
    ...line,
    // `working_order_lines_product_fk` is `on delete restrict`, so a line naming a product joins it.
    vatClass: line.identity.productId === null ? null : (rows[i]!.vatClass as VatClass),
  }));
}

function toStoredLines(stored: readonly StoredLineRow[]): StoredOrderLine[] {
  if (stored.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }
  // `parentLineNo` is rebuilt in the array-position space `priceRows` renumbers into (`i + 1`), NOT
  // the stored `line_no` space: a void or a transfer leaves stored numbers with gaps, and keying on
  // them would file a child under the wrong parent in the immutable record.
  const positionById = new Map(stored.map((line, i) => [line.id, i + 1]));
  return stored.map((line) => ({
    identity: { id: line.id, productId: line.productId },
    locked: {
      grossUnitPrice: centsToDecimal(line.grossUnitPrice),
      quantity: thousandthsToDecimal(line.quantity),
      vatRate: basisPointsToDecimal(line.vatRate),
      name: line.name,
      descriptions: line.descriptions,
      optionSnapshots: line.optionSnapshots,
      category: line.category,
      unitName: line.unitName,
      unitPrecision: line.unitPrecision,
      parentLineNo:
        line.parentLineId == null ? null : (positionById.get(line.parentLineId) ?? null),
      variantName: line.variantName,
      variantDescriptions: line.variantDescriptions,
      variantKitchenName: line.variantKitchenName,
      kitchenName: line.kitchenName,
    },
  }));
}

/** A stored working-order line: its identity and its locked composition. */
export interface StoredOrderLine {
  identity: OrderLineIdentity;
  locked: LockedLine;
}

/** A working-order line's own identity. The filed sale line does not keep the line `id`. */
export interface OrderLineIdentity {
  id: string;
  productId: string | null;
}

/** Priced lines together with, at the same index, the working-order line each was priced from. */
export interface PricedOrder {
  priced: PricedLines;
  identities: OrderLineIdentity[];
}

/** Price a persisted order exactly as its lines are stored, rates included, to rebuild a filed
 * ticket's lines. The stored rate is not always the filed one (an order issued while placed keeps
 * its stored rate), so a rebuilt ticket takes its VAT breakdown from the filed record, never from
 * these lines. */
export async function priceStoredOrder(
  tx: Transaction,
  workingOrderId: string,
): Promise<PricedLines> {
  return priceLockedLines((await readLockedLines(tx, workingOrderId)).map(({ locked }) => locked));
}

/**
 * Issue a persisted order's price: each line's stored gross unit price, at the VAT rate of its
 * product's CURRENT effective VAT class (spec §11.4), read with the lines themselves. Returns each
 * priced line's working-order identity for `issuancePass`, and refuses a lineless order (see
 * {@link readLockedLines}).
 *
 * The resolved rate and its net unit price are written back, on the caller's transaction, onto each
 * line whose rate changed, but only while the order is open. A placed order's lines are not
 * written.
 */
export async function priceStoredOrderForIssuance(
  tx: Transaction,
  workingOrderId: string,
): Promise<PricedOrder> {
  const stored = await readLockedLinesForIssuance(tx, workingOrderId);
  const priced = priceLockedLines(
    stored.map(({ locked, vatClass }) =>
      // A line with no product names nothing to resolve from, so it keeps the rate it was added at.
      vatClass === null ? locked : { ...locked, vatRate: resolveVatRate(vatClass) },
    ),
  );
  const changed = stored.flatMap(({ identity, locked }, i) => {
    const line = priced.lines[i]!;
    const vatRate = stringToBasisPoints(line.vatRate);
    return vatRate === stringToBasisPoints(locked.vatRate)
      ? []
      : [{ id: identity.id, vatRate, unitPrice: stringToCents(line.unitPrice) }];
  });
  await writeBackIssuedRates(tx, workingOrderId, changed);
  return { priced, identities: stored.map(({ identity }) => identity) };
}

async function writeBackIssuedRates(
  tx: Transaction,
  workingOrderId: string,
  changed: readonly { id: string; vatRate: number; unitPrice: number }[],
): Promise<void> {
  if (changed.length === 0) return;
  const byLine = (value: (line: (typeof changed)[number]) => number) =>
    sql`case ${workingOrderLines.id} ${sql.join(
      changed.map((line) => sql`when ${line.id} then ${value(line)}`),
      sql` `,
    )} end`;
  await tx
    .update(workingOrderLines)
    .set({ vatRate: byLine((line) => line.vatRate), unitPrice: byLine((line) => line.unitPrice) })
    .where(
      and(
        inArray(
          workingOrderLines.id,
          changed.map((line) => line.id),
        ),
        // `working_order_lines_require_open_parent_update` refuses an update of a line whose order
        // is not open, so an order issued while placed keeps its stored rate on the line.
        exists(
          tx
            .select({ one: sql`1` })
            .from(workingOrders)
            .where(and(eq(workingOrders.id, workingOrderId), eq(workingOrders.status, "open"))),
        ),
      ),
    );
}

/** Read a filed sale's invoice number ("A/1"); the fiscal record reference is regime-opaque and
 * carries none. */
export async function readInvoiceNumber(tx: Transaction, saleId: SaleId): Promise<string> {
  const [issued] = await tx
    .select({ code: invoiceSeries.code, number: sales.invoiceNumber })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(eq(sales.id, saleId));
  return formatInvoiceNumber(issued!.code, issued!.number);
}

/** Surcharge fields a VAT band may carry are dropped deliberately: the counter ticket carries base
 * and tax only. */
export function toVatBreakdown(
  bands: readonly { rate: string; base: string; tax: string }[],
): { rate: string; base: string; tax: string }[] {
  return bands.map((v) => ({ rate: v.rate, base: v.base, tax: v.tax }));
}

/**
 * Carries NO price of any kind: the server prices from the zone's menu offers.
 *
 * `id` is client-supplied and held stable across a retry, which makes park IDEMPOTENT: a re-sent
 * park collides on `working_orders.id` and replays the existing OPEN order's result. A colliding id
 * whose row is no longer `open` is an id reuse, not a retry, and is re-thrown.
 *
 * `operatorId` is accepted but not persisted: `working_orders` has no operator column.
 */
export interface ParkOrderRequest {
  id: string;
  lines: ({
    menuItemId: string;
    quantity: string;
    extras?: ExtraSelection[];
    options?: OptionSelection[];
  } & LineExtras)[];
  zoneId?: string;
  label?: string;
  operatorId?: string;
}

export interface ParkOrderResult {
  id: string;
  orderNumber: number;
}

/**
 * Persist an OPEN working order and its priced lines on the CALLER's transaction, returning the
 * price its lines were priced from so a walk-up files its sale from the same price. Shared so a
 * walk-up order has the same shape as a parked one. The empty-basket refusal stays with each caller.
 */
export async function createOpenOrder(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  lines: ({
    menuItemId: string;
    quantity: string;
    extras?: ExtraSelection[];
    options?: OptionSelection[];
  } & LineExtras)[],
  label: string | null,
  // A tab's table link is `dining_tables.tab_id`, not `deliveryTableId`, so openTab passes none.
  placement: { deliveryTableId?: string | null; zoneId?: string } = {},
): Promise<{
  orderNumber: number;
  priced: PricedBasket;
  identities: OrderLineIdentity[];
  lineRows: WorkingOrderLineInsert[];
}> {
  // Checked first so an unknown id is `table.not_found`, not a raw foreign-key failure. An inactive
  // table is allowed.
  const deliveryTableId = placement.deliveryTableId ?? null;
  let effectiveZoneId = placement.zoneId;
  if (deliveryTableId !== null) {
    const [table] = await tx
      .select({ id: diningTables.id, zoneId: diningTables.zoneId })
      .from(diningTables)
      .where(
        and(eq(diningTables.id, deliveryTableId), eq(diningTables.locationId, cfg.locationId)),
      );
    if (table === undefined) {
      throw new AppError("table.not_found", { tableId: deliveryTableId });
    }
    effectiveZoneId = table.zoneId ?? effectiveZoneId;
  }
  const { lineRows, priced, identities, lineContexts } = await priceOrderLines(
    tx,
    cfg,
    id,
    lines,
    effectiveZoneId,
  );
  const orderNumber = await allocateOrderNumber(tx, cfg.nodeId);

  await tx.insert(workingOrders).values({
    id,
    tillId: cfg.tillId,
    nodeId: cfg.nodeId,
    orderNumber,
    label,
    status: "open",
    // Not a fiscal field.
    deliveryTableId,
  });

  // An empty tab has no lines, and `tx.insert(...).values([])` throws.
  if (lineRows.length > 0) {
    await tx.insert(workingOrderLines).values(lineRows);
  }
  if (effectiveZoneId !== undefined) {
    await VENUE_SERVICE.recordOrderContext(tx, cfg, id, effectiveZoneId);
    await VENUE_SERVICE.recordLineContexts(tx, cfg, id, lineContexts);
  }

  return { orderNumber, priced, identities, lineRows };
}

export async function parkOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  req: ParkOrderRequest,
): Promise<ParkOrderResult> {
  if (req.lines.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }

  try {
    return await withTransaction(deps.db, async (tx) => {
      const { orderNumber } = await createOpenOrder(tx, cfg, req.id, req.lines, req.label ?? null, {
        zoneId: req.zoneId,
      });
      return { id: req.id, orderNumber };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // A re-sent park collided on the id an earlier park committed. One write transaction runs on the
    // venue file at a time, so that row is readable in a fresh transaction: replay its number.
    return withTransaction(deps.db, async (tx) => {
      const [existing] = await tx
        .select({ orderNumber: workingOrders.orderNumber })
        .from(workingOrders)
        .where(and(eq(workingOrders.id, req.id), eq(workingOrders.status, "open")));
      // The colliding id is not `open`: an id reuse, not a retry.
      if (existing === undefined) {
        throw error;
      }
      return { id: req.id, orderNumber: existing.orderNumber };
    });
  }
}

/**
 * Open the running tab on a table. The link is the table's `tab_id` back-pointer; the order carries
 * no tab column.
 *
 * One open tab per table needs no lock and no unique index: the check-then-set below cannot
 * interleave with a second `openTab`, because `withTransaction` IS the venue file's write lock. A
 * STALE `tab_id`, pointing at a settled or abandoned order, reads as free and is overwritten, so the
 * pay path needs no settle-time write.
 */
export async function openTab(
  tx: Transaction,
  cfg: TillConfig,
  req: {
    tableId: string;
    lines?: { menuItemId: string; quantity: string }[];
  },
): Promise<{ tabId: string; orderNumber: number }> {
  const [table] = await tx
    .select({ active: diningTables.active, tabId: diningTables.tabId, zoneId: diningTables.zoneId })
    .from(diningTables)
    .where(eq(diningTables.id, req.tableId));
  if (table === undefined) {
    throw new AppError("table.not_found", { tableId: req.tableId });
  }
  if (!table.active) {
    throw new AppError("table.inactive", { tableId: req.tableId });
  }

  if (table.zoneId !== null) {
    const context = await VENUE_SERVICE.resolveZoneContext(tx, cfg, table.zoneId);
    if (context.serviceMode !== "table_tab") {
      throw new AppError("service_zone.mode_incompatible", {
        zoneId: table.zoneId,
        expected: "table_tab",
        actual: context.serviceMode,
      });
    }
  }

  if (table.tabId !== null) {
    const [openTabRow] = await tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(and(eq(workingOrders.id, table.tabId), eq(workingOrders.status, "open")));
    if (openTabRow !== undefined) {
      throw new AppError("tab.already_open", { tableId: req.tableId });
    }
  }

  const tabId = randomUUID();
  const { orderNumber } = await createOpenOrder(tx, cfg, tabId, req.lines ?? [], null, {
    zoneId: table.zoneId ?? undefined,
  });
  // Also clears any stale manual status as the new tab opens.
  await tx
    .update(diningTables)
    .set({ tabId, statusId: null })
    .where(eq(diningTables.id, req.tableId));
  return { tabId, orderNumber };
}

/**
 * This working order is an open tab a dining table points at, else `tab.not_open`. The back-pointer
 * is what makes it a TAB rather than a detached CHECK (a table-less open order a split minted).
 */
async function assertAnchoredTabOpen(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
): Promise<void> {
  await assertTabOpen(tx, cfg, tabId);
  const [pointer] = await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .where(eq(diningTables.tabId, tabId));
  if (pointer === undefined) {
    throw new AppError("tab.not_open", { tabId });
  }
}

/**
 * Fire lines to the kitchen: one `ticket_items` row per line, its station and course RESOLVED and
 * SNAPSHOTTED at fire time, so a later configuration change never moves an already-fired item. The
 * one fire point every path funnels through. A zoned order routes by the venue-service route
 * (`no_preparation` skips the line); a context-less order uses the product, category and
 * location-default station chain. Also enqueues kitchen print jobs on the same transaction.
 */
export async function fireLines(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  // A CHILD modifier line is part of its parent dish and gets no ticket item of its own.
  // `hold: true` inserts the line unfired whatever its course; it is not stored.
  lines: {
    id: string;
    productId: string | null;
    courseId: string | null;
    parentLineId: string | null;
    note: string | null;
    hold?: boolean;
  }[],
): Promise<void> {
  const parentLines = lines.filter((line) => line.parentLineId === null);
  if (parentLines.length === 0) {
    return;
  }
  lines = parentLines;
  const serviceContext = await VENUE_SERVICE.findOrderContext(tx, cfg, orderId);
  const productIds = [
    ...new Set(lines.map((line) => line.productId).filter((id): id is string => id !== null)),
  ];

  const serviceRouteByProduct =
    serviceContext === null
      ? new Map<string, PreparationRoute>()
      : await VENUE_SERVICE.resolvePreparationRoutes(tx, cfg, serviceContext.zoneId, productIds);

  const legacyLines = lines.filter(
    (line) => line.productId === null || !serviceRouteByProduct.has(line.productId),
  );
  let defaultStationId: string | null = null;
  let routeByProduct = new Map<
    string,
    { productStationId: string | null; categoryStationId: string | null }
  >();
  if (legacyLines.length > 0) {
    // `active` is required: `deactivateStation` leaves `is_default` set on a deactivated default,
    // and a line routed there would reach a queue no display shows.
    const [fallback] = await tx
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(
        and(
          eq(kitchenStations.locationId, cfg.locationId),
          eq(kitchenStations.isDefault, true),
          eq(kitchenStations.active, true),
        ),
      );
    defaultStationId = fallback?.id ?? null;

    // A variant line routes by its EFFECTIVE station and category: where its parent would, unless it
    // sets its own.
    const legacyProductIds = [
      ...new Set(
        legacyLines.map((line) => line.productId).filter((id): id is string => id !== null),
      ),
    ];
    const routes = await tx
      .select({
        productId: products.id,
        productStationId: effectiveProductColumns.stationId,
        categoryStationId: categories.stationId,
      })
      .from(products)
      .leftJoin(parentProducts, parentJoin)
      .leftJoin(categories, eq(categories.id, effectiveProductColumns.categoryId))
      .where(inArray(products.id, legacyProductIds));
    routeByProduct = new Map(routes.map((route) => [route.productId, route]));
  }

  const courseByLine = new Map(lines.map((line) => [line.id, line.courseId ?? null]));

  // `anyFired` lets a later round join a course already cooking; `itemCount` includes prior rounds
  // when choosing the earliest course.
  const courseRows = await tx
    .select({
      id: kitchenCourses.id,
      displayOrder: kitchenCourses.displayOrder,
      // Arrives as the number 1 or 0, never a boolean: test its truthiness, never with `===`.
      anyFired: sql<boolean>`max(${ticketItems.firedAt} is not null)`,
      itemCount: sql<number>`cast(count(${ticketItems.id}) as int)`,
    })
    .from(kitchenCourses)
    .leftJoin(
      ticketItems,
      and(eq(ticketItems.courseId, kitchenCourses.id), eq(ticketItems.workingOrderId, orderId)),
    )
    .where(eq(kitchenCourses.locationId, cfg.locationId))
    .groupBy(kitchenCourses.id, kitchenCourses.displayOrder);

  const firedCourseIds = new Set(courseRows.filter((row) => row.anyFired).map((row) => row.id));

  // The order's earliest course, over prior rounds and this batch. A line with no course never
  // enters the set.
  const orderCourseIds = new Set<string>([
    ...courseRows.filter((row) => row.itemCount > 0).map((row) => row.id),
    ...[...courseByLine.values()].filter((id): id is string => id !== null),
  ]);
  const displayOrderByCourse = new Map(courseRows.map((row) => [row.id, row.displayOrder]));
  const orderDisplayOrders = courseRows
    .filter((row) => orderCourseIds.has(row.id))
    .map((row) => row.displayOrder);
  const earliestDisplayOrder =
    orderDisplayOrders.length === 0 ? null : Math.min(...orderDisplayOrders);

  // One clock reading for the whole round, so every item of it carries the same `fired_at` and
  // every line sent in it the same `sent_at`.
  const firedAt = nowIso();
  const quantityByLine = await readLineQuantities(
    tx,
    lines.map((line) => line.id),
  );
  const sentLineIds: string[] = [];
  // A line with nowhere to go refuses the whole fire.
  const values = lines
    .map((line) => {
      const route = line.productId === null ? undefined : routeByProduct.get(line.productId);
      const serviceRoute =
        serviceContext === null || line.productId === null
          ? null
          : (serviceRouteByProduct.get(line.productId) ?? null);
      const courseId = courseByLine.get(line.id) ?? null;
      // A line not fired now is HELD (`fired_at` NULL) until `fireCourse` or `sendLines` releases it.
      const fired =
        line.hold === true
          ? false
          : courseId === null ||
            firedCourseIds.has(courseId) ||
            displayOrderByCourse.get(courseId) === earliestDisplayOrder;
      // A no-preparation line has no kitchen work, and is sent when it would have fired.
      if (fired) sentLineIds.push(line.id);
      if (serviceRoute?.kind === "no_preparation") return null;
      const stationId =
        serviceRoute?.kind === "station"
          ? serviceRoute.stationId
          : (route?.productStationId ?? route?.categoryStationId ?? defaultStationId);
      if (stationId === null || stationId === undefined) {
        throw new AppError("station.no_default", { locationId: cfg.locationId });
      }
      return {
        nodeId: cfg.nodeId,
        workingOrderId: orderId,
        workingOrderLineId: line.id,
        stationId,
        courseId,
        note: line.note,
        firedAt: fired ? firedAt : null,
        state: "queued" as const,
        // What the kitchen is asked to make. A later split or partial void of the line does not
        // change what was asked; only a partial void reduces it.
        quantity: quantityByLine.get(line.id)!,
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);
  await stampSent(tx, orderId, sentLineIds, firedAt);
  if (values.length === 0) return;
  let inserted: { workingOrderLineId: string; stationId: string; firedAt: string | null }[];
  try {
    // Printing from `.returning()`, not a re-query: a re-query would sweep up earlier rounds'
    // already-fired items and reprint them.
    inserted = await tx.insert(ticketItems).values(values).returning({
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      firedAt: ticketItems.firedAt,
    });
  } catch (error) {
    // A re-fire collides on the per-line unique, e.g. a double `sendToPrep`.
    if (isUniqueViolation(error)) {
      throw new AppError("ticket.already_fired", { workingOrderId: orderId });
    }
    throw error;
  }

  // Held items print only when released. Outbox inserts on the same transaction: no hardware I/O
  // blocks the fire.
  const firedItems = inserted
    .filter((row) => row.firedAt !== null)
    .map((row) => ({ workingOrderLineId: row.workingOrderLineId, stationId: row.stationId }));
  await enqueueKitchenTickets(tx, cfg, orderId, firedItems);
}

/** Each line's stored quantity, as thousandths, by line id. */
async function readLineQuantities(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<Map<string, number>> {
  if (lineIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: workingOrderLines.id, quantity: workingOrderLines.quantity })
    .from(workingOrderLines)
    .where(inArray(workingOrderLines.id, [...lineIds]));
  return new Map(rows.map((row) => [row.id, row.quantity]));
}

/**
 * Stamp `sent_at` on dish lines not stamped yet, and on their extras children, which follow their
 * dish. A line already stamped keeps its first stamp, so a recalled line sent again keeps it.
 *
 * Only while the order is open: `working_order_lines_require_open_parent_update` refuses a line
 * update on any other order. `placeOrder` stamps its lines itself before the order leaves `open`,
 * and a settled order sent to preparation is stamped by nothing.
 */
async function stampSent(
  tx: Transaction,
  orderId: string,
  lineIds: readonly string[],
  at: string,
): Promise<void> {
  if (lineIds.length === 0) return;
  await tx
    .update(workingOrderLines)
    .set({ sentAt: at })
    .where(
      and(
        eq(workingOrderLines.workingOrderId, orderId),
        or(
          inArray(workingOrderLines.id, [...lineIds]),
          inArray(workingOrderLines.parentLineId, [...lineIds]),
        ),
        isNull(workingOrderLines.sentAt),
        exists(
          tx
            .select({ one: sql`1` })
            .from(workingOrders)
            .where(and(eq(workingOrders.id, orderId), eq(workingOrders.status, "open"))),
        ),
      ),
    );
}

/**
 * The dish lines of an order that have no ticket item and are not yet stamped sent, whose route is
 * `no_preparation`, and that sit in one of `courseIds` (`null` standing for no course) or are named
 * in `lineIds`: the no-route lines a course releases when it fires. Only a zoned order has
 * no-preparation routes.
 */
async function heldNoRouteLines(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  scope: { courseIds: readonly (string | null)[]; lineIds: readonly string[] },
): Promise<string[]> {
  const namedCourses = scope.courseIds.filter((id): id is string => id !== null);
  const inScope = [
    ...(namedCourses.length > 0 ? [inArray(workingOrderLines.courseId, namedCourses)] : []),
    ...(scope.courseIds.includes(null) ? [isNull(workingOrderLines.courseId)] : []),
    ...(scope.lineIds.length > 0 ? [inArray(workingOrderLines.id, [...scope.lineIds])] : []),
  ];
  if (inScope.length === 0) return [];
  const serviceContext = await VENUE_SERVICE.findOrderContext(tx, cfg, orderId);
  if (serviceContext === null) return [];
  const candidates = await tx
    .select({ id: workingOrderLines.id, productId: workingOrderLines.productId })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(
        eq(workingOrderLines.workingOrderId, orderId),
        isNull(workingOrderLines.parentLineId),
        isNull(workingOrderLines.sentAt),
        isNull(ticketItems.id),
        or(...inScope),
      ),
    );
  const productIds = [
    ...new Set(candidates.flatMap((line) => (line.productId === null ? [] : [line.productId]))),
  ];
  const routes = await VENUE_SERVICE.resolvePreparationRoutes(
    tx,
    cfg,
    serviceContext.zoneId,
    productIds,
  );
  return candidates
    .filter(
      (line) => line.productId !== null && routes.get(line.productId)?.kind === "no_preparation",
    )
    .map((line) => line.id);
}

/**
 * Release held items of a course by stamping fired_at. Require the course to exist
 * in this venue, including a deactivated course whose food still needs release.
 * Already-fired items retain their timestamps; an empty held set is a no-op.
 */
export async function fireCourse(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  courseId: string,
): Promise<void> {
  await requireCourse(tx, cfg, courseId);
  const firedNow = nowIso();
  const firedItems = await tx
    .update(ticketItems)
    .set({ firedAt: firedNow })
    .where(
      and(
        eq(ticketItems.workingOrderId, orderId),
        eq(ticketItems.courseId, courseId),
        isNull(ticketItems.firedAt),
      ),
    )
    .returning({
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      quantity: ticketItems.quantity,
    });
  const noRoute = await heldNoRouteLines(tx, cfg, orderId, { courseIds: [courseId], lineIds: [] });
  await stampSent(
    tx,
    orderId,
    [...firedItems.map((item) => item.workingOrderLineId), ...noRoute],
    firedNow,
  );
  // The `fired_at IS NULL` predicate makes `RETURNING` exactly the items that fired now, so a re-fire
  // prints nothing.
  await enqueueKitchenTickets(tx, cfg, orderId, firedItems);
}

/**
 * Send selected held lines of an open tab, refreshing queued_at when they fire.
 * The caller's transaction includes kitchen writes and their print jobs.
 */
export async function sendLines(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lineNos: number[],
): Promise<void> {
  await assertAnchoredTabOpen(tx, cfg, tabId);
  // An empty list fires every HELD line of the tab.
  const namedLineIds =
    lineNos.length === 0
      ? []
      : (
          await tx
            .select({ id: workingOrderLines.id })
            .from(workingOrderLines)
            .where(
              and(
                eq(workingOrderLines.workingOrderId, tabId),
                inArray(workingOrderLines.lineNo, lineNos),
              ),
            )
        ).map((line) => line.id);
  // One clock reading for both stamps: `queued_at` is what every age on the boards is measured from.
  const firedNow = nowIso();
  const firedItems = await tx
    .update(ticketItems)
    .set({ firedAt: firedNow, queuedAt: firedNow })
    .where(
      and(
        eq(ticketItems.workingOrderId, tabId),
        isNull(ticketItems.firedAt),
        ...(lineNos.length === 0 ? [] : [inArray(ticketItems.workingOrderLineId, namedLineIds)]),
      ),
    )
    .returning({
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      courseId: ticketItems.courseId,
      quantity: ticketItems.quantity,
    });
  // Sending a held line releases its course, so the course's no-route lines are sent with it.
  const noRoute = await heldNoRouteLines(tx, cfg, tabId, {
    courseIds: [...new Set(firedItems.map((item) => item.courseId))],
    lineIds: namedLineIds,
  });
  await stampSent(
    tx,
    tabId,
    [...firedItems.map((item) => item.workingOrderLineId), ...noRoute],
    firedNow,
  );
  // As in `fireCourse`, a re-send of an already-fired line prints nothing.
  await enqueueKitchenTickets(
    tx,
    cfg,
    tabId,
    firedItems.map(({ workingOrderLineId, stationId, quantity }) => ({
      workingOrderLineId,
      stationId,
      quantity,
    })),
  );
}

/**
 * Recall selected lines of an open tab only while their items remain queued.
 * Refuse the whole call if a line is missing or any item has started. Previously
 * fired lines record a RECALLED kitchen notice and enqueue correction slips in the same
 * transaction; held lines do neither. Leave queued_at untouched until a later send refreshes it.
 *
 * With changes to sent items switched off (`readEditSentLines`), a line that was ever sent to a
 * station — stamped sent and holding a ticket item — is refused `ticket.already_fired`: a
 * paper-only kitchen reports nothing, so a recall slip cannot be trusted, and a void is the only
 * correction.
 */
export async function recallLines(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lineNos: number[],
): Promise<void> {
  await assertAnchoredTabOpen(tx, cfg, tabId);
  if (lineNos.length === 0) {
    return;
  }
  const lines = await tx
    .select({ lineNo: workingOrderLines.lineNo, id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(
      and(eq(workingOrderLines.workingOrderId, tabId), inArray(workingOrderLines.lineNo, lineNos)),
    );
  const foundLineNos = new Set(lines.map((r) => r.lineNo));
  for (const lineNo of lineNos) {
    if (!foundLineNos.has(lineNo)) {
      throw new AppError("tab.line_not_found", { tabId, lineNo });
    }
  }
  const lineIds = lines.map((r) => r.id);
  // Read BEFORE the un-fire, so `fired_at` still says which lines printed and need a RECALLED slip.
  const items = await tx
    .select({
      ticketItemId: ticketItems.id,
      workingOrderLineId: ticketItems.workingOrderLineId,
      state: ticketItems.state,
      firedAt: ticketItems.firedAt,
      stationId: ticketItems.stationId,
      quantity: firedQuantity,
      sentAt: workingOrderLines.sentAt,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(inArray(ticketItems.workingOrderLineId, lineIds));
  if (items.some((r) => r.sentAt !== null) && !(await VENUE_SERVICE.readEditSentLines(tx))) {
    throw new AppError("ticket.already_fired", { workingOrderId: tabId });
  }
  const started = items.find((r) => r.state === "preparing" || r.state === "ready");
  if (started !== undefined) {
    throw new AppError("ticket.already_started", { ticketItemId: started.ticketItemId });
  }
  // A held line never printed, so it gets no slip.
  const recalled = items
    .filter((r) => r.firedAt !== null && r.state === "queued")
    .map((r) => ({
      workingOrderLineId: r.workingOrderLineId,
      stationId: r.stationId!,
      quantity: r.quantity,
      wasStarted: false,
    }));
  await tx
    .update(ticketItems)
    .set({ firedAt: null })
    .where(
      and(
        eq(ticketItems.workingOrderId, tabId),
        eq(ticketItems.state, "queued"),
        inArray(ticketItems.workingOrderLineId, lineIds),
      ),
    );
  await enqueueCorrectionSlips(tx, cfg, tabId, recalled, "RECALLED");
}

/**
 * Bump every fired item of this order and course directly to ready. Held items
 * are skipped. An empty match is a no-op; this operation changes kitchen state only.
 */
export async function bumpCourseReady(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  courseId: string,
): Promise<void> {
  void cfg;
  await tx
    .update(ticketItems)
    .set(advanceSet("ready"))
    .where(
      and(
        eq(ticketItems.workingOrderId, orderId),
        eq(ticketItems.courseId, courseId),
        ne(ticketItems.state, "ready"),
        isNotNull(ticketItems.firedAt),
      ),
    );
}

/**
 * Dispatch ready items of a course by stamping away_at once. Require an existing
 * course in this venue, including deactivated courses with plated food remaining.
 * Items still cooking and items already away are unchanged.
 */
export async function markCourseAway(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  courseId: string,
): Promise<void> {
  await requireCourse(tx, cfg, courseId);
  await tx
    .update(ticketItems)
    .set({ awayAt: nowIso() })
    .where(
      and(
        eq(ticketItems.workingOrderId, orderId),
        eq(ticketItems.courseId, courseId),
        eq(ticketItems.state, "ready"),
        isNull(ticketItems.awayAt),
      ),
    );
}

/**
 * APPEND a priced round to an OPEN tab, locking each new line's gross unit price at add time, WITHOUT
 * deleting or re-pricing existing lines: a tab does not re-price.
 *
 * The `max(line_no)+1` read-then-insert cannot interleave with another append, because
 * `withTransaction` IS the venue file's write lock.
 */
export async function addTabRound(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lines: ({
    menuItemId: string;
    quantity: string;
    courseId?: string | null;
    extras?: ExtraSelection[];
    options?: OptionSelection[];
    hold?: boolean;
  } & LineExtras)[],
): Promise<void> {
  await assertAnchoredTabOpen(tx, cfg, tabId);
  if (lines.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }
  const [{ maxLineNo }] = await tx
    .select({ maxLineNo: sql<number>`cast(coalesce(max(${workingOrderLines.lineNo}), 0) as int)` })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId));
  const context = await VENUE_SERVICE.findOrderContext(tx, cfg, tabId);
  const { lineRows, lineContexts } = await priceOrderLines(tx, cfg, tabId, lines, context?.zoneId);
  const appended = lineRows.map((row, i) => ({ ...row, lineNo: maxLineNo + i + 1 }));
  const appendedLines = await tx.insert(workingOrderLines).values(appended).returning({
    id: workingOrderLines.id,
    productId: workingOrderLines.productId,
    courseId: workingOrderLines.courseId,
    parentLineId: workingOrderLines.parentLineId,
    note: workingOrderLines.note,
    lineNo: workingOrderLines.lineNo,
  });
  await VENUE_SERVICE.recordLineContexts(tx, cfg, tabId, lineContexts);
  // The k-th parent row by `line_no` is input line k. Correlated on `line_no`, not on the
  // `RETURNING` array position, so the mapping does not depend on the insert's row order.
  const holdByParentId = new Map<string, boolean>();
  appendedLines
    .filter((row) => row.parentLineId === null)
    .sort((a, b) => a.lineNo - b.lineNo)
    .forEach((row, k) => holdByParentId.set(row.id, lines[k]?.hold === true));
  const withHold = appendedLines.map((row) => ({
    ...row,
    hold: row.parentLineId === null ? (holdByParentId.get(row.id) ?? false) : false,
  }));
  await fireLines(tx, cfg, tabId, withHold);
}

/**
 * Void a not-yet-paid line, or `quantity` of it, from an OPEN tab: pre-fiscal, a plain delete or a
 * reduction. `quantity` absent, or equal to the line's own, voids the whole line; a smaller one
 * voids that part only, reducing the line, its extras children (which follow their dish) and its
 * ticket item's fired quantity. A line that had already fired records a VOID kitchen notice for what
 * was removed — marked started when the cook had started it — and gets a VOID correction slip where
 * its station has a printer.
 *
 * Voiding stays open with changes to sent items switched off: it is then the only correction.
 */
export async function voidTabLine(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lineNo: number,
  quantity?: string,
): Promise<void> {
  await assertAnchoredTabOpen(tx, cfg, tabId);
  // Read first, because the delete's cascade removes the ticket item too.
  const [target] = await tx
    .select({
      id: workingOrderLines.id,
      parentLineId: workingOrderLines.parentLineId,
      quantity: workingOrderLines.quantity,
      unitPriceGross: workingOrderLines.unitPriceGross,
      ticketItemId: ticketItems.id,
      firedAt: ticketItems.firedAt,
      stationId: ticketItems.stationId,
      state: ticketItems.state,
      firedQuantity,
    })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, lineNo)));
  if (target === undefined) {
    throw new AppError("tab.line_not_found", { tabId, lineNo });
  }
  const removed = quantity === undefined ? null : voidQuantity(quantity, target);
  const wasStarted = target.state === "preparing" || target.state === "ready";
  const voided =
    target.firedAt !== null
      ? [
          {
            workingOrderLineId: target.id,
            stationId: target.stationId!,
            // A whole void takes away everything the station was asked for.
            quantity: removed ?? target.firedQuantity,
            wasStarted,
          },
        ]
      : [];
  // Before the delete or the reduction: the notice and the slip re-read the line.
  await enqueueCorrectionSlips(tx, cfg, tabId, voided, "VOID");
  if (removed === null) {
    // Takes the line's child modifier lines in the same statement: the parent alone would be
    // refused by the self-referencing foreign key.
    await tx
      .delete(workingOrderLines)
      .where(
        and(
          eq(workingOrderLines.workingOrderId, tabId),
          or(eq(workingOrderLines.id, target.id), eq(workingOrderLines.parentLineId, target.id)),
        ),
      );
    return;
  }
  const lineQuantity = thousandthsToDecimal(target.quantity);
  const remaining = subtractDecimal(lineQuantity, thousandthsToDecimal(removed));
  await tx
    .update(workingOrderLines)
    .set({
      quantity: decimalToThousandths(remaining),
      lineTotal: decimalToCents(grossLineTotal(centsToDecimal(target.unitPriceGross), remaining)),
    })
    .where(eq(workingOrderLines.id, target.id));
  const children = await tx
    .select({
      id: workingOrderLines.id,
      quantity: workingOrderLines.quantity,
      unitPriceGross: workingOrderLines.unitPriceGross,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.parentLineId, target.id));
  for (const child of children) {
    const perDish = perDishOptionQuantity(thousandthsToDecimal(child.quantity), lineQuantity);
    const childQuantity = multiplyDecimal(remaining, decimal(String(perDish)));
    await tx
      .update(workingOrderLines)
      .set({
        quantity: decimalToThousandths(childQuantity),
        lineTotal: decimalToCents(
          grossLineTotal(centsToDecimal(child.unitPriceGross), childQuantity),
        ),
      })
      .where(eq(workingOrderLines.id, child.id));
  }
  if (target.ticketItemId !== null) {
    await tx
      .update(ticketItems)
      .set({ quantity: target.firedQuantity - removed })
      .where(eq(ticketItems.id, target.ticketItemId));
  }
}

/**
 * The part of a line a void removes, as thousandths, or `null` for the whole line. Refused
 * `management.request_invalid` unless it is a positive decimal no larger than the line, and for an
 * extras child, whose quantity follows its dish.
 */
function voidQuantity(
  quantity: string,
  line: { quantity: number; parentLineId: string | null },
): number | null {
  let asked: number;
  try {
    asked = stringToThousandths(quantity);
  } catch {
    throw new AppError("management.request_invalid", { field: "quantity" });
  }
  if (asked <= 0 || asked > line.quantity) {
    throw new AppError("management.request_invalid", { field: "quantity" });
  }
  if (asked === line.quantity) return null;
  if (line.parentLineId !== null) {
    throw new AppError("management.request_invalid", { field: "quantity" });
  }
  return asked;
}

/**
 * Move ONE not-yet-fired line of an OPEN tab into another kitchen course, or clear its course to null.
 * A deactivated course is not a valid new target. A line that has already FIRED is refused
 * `ticket.already_fired`: once the kitchen has been told to cook it, it is corrected by a recall,
 * never re-coursed underneath the pass.
 */
export async function setLineCourse(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lineNo: number,
  courseId: string | null,
): Promise<void> {
  await assertAnchoredTabOpen(tx, cfg, tabId);
  if (courseId !== null) {
    await requireLiveCourse(tx, cfg, courseId);
  }
  const [line] = await tx
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, lineNo)));
  if (line === undefined) {
    throw new AppError("tab.line_not_found", { tabId, lineNo });
  }
  const [item] = await tx
    .select({ firedAt: ticketItems.firedAt })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderLineId, line.id));
  if (item !== undefined && item.firedAt != null) {
    throw new AppError("ticket.already_fired", { workingOrderId: tabId });
  }
  await tx.update(workingOrderLines).set({ courseId }).where(eq(workingOrderLines.id, line.id));
  // The held ticket item's course snapshot too; no row when the line has no item yet.
  await tx.update(ticketItems).set({ courseId }).where(eq(ticketItems.workingOrderLineId, line.id));
}

/** Set or clear ONE line's `served_at` on an OPEN tab. Pre-fiscal: never read into a filed record. */
async function setLineServed(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lineNo: number,
  served: boolean,
): Promise<void> {
  await assertAnchoredTabOpen(tx, cfg, tabId);
  const updated = await tx
    .update(workingOrderLines)
    .set({ servedAt: served ? nowIso() : null })
    .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, lineNo)))
    .returning({ lineNo: workingOrderLines.lineNo });
  if (updated.length === 0) {
    throw new AppError("tab.line_not_found", { tabId, lineNo });
  }
}

/** Mark one line of an open tab as served. */
export async function markLineServed(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lineNo: number,
): Promise<void> {
  await setLineServed(tx, cfg, tabId, lineNo, true);
}

/** Clear ONE line's served marker on an OPEN tab, for a mis-tap. */
export async function unmarkLineServed(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lineNo: number,
): Promise<void> {
  await setLineServed(tx, cfg, tabId, lineNo, false);
}

/**
 * Lines pass between two orders only when both have the same service mode, or neither has a service
 * context.
 */
async function assertServiceModesMatch(
  tx: Transaction,
  cfg: TillConfig,
  fromOrderId: string,
  toOrderId: string,
): Promise<void> {
  const fromContext = await VENUE_SERVICE.findOrderContext(tx, cfg, fromOrderId);
  const toContext = await VENUE_SERVICE.findOrderContext(tx, cfg, toOrderId);
  if (
    (fromContext === null) !== (toContext === null) ||
    (fromContext !== null &&
      toContext !== null &&
      fromContext.serviceMode !== toContext.serviceMode)
  ) {
    throw new AppError("service_zone.mode_incompatible", {
      zoneId: toContext?.zoneId ?? "unscoped",
      expected: fromContext?.serviceMode ?? "unscoped",
      actual: toContext?.serviceMode ?? "unscoped",
    });
  }
}

/**
 * Move lines (default all) from one OPEN tab to another at the destination's next `line_no`s. A move
 * NEVER re-prices, and keeps each line's id, modifier links and any fired ticket.
 */
export async function moveTabLines(
  tx: Transaction,
  cfg: TillConfig,
  fromTabId: string,
  toTabId: string,
  lineNos?: number[],
): Promise<void> {
  await moveOrderLines(tx, cfg, fromTabId, toTabId, lineNos, { modesChecked: false });
}

/**
 * {@link moveTabLines}' body. `modesChecked: true` skips {@link assertServiceModesMatch}, and only a
 * caller whose two orders are already known to share a service mode — by that check, or by
 * construction as `splitOffCheck`'s `copyOrderContext` does — may pass it.
 */
async function moveOrderLines(
  tx: Transaction,
  cfg: TillConfig,
  fromTabId: string,
  toTabId: string,
  lineNos: number[] | undefined,
  options: { modesChecked: boolean },
): Promise<void> {
  // A self-transfer would allocate line numbers that collide with the rows being moved.
  if (fromTabId === toTabId) {
    throw new AppError("tab.merge_self", { tabId: fromTabId });
  }
  const both = await tx
    .select({ id: workingOrders.id, status: workingOrders.status })
    .from(workingOrders)
    .where(or(eq(workingOrders.id, fromTabId), eq(workingOrders.id, toTabId)));
  const from = both.find((r) => r.id === fromTabId);
  const to = both.find((r) => r.id === toTabId);
  if (from === undefined || from.status !== "open") {
    throw new AppError("tab.not_open", { tabId: fromTabId });
  }
  if (to === undefined || to.status !== "open") {
    throw new AppError("tab.not_open", { tabId: toTabId });
  }
  if (!options.modesChecked) {
    await assertServiceModesMatch(tx, cfg, fromTabId, toTabId);
  }

  const sourceWhere =
    lineNos === undefined
      ? eq(workingOrderLines.workingOrderId, fromTabId)
      : and(
          eq(workingOrderLines.workingOrderId, fromTabId),
          inArray(workingOrderLines.lineNo, lineNos),
        );

  const source = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
    })
    .from(workingOrderLines)
    .where(sourceWhere)
    .orderBy(workingOrderLines.lineNo);

  const [agg] = await tx
    .select({ next: sql<number>`cast(coalesce(max(${workingOrderLines.lineNo}), 0) as int)` })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, toTabId));
  const base = agg!.next;

  // Moved in place so every row keyed on the line id survives. Destination numbers start beyond its
  // current maximum, so no update collides on `(working_order_id, line_no)`.
  for (let index = 0; index < source.length; index++) {
    const line = source[index]!;
    await tx
      .update(workingOrderLines)
      .set({ workingOrderId: toTabId, lineNo: base + index + 1 })
      .where(
        and(eq(workingOrderLines.workingOrderId, fromTabId), eq(workingOrderLines.id, line.id)),
      );
  }
  if (source.length > 0) {
    await tx
      .update(ticketItems)
      .set({ workingOrderId: toTabId })
      .where(
        inArray(
          ticketItems.workingOrderLineId,
          source.map((line) => line.id),
        ),
      );
  }
}

/**
 * Assert a working order is OPEN, else `tab.not_open`. Deliberately NOT {@link assertAnchoredTabOpen}:
 * `moveTab`, `joinTable` and `unjoinTable` work on orders whose table back-pointer is what they are
 * about to change.
 */
async function assertTabOpen(tx: Transaction, cfg: TillConfig, tabId: string): Promise<void> {
  void cfg;
  const [tab] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, tabId));
  if (tab === undefined || tab.status !== "open") {
    throw new AppError("tab.not_open", { tabId });
  }
}

/** One line of an OPEN tab. `unitPriceGross` is the gross unit price LOCKED at add time, NOT a
 *  re-price. */
export interface TabLine {
  /** The STAFF name (the variant's on a variant line): a waiter reads this list, not a diner. */
  name: string;
  /** The dish's frozen options answers; empty on a line that answered none and on every child. */
  optionSnapshots?: OptionSnapshot[];
  lineNo: number;
  // Nullable because the column is; a CHILD row carries the picked extra product.
  productId: string | null;
  /** The PARENT dish's `lineNo` on a CHILD extras line, else null: the one field on this wire that
   * tells the two apart. */
  parentLineNo: number | null;
  quantity: string;
  /** Decimal places the line's unit takes, frozen at add time (0 = sold by the unit). */
  unitPrecision: number | null;
  unitPriceGross: string;
  servedAt: string | null;
  courseId: string | null;
  /** Null when the line is HELD or has no ticket item at all, which a parent line can lack too:
   * `openTab` inserts its initial lines without firing them. */
  firedAt: string | null;
  /** Null when the line has no ticket item (always, on a child). */
  state: TicketState | null;
}

/** Read an open tab's lines in line-number order, at their stored prices: no re-price. */
export async function readTabLines(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
): Promise<TabLine[]> {
  await assertTabOpen(tx, cfg, tabId);
  // `ticket_items` is unique per line, so the join never multiplies rows.
  const rows = await tx
    .select({
      lineNo: workingOrderLines.lineNo,
      name: workingOrderLines.name,
      variantName: workingOrderLines.variantName,
      optionSnapshots: workingOrderLines.optionSnapshots,
      productId: workingOrderLines.productId,
      id: workingOrderLines.id,
      parentLineId: workingOrderLines.parentLineId,
      quantity: workingOrderLines.quantity,
      unitPrecision: workingOrderLines.unitPrecision,
      unitPriceGross: workingOrderLines.unitPriceGross,
      servedAt: workingOrderLines.servedAt,
      courseId: workingOrderLines.courseId,
      firedAt: ticketItems.firedAt,
      state: ticketItems.state,
    })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);
  // The stored `line_no` is what this read returns, so, unlike `readLockedLines`, no renumbering.
  const lineNoById = new Map(rows.map((row) => [row.id, row.lineNo]));
  return rows.map((row) => ({
    lineNo: row.lineNo,
    name: staffPresentationName({ name: row.name, variantName: row.variantName }),
    optionSnapshots: row.optionSnapshots,
    productId: row.productId,
    parentLineNo: row.parentLineId === null ? null : (lineNoById.get(row.parentLineId) ?? null),
    quantity: thousandthsToDecimal(row.quantity),
    unitPrecision: row.unitPrecision,
    unitPriceGross: centsToDecimal(row.unitPriceGross),
    servedAt: row.servedAt,
    courseId: row.courseId,
    firedAt: row.firedAt,
    state: row.state,
  }));
}

/**
 * Assert a move/join TARGET table exists, is `active`, and is FREE: its `tab_id` is null or a stale
 * pointer at a settled or abandoned order.
 */
async function assertTableAvailable(
  tx: Transaction,
  cfg: TillConfig,
  table: { tabId: string | null; active: boolean } | undefined,
  tableId: string,
): Promise<void> {
  void cfg;
  if (table === undefined) {
    throw new AppError("table.not_found", { tableId });
  }
  if (!table.active) {
    throw new AppError("table.inactive", { tableId });
  }
  if (table.tabId !== null) {
    const [pointed] = await tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(and(eq(workingOrders.id, table.tabId), eq(workingOrders.status, "open")));
    if (pointed !== undefined) {
      throw new AppError("table.occupied", { tableId });
    }
  }
}

/** Free every table covered by `tabId`. A turnover: the manual status must not linger onto the next
 * party. */
async function freeTablesCoveredBy(tx: Transaction, cfg: TillConfig, tabId: string): Promise<void> {
  void cfg;
  await tx
    .update(diningTables)
    .set({ tabId: null, statusId: null })
    .where(eq(diningTables.tabId, tabId));
}

/**
 * Relocate a party to a free table: no line moves, no fiscal effect. Both tables are turned over, and
 * the clears are explicit because the settle trigger does not fire on a move (the tab stays open).
 */
export async function moveTab(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  toTableId: string,
): Promise<void> {
  await assertTabOpen(tx, cfg, tabId);

  const involved = await tx
    .select({
      id: diningTables.id,
      tabId: diningTables.tabId,
      active: diningTables.active,
      zoneId: diningTables.zoneId,
    })
    .from(diningTables)
    .where(or(eq(diningTables.id, toTableId), eq(diningTables.tabId, tabId)));
  await assertTableAvailable(
    tx,
    cfg,
    involved.find((t) => t.id === toTableId),
    toTableId,
  );

  const target = involved.find((table) => table.id === toTableId)!;
  const serviceContext = await VENUE_SERVICE.findOrderContext(tx, cfg, tabId);
  if (serviceContext !== null && target.zoneId !== null) {
    await VENUE_SERVICE.retargetOrderContext(tx, cfg, tabId, target.zoneId);
  }

  await freeTablesCoveredBy(tx, cfg, tabId);
  await tx
    .update(diningTables)
    .set({ tabId, statusId: null })
    .where(eq(diningTables.id, toTableId));
}

/** Join an active, free table to an open tab. The existing tab lines remain in place. */
export async function joinTable(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  tableId: string,
): Promise<void> {
  await assertTabOpen(tx, cfg, tabId);

  const [table] = await tx
    .select({
      id: diningTables.id,
      tabId: diningTables.tabId,
      active: diningTables.active,
      zoneId: diningTables.zoneId,
    })
    .from(diningTables)
    .where(eq(diningTables.id, tableId));
  await assertTableAvailable(tx, cfg, table, tableId);

  const serviceContext = await VENUE_SERVICE.findOrderContext(tx, cfg, tabId);
  if (
    serviceContext !== null &&
    table?.zoneId !== null &&
    table?.zoneId !== undefined &&
    table.zoneId !== serviceContext.zoneId
  ) {
    throw new AppError("service_zone.join_mismatch", {
      orderZoneId: serviceContext.zoneId,
      tableZoneId: table.zoneId,
    });
  }

  await tx.update(diningTables).set({ tabId }).where(eq(diningTables.id, tableId));
}

/**
 * Combine two tabs onto one bill: move ALL of `fromTab`'s lines onto `intoTab`, re-point `fromTab`'s
 * tables, and abandon the now-empty `fromTab`, which files nothing.
 *
 * `freeSourceTable = true` frees the source table (it turns over); `false` re-points it at `intoTab`,
 * and the joined table KEEPS its status.
 *
 * ORDER MATTERS: the re-point precedes the abandon. The `working_orders_clear_table_status` trigger
 * clears the status of tables pointing at an abandoned order, so abandoning first would clear it on a
 * table that stays joined.
 */
export async function mergeTabs(
  tx: Transaction,
  cfg: TillConfig,
  intoTabId: string,
  fromTabId: string,
  options: { freeSourceTable: boolean },
): Promise<void> {
  if (intoTabId === fromTabId) {
    throw new AppError("tab.merge_self", { tabId: intoTabId });
  }

  // Both orders in one read; each must be open.
  const tabs = await tx
    .select({ id: workingOrders.id, status: workingOrders.status })
    .from(workingOrders)
    .where(or(eq(workingOrders.id, intoTabId), eq(workingOrders.id, fromTabId)));
  const into = tabs.find((t) => t.id === intoTabId);
  const from = tabs.find((t) => t.id === fromTabId);
  if (into === undefined || into.status !== "open") {
    throw new AppError("tab.not_open", { tabId: intoTabId });
  }
  if (from === undefined || from.status !== "open") {
    throw new AppError("tab.not_open", { tabId: fromTabId });
  }
  await moveTabLines(tx, cfg, fromTabId, intoTabId);

  // Before the abandon (see the docstring).
  if (options.freeSourceTable) {
    await freeTablesCoveredBy(tx, cfg, fromTabId);
  } else {
    await tx
      .update(diningTables)
      .set({ tabId: intoTabId })
      .where(eq(diningTables.tabId, fromTabId));
  }

  await tx
    .update(workingOrders)
    .set({ status: "abandoned" })
    .where(eq(workingOrders.id, fromTabId));
}

/**
 * The same composition `priceRows` uses for a line's gross total, so a split line's `line_total` is
 * identical to an add-time line's.
 */
function grossLineTotal(grossUnit: string, quantity: string): Decimal {
  return toScale(multiplyDecimal(decimal(grossUnit), decimal(quantity)), MONEY_SCALE);
}

/**
 * Refuse a batch naming the same source `line_no` twice: each entry is validated against the line's
 * pre-batch quantity and the split sets the source to `original − q`, so two partial "1"s off a line
 * of 3 would add 2 to the destination while the source dropped by 1.
 */
function assertDistinctTransferLines(tabId: string, transfers: { lineNo: number }[]): void {
  const seenLineNos = new Set<number>();
  for (const { lineNo } of transfers) {
    if (seenLineNos.has(lineNo)) {
      throw new AppError("tab.transfer_duplicate_line", { tabId, lineNo });
    }
    seenLineNos.add(lineNo);
  }
}

/**
 * Transfer selected lines between two open tabs. Whole-line transfers move the line; partial transfers
 * keep its stored unit prices and divide its quantity. The whole batch is validated before any move.
 */
export async function transferLines(
  tx: Transaction,
  cfg: TillConfig,
  fromTabId: string,
  toTabId: string,
  transfers: { lineNo: number; quantity?: string }[],
): Promise<void> {
  if (fromTabId === toTabId) {
    throw new AppError("tab.transfer_self", { tabId: fromTabId });
  }

  assertDistinctTransferLines(fromTabId, transfers);

  // Sorted only so that, when both ends fail, the refusal names the lower id.
  for (const tabId of [fromTabId, toTabId].sort()) {
    await assertAnchoredTabOpen(tx, cfg, tabId);
  }
  // The only mode check on this path: `carveOffLines` makes none, whole lines or split.
  await assertServiceModesMatch(tx, cfg, fromTabId, toTabId);

  await carveOffLines(tx, cfg, fromTabId, toTabId, transfers);
}

/**
 * Carry whole lines and partial splits between two orders, keeping each unit's LOCKED prices and
 * CONSERVING quantity. It makes no open-order check and no service-mode check of its own: the
 * CALLER must already have made both. Every transfer is validated before anything moves.
 */
async function carveOffLines(
  tx: Transaction,
  cfg: TillConfig,
  fromTabId: string,
  toTabId: string,
  transfers: { lineNo: number; quantity?: string }[],
): Promise<void> {
  // Every line, not only the named ones: which dishes carry modifiers needs the whole tab.
  const sourceRows = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      productId: workingOrderLines.productId,
      name: workingOrderLines.name,
      descriptions: workingOrderLines.descriptions,
      optionSnapshots: workingOrderLines.optionSnapshots,
      quantity: workingOrderLines.quantity,
      unitPrice: workingOrderLines.unitPrice,
      unitPriceGross: workingOrderLines.unitPriceGross,
      vatRate: workingOrderLines.vatRate,
      category: workingOrderLines.category,
      unitName: workingOrderLines.unitName,
      unitPrecision: workingOrderLines.unitPrecision,
      variantName: workingOrderLines.variantName,
      variantDescriptions: workingOrderLines.variantDescriptions,
      variantKitchenName: workingOrderLines.variantKitchenName,
      kitchenName: workingOrderLines.kitchenName,
      sentAt: workingOrderLines.sentAt,
      servedAt: workingOrderLines.servedAt,
      courseId: workingOrderLines.courseId,
      note: workingOrderLines.note,
      extraListId: workingOrderLines.extraListId,
      ticketItemId: ticketItems.id,
      ticketState: ticketItems.state,
    })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(eq(workingOrderLines.workingOrderId, fromTabId))
    .orderBy(workingOrderLines.lineNo);
  const sourceLines = sourceRows.map((l) => ({
    ...l,
    quantity: thousandthsToDecimal(l.quantity),
    unitPrice: centsToDecimal(l.unitPrice),
    unitPriceGross: centsToDecimal(l.unitPriceGross),
    vatRate: basisPointsToDecimal(l.vatRate),
  }));
  const byLineNo = new Map(sourceLines.map((l) => [l.lineNo, l]));
  const lineNoById = new Map(sourceLines.map((l) => [l.id, l.lineNo]));
  const childLineNosByParent = new Map<number, number[]>();
  for (const l of sourceLines) {
    if (l.parentLineId == null) {
      continue;
    }
    const parentLineNo = lineNoById.get(l.parentLineId);
    if (parentLineNo === undefined) {
      continue;
    }
    const siblings = childLineNosByParent.get(parentLineNo) ?? [];
    siblings.push(l.lineNo);
    childLineNosByParent.set(parentLineNo, siblings);
  }

  // A quantity equal to the line's own is a whole-line move: a split would leave a zero-quantity
  // source, which `working_order_lines_quantity_ck` refuses.
  const wholeLineNos: number[] = [];
  const partials: { line: (typeof sourceLines)[number]; quantity: string }[] = [];
  for (const t of transfers) {
    const line = byLineNo.get(t.lineNo);
    if (line === undefined) {
      throw new AppError("tab.line_not_found", { tabId: fromTabId, lineNo: t.lineNo });
    }
    // A modifier CHILD transfers only WITH its dish.
    if (line.parentLineId != null) {
      throw new AppError("tab.transfer_modifier_line", { tabId: fromTabId, lineNo: t.lineNo });
    }
    const childLineNos = childLineNosByParent.get(t.lineNo) ?? [];
    if (t.quantity === undefined) {
      wholeLineNos.push(t.lineNo, ...childLineNos);
      continue;
    }
    // A malformed literal is reported as the same domain code as an out-of-range one.
    let inRange: boolean;
    try {
      const q = decimal(t.quantity);
      inRange =
        compareDecimal(q, decimal("0")) > 0 && compareDecimal(q, decimal(line.quantity)) <= 0;
    } catch {
      inRange = false;
    }
    if (!inRange) {
      throw new AppError("tab.transfer_quantity_invalid", {
        tabId: fromTabId,
        lineNo: t.lineNo,
        quantity: t.quantity,
      });
    }
    if (compareDecimal(decimal(t.quantity), decimal(line.quantity)) === 0) {
      wholeLineNos.push(t.lineNo, ...childLineNos);
    } else {
      // A partial split of a dish with modifiers is refused: the children's quantities would no longer
      // follow the dish's.
      if (childLineNos.length > 0) {
        throw new AppError("tab.transfer_modifier_line", { tabId: fromTabId, lineNo: t.lineNo });
      }
      // The split row gets no ticket item of its own, so nothing would guard it while the cook
      // works on the source's.
      if (line.ticketState === "preparing" || line.ticketState === "ready") {
        throw new AppError("ticket.already_started", { ticketItemId: line.ticketItemId! });
      }
      partials.push({ line, quantity: t.quantity });
    }
  }

  if (wholeLineNos.length > 0) {
    await moveOrderLines(tx, cfg, fromTabId, toTabId, wholeLineNos, { modesChecked: true });
  }

  // Split line numbers are allocated after the moves, so they do not collide with moved rows.
  if (partials.length > 0) {
    const [{ maxLineNo }] = await tx
      .select({
        maxLineNo: sql<number>`cast(coalesce(max(${workingOrderLines.lineNo}), 0) as int)`,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, toTabId));
    for (let i = 0; i < partials.length; i++) {
      const { line, quantity } = partials[i]!;
      const remaining = subtractDecimal(decimal(line.quantity), decimal(quantity));
      await tx
        .update(workingOrderLines)
        .set({
          quantity: decimalToThousandths(remaining),
          lineTotal: decimalToCents(grossLineTotal(line.unitPriceGross, remaining)),
        })
        .where(
          and(
            eq(workingOrderLines.workingOrderId, fromTabId),
            eq(workingOrderLines.lineNo, line.lineNo),
          ),
        );
      const splitLineId = randomUUID();
      await tx.insert(workingOrderLines).values({
        id: splitLineId,
        workingOrderId: toTabId,
        lineNo: maxLineNo! + i + 1,
        productId: line.productId,
        // No `parent_line_id`: only a top-level line with no children can be split.
        name: line.name,
        descriptions: line.descriptions,
        optionSnapshots: line.optionSnapshots ?? [],
        quantity: stringToThousandths(quantity),
        unitPrice: decimalToCents(line.unitPrice),
        unitPriceGross: decimalToCents(line.unitPriceGross),
        vatRate: decimalToBasisPoints(line.vatRate),
        lineTotal: decimalToCents(grossLineTotal(line.unitPriceGross, quantity)),
        category: line.category,
        unitName: line.unitName,
        unitPrecision: line.unitPrecision,
        variantName: line.variantName,
        variantDescriptions: line.variantDescriptions,
        variantKitchenName: line.variantKitchenName,
        kitchenName: line.kitchenName,
        // The ticket item stays with the source line at the quantity fired, so the kitchen still
        // makes the whole; the split row carries the facts that decide what it may be.
        sentAt: line.sentAt,
        servedAt: line.servedAt,
        courseId: line.courseId,
        note: line.note,
        extraListId: line.extraListId,
      });
      await VENUE_SERVICE.copyLineContext(tx, cfg, line.id, splitLineId);
    }
  }
}

/**
 * Spin selected items off an OPEN tab into a NEW, separately-filing CHECK: an ordinary `open` working
 * order that NO table points at, because it is a payment unit, not a seat. Being table-less, it is
 * filled by {@link carveOffLines} directly, not `transferLines`, which requires both ends to be tabs.
 */
export async function splitOffCheck(
  tx: Transaction,
  cfg: TillConfig,
  fromTabId: string,
  transfers: { lineNo: number; quantity?: string }[],
): Promise<{ checkId: string }> {
  // Without this an empty batch would succeed and leave an empty check behind.
  if (transfers.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }

  assertDistinctTransferLines(fromTabId, transfers);

  // The origin must be a TAB: a detached check minted by an earlier split is not a split origin.
  await assertAnchoredTabOpen(tx, cfg, fromTabId);

  const { orderLabel } = await readReceiptOrder(tx, cfg, fromTabId);
  const checkId = randomUUID();
  await createOpenOrder(tx, cfg, checkId, [], orderLabel);
  // The check takes the origin's service mode (or, like it, has none), so `carveOffLines` needs no
  // mode check on this path.
  await VENUE_SERVICE.copyOrderContext(tx, cfg, fromTabId, checkId);

  await carveOffLines(tx, cfg, fromTabId, checkId, transfers);

  return { checkId };
}

/**
 * Detach a table from a joined tab. WITH items, the table keeps its OWN bill: a new tab ANCHORED to
 * it, since it is still a seat, not a payment unit. WITHOUT items, the table is freed and turned over.
 */
export async function unjoinTable(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  tableId: string,
  transfers?: { lineNo: number; quantity?: string }[],
): Promise<{ tabId?: string }> {
  // Checked before the table, so a call wrong about both is refused `tab.not_open`.
  await assertTabOpen(tx, cfg, tabId);

  const [table] = await tx
    .select({ tabId: diningTables.tabId, zoneId: diningTables.zoneId })
    .from(diningTables)
    .where(eq(diningTables.id, tableId));
  if (table?.tabId !== tabId) {
    throw new AppError("table.not_joined", { tableId, tabId });
  }

  if (transfers === undefined || transfers.length === 0) {
    await tx
      .update(diningTables)
      .set({ tabId: null, statusId: null })
      .where(eq(diningTables.id, tableId));
    return {};
  }

  // If this is the SOLE table anchoring `tabId`, the repoint below would leave `tabId` anchorless and
  // `transferLines` would refuse it with a misleading `tab.not_open`.
  const [otherAnchor] = await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .where(and(eq(diningTables.tabId, tabId), ne(diningTables.id, tableId)))
    .limit(1);
  if (otherAnchor === undefined) {
    throw new AppError("table.not_shared", { tableId, tabId });
  }

  // Repointed before the move, so `newTabId` is a tab when `transferLines` checks it.
  const newTabId = randomUUID();
  await createOpenOrder(tx, cfg, newTabId, [], null);
  await VENUE_SERVICE.copyOrderContext(tx, cfg, tabId, newTabId);
  if (table.zoneId !== null && (await VENUE_SERVICE.findOrderContext(tx, cfg, newTabId)) !== null) {
    await VENUE_SERVICE.retargetOrderContext(tx, cfg, newTabId, table.zoneId);
  }
  await tx.update(diningTables).set({ tabId: newTabId }).where(eq(diningTables.id, tableId));
  await transferLines(tx, cfg, tabId, newTabId, transfers);
  return { tabId: newTabId };
}

/** One row of the held-orders list the counter shows to retrieve a parked order. */
export interface HeldOrderSummary {
  id: string;
  orderNumber: number;
  /** The operator-supplied label ("Mesa 4"), or null when the order was parked without one. */
  label: string | null;
  /** Number of lines on the order, 0 for a lineless order. */
  itemCount: number;
  /** The GROSS total the operator saw; the filed `sale_lines.line_total` is net. */
  total: string;
  openedAt: string;
}

/** A retrieved order with the stored commercial snapshot needed to rebuild its basket. */
export interface HeldOrder {
  id: string;
  orderNumber: number;
  label: string | null;
  /**
   * PARENT rows only, each dish's child lines nested as `extras`. A row carries its stored offer and
   * display snapshot, so retrieval does not depend on the offer still being active; a row with no
   * stored offer is returned by its product alone.
   */
  lines: {
    /** The dish's frozen options answers: names, no ids. */
    optionSnapshots?: OptionSnapshot[];
    workingOrderLineId?: string;
    menuItemId?: string;
    /** The dish: on a line sold as a variant, the variant's parent. */
    productId: string | null;
    /** The variant the line was sold as, absent when it names none. */
    variantId?: string;
    quantity: string;
    /** One entry per CHILD line: frozen VALUES, not a re-sendable selection (a child holds no list
     * id). */
    extras?: {
      productId: string | null;
      name: string;
      descriptions: Record<string, string>;
      kitchenName: string | null;
      price: string;
      quantity: number;
    }[];
    note?: string;
    product?: {
      id: string;
      productId: string;
      menuItemId: string;
      variantId?: string;
      /** The staff name frozen at add time. */
      name: string;
      /** The line's frozen customer-facing text, locale -> text. */
      customerName: Record<string, string>;
      /** Kept apart from the product's names, so the retrieving surface picks the one it shows. */
      variantName?: string;
      variantCustomerName?: Record<string, string> | null;
      variantKitchenName?: string | null;
      unit: {
        id: string;
        name: Readonly<Record<string, string>>;
        precision: number;
        hardwareUnit: "kg" | "g" | "mg" | null;
      };
      unitPrice: string;
      vatClass: "general" | "reduced" | "super_reduced" | "zero";
      category: string | null;
      allergens: Readonly<
        Record<string, { readonly presence: "contains" | "may_contain"; readonly source?: string }>
      > | null;
      courseId: string | null;
      catalogueId: string;
      catalogueName: string;
      diet: unknown;
      dietDerivation: unknown;
      dietOverride: unknown;
    };
  }[];
}

/** List the venue's open parked orders, lineless ones included. */
export async function listHeldOrders(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
): Promise<HeldOrderSummary[]> {
  void cfg;
  return withTransaction(deps.db, async (tx) => {
    const rows = await tx
      .select({
        id: workingOrders.id,
        orderNumber: workingOrders.orderNumber,
        label: workingOrders.label,
        itemCount: sql<number>`cast(count(${workingOrderLines.id}) as int)`,
        // Cast to text for `rawCentsToDecimal`; see its doc comment.
        total: sql<string>`cast(coalesce(sum(${workingOrderLines.lineTotal}), 0) as text)`,
        openedAt: workingOrders.openedAt,
      })
      .from(workingOrders)
      .leftJoin(workingOrderLines, eq(workingOrderLines.workingOrderId, workingOrders.id))
      // Venue-wide: `node_id` records the writer and is never filtered on here.
      .where(eq(workingOrders.status, "open"))
      .groupBy(
        workingOrders.id,
        workingOrders.orderNumber,
        workingOrders.label,
        workingOrders.openedAt,
      )
      .orderBy(workingOrders.orderNumber);
    return rows.map((row) => ({ ...row, total: rawCentsToDecimal(row.total) }));
  });
}

/** Read an open parked order anywhere in the venue, with the snapshots the till rebuilds its basket
 * from even when an offer has since been deactivated. */
export async function getHeldOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
): Promise<HeldOrder> {
  return withTransaction(deps.db, async (tx) => {
    const [order] = await tx
      .select({
        id: workingOrders.id,
        orderNumber: workingOrders.orderNumber,
        label: workingOrders.label,
      })
      .from(workingOrders)
      .where(and(eq(workingOrders.id, id), eq(workingOrders.status, "open")));

    if (order === undefined) {
      throw new AppError("working_order.not_found", { workingOrderId: id });
    }

    const storedLines = await tx
      .select({
        id: workingOrderLines.id,
        productId: workingOrderLines.productId,
        quantity: workingOrderLines.quantity,
        descriptions: workingOrderLines.descriptions,
        variantDescriptions: workingOrderLines.variantDescriptions,
        optionSnapshots: workingOrderLines.optionSnapshots,
        unitPriceGross: workingOrderLines.unitPriceGross,
        courseId: workingOrderLines.courseId,
        parentLineId: workingOrderLines.parentLineId,
        note: workingOrderLines.note,
        // A line sold as a variant names the variant as its product; the dish the till rebuilds is
        // its parent, with the variant chosen on it, as the till built it at add time.
        parentProductId: products.parentId,
        variantName: workingOrderLines.variantName,
        variantKitchenName: workingOrderLines.variantKitchenName,
        kitchenName: workingOrderLines.kitchenName,
        name: workingOrderLines.name,
      })
      .from(workingOrderLines)
      .leftJoin(products, eq(products.id, workingOrderLines.productId))
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    const lineRows = storedLines.map(({ parentProductId, ...line }) => {
      // A child line's product is the pick itself, a variant or not, and is kept as it is.
      const variantId =
        line.parentLineId === null && parentProductId !== null ? line.productId : null;
      return {
        ...line,
        productId: variantId === null ? line.productId : parentProductId,
        variantId,
        quantity: thousandthsToDecimal(line.quantity),
        unitPriceGross: centsToDecimal(line.unitPriceGross),
      };
    });

    const contextByLine = new Map(
      (await VENUE_SERVICE.listLineContexts(tx, cfg, id)).map((line) => [
        line.workingOrderLineId,
        line,
      ]),
    );
    const childrenByParent = new Map<string, typeof lineRows>();
    for (const line of lineRows) {
      if (line.parentLineId === null) continue;
      const children = childrenByParent.get(line.parentLineId) ?? [];
      children.push(line);
      childrenByParent.set(line.parentLineId, children);
    }
    const lines = lineRows
      .filter((line) => line.parentLineId === null)
      .map((line) => {
        const context = contextByLine.get(line.id);
        if (context === undefined || line.productId === null) {
          return {
            productId: line.productId,
            quantity: line.quantity,
            optionSnapshots: line.optionSnapshots,
            ...(line.optionSnapshots.length ? { workingOrderLineId: line.id } : {}),
          };
        }
        // A child's stored quantity is dish quantity × pick count.
        const extras = (childrenByParent.get(line.id) ?? []).map((child) => ({
          productId: child.productId,
          name: child.name,
          descriptions: child.descriptions,
          kitchenName: child.kitchenName,
          price: child.unitPriceGross,
          quantity: Number(child.quantity) / Number(line.quantity),
        }));
        return {
          workingOrderLineId: line.id,
          optionSnapshots: line.optionSnapshots,
          menuItemId: context.menuItemId,
          productId: line.productId,
          quantity: line.quantity,
          ...(extras.length === 0 ? {} : { extras }),
          ...(line.note === null ? {} : { note: line.note }),
          ...(line.variantId === null ? {} : { variantId: line.variantId }),
          product: {
            id: line.productId,
            productId: line.productId,
            menuItemId: context.menuItemId,
            name: line.name,
            customerName: line.descriptions,
            ...(line.variantId === null ? {} : { variantId: line.variantId }),
            ...(line.variantName === null ? {} : { variantName: line.variantName }),
            variantCustomerName: line.variantDescriptions,
            variantKitchenName: line.variantKitchenName,
            kitchenName: line.kitchenName,
            unit: {
              id: context.unitId,
              name: context.unitName,
              precision: context.unitPrecision,
              hardwareUnit: context.hardwareUnit,
            },
            unitPrice: line.unitPriceGross,
            vatClass: context.vatClass as "general" | "reduced" | "super_reduced" | "zero",
            category: context.categoryName,
            allergens: context.allergens,
            courseId: line.courseId,
            catalogueId: context.menuId,
            catalogueName: context.menuName,
            diet: context.diet,
            dietDerivation: context.dietDerivation,
            dietOverride: context.dietOverride,
          },
        };
      });

    return { id: order.id, orderNumber: order.orderNumber, label: order.label, lines };
  });
}

/**
 * The complete edited basket and an optional label. Prices come from stored lines for quantity-only
 * edits and from current definitions when selections change; the request never supplies a price.
 */
export interface UpdateHeldOrderRequest {
  lines: ({
    workingOrderLineId?: string;
    menuItemId: string;
    quantity: string;
    extras?: ExtraSelection[];
    options?: OptionSelection[];
  } & LineExtras)[];
  label?: string;
}

/** Update an open held order anywhere in the venue, preserving stored prices for quantity-only edits. */
export async function updateHeldOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
  req: UpdateHeldOrderRequest,
): Promise<void> {
  return withTransaction(deps.db, async (tx) => {
    const [order] = await tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));

    if (order === undefined || order.status !== "open") {
      throw new AppError("working_order.not_open", { workingOrderId: id });
    }

    // Rewriting an order to zero lines is a discard, which is `abandonHeldOrder`'s job.
    if (req.lines.length === 0) {
      throw new AppError("sale.empty_basket", {});
    }

    // A quantity-only edit keeps each line's locked price and stable id. Anything else takes the
    // replacement path below and is priced from the current offer.
    const storedLineRows = await tx
      .select({
        id: workingOrderLines.id,
        optionSnapshots: workingOrderLines.optionSnapshots,
        parentLineId: workingOrderLines.parentLineId,
        productId: workingOrderLines.productId,
        // Set on a variant line: the dish is then the parent, which holds the lists a variant offers.
        parentProductId: products.parentId,
        unitPriceGross: workingOrderLines.unitPriceGross,
        quantity: workingOrderLines.quantity,
        note: workingOrderLines.note,
        extraListId: workingOrderLines.extraListId,
      })
      .from(workingOrderLines)
      .leftJoin(products, eq(products.id, workingOrderLines.productId))
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    const storedRows = storedLineRows.map((line) => ({
      ...line,
      quantity: thousandthsToDecimal(line.quantity),
      unitPriceGross: centsToDecimal(line.unitPriceGross),
    }));
    type StoredLine = (typeof storedRows)[number];
    const storedParents = storedRows.filter((line) => line.parentLineId === null);
    const childrenByParent = new Map<string, typeof storedRows>();
    for (const row of storedRows) {
      if (row.parentLineId === null) continue;
      const children = childrenByParent.get(row.parentLineId) ?? [];
      children.push(row);
      childrenByParent.set(row.parentLineId, children);
    }
    const contextByLine = new Map(
      (await VENUE_SERVICE.listLineContexts(tx, cfg, id)).map((line) => [
        line.workingOrderLineId,
        line,
      ]),
    );

    /**
     * The stored parent a requested line would keep, or `null` when it is not the same line. These
     * checks need no read, so an edit failing one skips the catalogue reads the answers comparison
     * needs. `productId` in the result is the DISH.
     */
    const sameLines = req.lines.map((line, index) => {
      const stored = storedParents[index];
      const soldId = stored?.productId;
      if (
        stored === undefined ||
        soldId === null ||
        soldId === undefined ||
        line.workingOrderLineId !== stored.id ||
        (line.note?.trim() ?? null) !== stored.note
      ) {
        return null;
      }
      const productId = stored.parentProductId ?? soldId;
      const { menuItemId } = line;
      // An offer line sells the variant it names, else the offer's own product. A line naming a
      // product goes to the replacement path, which refuses it.
      const sameIdentity =
        contextByLine.get(stored.id)?.menuItemId === menuItemId &&
        !Object.hasOwn(line, "productId") &&
        (line.variantId ?? productId) === soldId;
      return menuItemId !== undefined && sameIdentity ? { stored, productId, menuItemId } : null;
    });
    const sameBasket =
      req.lines.length === storedParents.length && sameLines.every((entry) => entry !== null);

    /**
     * What a requested line would freeze if re-priced now, or `null` when its answers differ from the
     * stored ones. An invalid selection answers `null` too: the replacement path re-validates it and
     * raises the refusal, so nothing is swallowed.
     */
    let rebuilt: ({
      stored: StoredLine;
      paired: { pick: ExtraChild; child: StoredLine }[];
    } | null)[] = [];
    if (sameBasket) {
      const contentConfig = await readContentLanguages(tx, cfg.locale);
      const modifiers = await resolveBasketModifiers(
        tx,
        sameLines.flatMap((entry) =>
          entry === null ? [] : [{ productId: entry.productId, menuItemId: entry.menuItemId }],
        ),
        contentConfig.defaultLanguage,
        false,
      );
      rebuilt = req.lines.map((line, index) => {
        const entry = sameLines[index];
        if (entry === null || entry === undefined) return null;
        const { stored, productId, menuItemId } = entry;
        let frozen;
        try {
          frozen = buildLineExtras(
            {
              extras: modifiers.extrasByHolder.get(menuItemId) ?? [],
              options: modifiers.optionsByProduct.get(productId) ?? [],
            },
            modifiers.extraProducts,
            { extras: line.extras, options: line.options },
            contentConfig.defaultLanguage,
          );
        } catch {
          return null;
        }
        // Compared by VALUES and never by either side's order: both sides are built in the OFFERED
        // order, and that order is a stored position several columns hold and a save re-numbers, so
        // a line parked before a reorder keeps the old one. `docs/developers/modifiers.md` names
        // those columns.
        if (!sameOptionSelections(frozen.optionSnapshots, stored.optionSnapshots)) return null;
        const paired = matchExtraChildren(
          frozen.extraChildren,
          childrenByParent.get(stored.id) ?? [],
          stored.quantity,
        );
        return paired === null ? null : { stored, paired };
      });
    }
    // A line whose quantity RISES sells more of its dish and its extras, so those products must be
    // sellable now; failing that, the edit takes the replacement path, whose reads refuse it. The
    // dish is the variant's parent on a variant line, and only the dish and its picks are
    // re-checked: nothing else the replacement path's offer read refuses is, the variant's own
    // Active and Available included. A kept or lowered quantity is not re-checked: existing work is
    // not cancelled.
    const keepsEveryLine = sameBasket && rebuilt.every((entry) => entry !== null);
    const raised = keepsEveryLine
      ? rebuilt.flatMap((entry, index) =>
          compareDecimal(decimal(req.lines[index]!.quantity), decimal(entry!.stored.quantity)) > 0
            ? [{ entry: entry!, dishId: sameLines[index]!.productId }]
            : [],
        )
      : [];
    const pickIds = raised.flatMap(({ entry }) => entry.paired.map(({ pick }) => pick.productId));
    const raisedProductIds = new Set([...raised.map(({ dishId }) => dishId), ...pickIds]);
    const soldIds = [...raised.map(({ entry }) => entry.stored.productId!), ...pickIds];
    const raisesUnsellable =
      raisedProductIds.size > 0 &&
      ((
        await tx
          .select({ id: products.id })
          .from(products)
          .where(
            and(
              inArray(products.id, [...raisedProductIds]),
              eq(products.active, true),
              eq(products.available, true),
            ),
          )
      ).length < raisedProductIds.size ||
        (await parentsWithActiveVariants(tx, soldIds)).size > 0);
    const preservesEveryLine = keepsEveryLine && !raisesUnsellable;
    if (preservesEveryLine) {
      for (let index = 0; index < req.lines.length; index++) {
        const requested = req.lines[index]!;
        const { stored, paired } = rebuilt[index]!;
        await tx
          .update(workingOrderLines)
          .set({
            quantity: stringToThousandths(requested.quantity),
            lineTotal: decimalToCents(grossLineTotal(stored.unitPriceGross, requested.quantity)),
          })
          .where(
            and(eq(workingOrderLines.workingOrderId, id), eq(workingOrderLines.id, stored.id)),
          );
        // From the STORED gross, so the price the line was sold at is untouched. A child is paired
        // with its pick by `matchExtraChildren`, not by position.
        for (const { pick, child } of paired) {
          const childQuantity = multiplyDecimal(
            decimal(requested.quantity),
            decimal(String(pick.quantity)),
          );
          await tx
            .update(workingOrderLines)
            .set({
              quantity: decimalToThousandths(childQuantity),
              lineTotal: decimalToCents(grossLineTotal(child.unitPriceGross, childQuantity)),
            })
            .where(
              and(eq(workingOrderLines.workingOrderId, id), eq(workingOrderLines.id, child.id)),
            );
        }
      }
      await tx
        .update(workingOrders)
        .set({ label: req.label ?? null })
        .where(eq(workingOrders.id, id));
      return;
    }

    // Priced BEFORE deleting anything, so a bad line aborts with the parked order still intact.
    const context = await VENUE_SERVICE.findOrderContext(tx, cfg, id);
    const { lineRows, lineContexts } = await priceOrderLines(
      tx,
      cfg,
      id,
      req.lines,
      context?.zoneId,
    );
    // Cascades to each line's `ticket_items` row, so a fired line's kitchen ticket is deleted, not
    // recalled, and the new lines are not fired. `working_line_contexts` is re-recorded below.
    await tx.delete(workingOrderLines).where(eq(workingOrderLines.workingOrderId, id));
    await tx.insert(workingOrderLines).values(lineRows);
    await VENUE_SERVICE.recordLineContexts(tx, cfg, id, lineContexts);

    // An absent label clears it: the whole request is the new state.
    await tx
      .update(workingOrders)
      .set({ label: req.label ?? null })
      .where(eq(workingOrders.id, id));
  });
}

/** Abandon an open held order anywhere in the venue. An unknown id reads as `working_order.not_open`. */
export async function abandonHeldOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
): Promise<void> {
  void cfg;
  return withTransaction(deps.db, async (tx) => {
    const updated = await tx
      .update(workingOrders)
      .set({ status: "abandoned" })
      .where(and(eq(workingOrders.id, id), eq(workingOrders.status, "open")))
      .returning({ id: workingOrders.id });

    if (updated.length === 0) {
      throw new AppError("working_order.not_open", { workingOrderId: id });
    }
  });
}

/** The fiscal fields are filled only when placing files an invoice. */
export interface PlaceOrderResult {
  id: string;
  status: "placed" | "settled";
  invoiceNumber?: string;
  issuedAt?: string;
  total?: string;
  qr?: string;
  vatBreakdown?: { rate: string; base: string; tax: string }[];
}

/**
 * Place an open order, append its genesis amendment and fire kitchen items in one transaction.
 * invoice_first also files a deferred invoice from the stored prices. `saleTillId` is the
 * authenticated device's register on the fiscal record.
 *
 * A second placement cannot file a second invoice: `withTransaction` IS the venue file's write lock,
 * so it reads `placed` and is refused before it reaches the file.
 */
export async function placeOrder(
  deps: TillSaleDeps,
  cfg: TillConfig,
  id: string,
  operatorId: string,
  saleTillId: TillId,
): Promise<PlaceOrderResult> {
  return withTransaction(deps.db, async (tx) => {
    const [locked] = await tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    if (locked === undefined || locked.status !== "open") {
      throw new AppError("working_order.not_open", { workingOrderId: id });
    }
    const serviceContext = await VENUE_SERVICE.findOrderContext(tx, cfg, id);
    const orderFlow = serviceContext?.serviceMode ?? cfg.orderFlow;

    // Placing commits the whole order, a course the kitchen holds included, so every line is sent.
    // Stamped while the order is still open, which is the only time a line may be written.
    await tx
      .update(workingOrderLines)
      .set({ sentAt: nowIso() })
      .where(and(eq(workingOrderLines.workingOrderId, id), isNull(workingOrderLines.sentAt)));

    // Only invoice-first files at placing, from the stored locked lines: never a re-price.
    let placeResult: PlaceOrderResult = { id, status: "placed" };
    let issuedOrderLabel: string | null | undefined;
    if (orderFlow === "invoice_first") {
      const priced = await issuancePass(tx, cfg, id, await priceStoredOrderForIssuance(tx, id));
      // The fiscal record's `till_id` is the DEVICE till, while the amendment below records the box's
      // CONFIGURED register. The chain is keyed by the node, not the device.
      const { saleId, fiscal } = await recordSale(tx, deps.backend, {
        tillId: saleTillId,
        nodeId: cfg.nodeId,
        seriesId: cfg.seriesId,
        workingOrderId: brandWorkingOrderId(id),
        locale: cfg.locale,
        invoiceLocales: cfg.invoiceLocales,
        total: priced.total,
        lines: priced.lines,
        vatBreakdown: priced.vatBreakdown,
        clock: deps.clock,
        operatorId,
        // No tender and no settlement until `collectOrder` settles it.
        settlement: { kind: "deferred" },
      });
      const ticket: TillSaleResult = {
        ...(await readReceiptIssuer(deps.backend, tx, saleId)),
        ...(await readReceiptOrder(tx, cfg, id, { atIssuance: true })),
        invoiceNumber: await readInvoiceNumber(tx, saleId),
        issuedAt: fiscal.issuedAt.toISOString(),
        total: priced.total,
        qr: fiscal.verificationUrl ?? "",
        vatBreakdown: toVatBreakdown(priced.vatBreakdown),
        lines: ticketLinesFrom(priced),
        tender: { method: "unpaid" },
      };
      placeResult = {
        id,
        status: "placed",
        invoiceNumber: ticket.invoiceNumber,
        issuedAt: ticket.issuedAt,
        total: ticket.total,
        qr: ticket.qr,
        vatBreakdown: ticket.vatBreakdown,
      };
      issuedOrderLabel = ticket.orderLabel;
      await enqueueOriginalReceipt(tx, { ...cfg, tillId: saleTillId }, ticket);
    }

    await tx
      .update(workingOrders)
      .set({
        status: "placed",
        ...(issuedOrderLabel === undefined ? {} : { label: issuedOrderLabel }),
      })
      .where(eq(workingOrders.id, id));

    // `capturedByTillId` is the CONFIGURED register, as in `cancelPlacedOrder`, so one order's
    // placed/cancelled pair stays on the same register.
    const now = deps.clock.now();
    await appendOrderAmendment(tx, {
      workingOrderId: id,
      kind: "order_placed",
      actorId: operatorId,
      reason: null,
      capturedByTillId: cfg.tillId,
      capturedByNodeId: cfg.nodeId,
      eventAt: now.instant,
      eventOffsetMinutes: now.offsetMinutes,
    });

    const firedLines = await tx
      .select({
        id: workingOrderLines.id,
        productId: workingOrderLines.productId,
        courseId: workingOrderLines.courseId,
        parentLineId: workingOrderLines.parentLineId,
        note: workingOrderLines.note,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    await fireLines(tx, cfg, id, firedLines);

    return placeResult;
  });
}

/**
 * Cancel a placed order and append its reasoned amendment in one transaction. A second cancel reads
 * `abandoned` and is refused `working_order.not_placed`.
 */
export async function cancelPlacedOrder(
  deps: TillSaleDeps,
  cfg: TillConfig,
  id: string,
  reason: string,
  operatorId: string,
): Promise<void> {
  // The reason is the amendment's accountable content. Checked before the status, so a missing reason
  // is a request-shape error, not the state conflict `not_placed` names.
  if (reason.trim() === "") {
    throw new AppError("working_order.reason_required", { workingOrderId: id });
  }

  return withTransaction(deps.db, async (tx) => {
    const [locked] = await tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    if (locked === undefined || locked.status !== "placed") {
      throw new AppError("working_order.not_placed", { workingOrderId: id });
    }

    await tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));

    const now = deps.clock.now();
    await appendOrderAmendment(tx, {
      workingOrderId: id,
      kind: "order_cancelled",
      actorId: operatorId,
      reason,
      capturedByTillId: cfg.tillId,
      capturedByNodeId: cfg.nodeId,
      eventAt: now.instant,
      eventOffsetMinutes: now.offsetMinutes,
    });
  });
}

/** Fire a settled prepay order. The unique item-per-line constraint refuses a repeated fire. */
export async function sendToPrep(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
): Promise<void> {
  return withTransaction(deps.db, async (tx) => {
    const [order] = await tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    if (order === undefined || order.status !== "settled") {
      throw new AppError("working_order.not_settled", { workingOrderId: id });
    }

    const firedLines = await tx
      .select({
        id: workingOrderLines.id,
        productId: workingOrderLines.productId,
        courseId: workingOrderLines.courseId,
        parentLineId: workingOrderLines.parentLineId,
        note: workingOrderLines.note,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    await fireLines(tx, cfg, id, firedLines);
  });
}

/** Stamp a settled, fired order as collected so it leaves the kitchen queue. */
export async function markCollected(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
): Promise<void> {
  void cfg;
  return withTransaction(deps.db, async (tx) => {
    const [order] = await tx
      .select({ status: workingOrders.status, collectedAt: workingOrders.collectedAt })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    if (order === undefined || order.status !== "settled") {
      throw new AppError("working_order.not_settled", { workingOrderId: id });
    }
    // Refused here, before the trigger that allows `collected_at` only NULL → non-null refuses it
    // as an opaque error.
    if (order.collectedAt !== null) {
      throw new AppError("working_order.already_collected", { workingOrderId: id });
    }
    // An order with no ticket items is on no station display to hand over.
    const [fired] = await tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, id))
      .limit(1);
    if (fired === undefined) {
      throw new AppError("ticket.not_fired", { workingOrderId: id });
    }

    await tx
      .update(workingOrders)
      .set({ collectedAt: nowIso() })
      .where(and(eq(workingOrders.id, id), isNull(workingOrders.collectedAt)));
  });
}

/** One unserved, fired line of an open tab, as `listTablesWithState`'s JSON aggregate emits it. */
interface UnservedLine {
  queuedAt: string;
  warmAfterMinutes: number;
  overdueAfterMinutes: number;
  forgottenAfterMinutes: number;
}

/**
 * The `tab_unserved_lines` aggregate, parsed.
 *
 * It arrives as JSON TEXT because `json_group_array` returns a string and a raw read reaches no
 * column mapping. An empty tab carries the literal `'[]'` the query coalesces to.
 */
function parseUnservedLines(value: string): UnservedLine[] {
  return JSON.parse(value) as UnservedLine[];
}

/**
 * Whole minutes from a stored ISO stamp to `nowMs`, floored. Callers read the clock ONCE per query,
 * so every row of one board is aged against one instant.
 */
function minutesSince(stamp: string, nowMs: number): number {
  return Math.floor((nowMs - Date.parse(stamp)) / 60_000);
}

/** `queued → preparing → ready`. */
export type TicketState = (typeof ticketState.enumValues)[number];

export type WorkingOrderStatus = (typeof workingOrderStatus.enumValues)[number];

/** The forward kitchen transitions, keyed by target state: the one legal predecessor and the column
 *  stamped. `queued` is not a target: a fire reaches it. */
const TICKET_TRANSITIONS = {
  preparing: { from: "queued", stampedAt: "preparingAt" },
  ready: { from: "preparing", stampedAt: "readyAt" },
} as const satisfies Record<
  Exclude<TicketState, "queued">,
  { from: TicketState; stampedAt: "preparingAt" | "readyAt" }
>;

/** A ternary, not a computed key: a computed key would widen the payload to a string index and lose
 *  Drizzle's typing against `ticket_items`. */
function advanceSet(to: Exclude<TicketState, "queued">) {
  const at = nowIso();
  return TICKET_TRANSITIONS[to].stampedAt === "preparingAt"
    ? { state: to, preparingAt: at }
    : { state: to, readyAt: at };
}

/** Advance one fired ticket item one step. A held item is refused `ticket.item_held`. */
export async function advanceTicketItem(
  tx: Transaction,
  cfg: TillConfig,
  itemId: string,
  to: TicketState,
): Promise<void> {
  void cfg;
  // Own string keys only: `hasOwn` converts its key, so ["preparing"] would otherwise match, and an
  // inherited name such as "__proto__" is not a transition.
  if (typeof to !== "string" || !Object.hasOwn(TICKET_TRANSITIONS, to)) {
    throw new AppError("ticket.invalid_transition", { ticketItemId: itemId });
  }
  const validTo = to as Exclude<TicketState, "queued">;
  const transition = TICKET_TRANSITIONS[validTo];

  const updated = await tx
    .update(ticketItems)
    .set(advanceSet(validTo))
    .where(
      and(
        eq(ticketItems.id, itemId),
        eq(ticketItems.state, transition.from),
        isNotNull(ticketItems.firedAt),
      ),
    )
    .returning({ id: ticketItems.id });
  if (updated.length === 0) {
    const [item] = await tx
      .select({ firedAt: ticketItems.firedAt })
      .from(ticketItems)
      .where(eq(ticketItems.id, itemId));
    if (item !== undefined && item.firedAt === null) {
      throw new AppError("ticket.item_held", { ticketItemId: itemId });
    }
    throw new AppError("ticket.invalid_transition", { ticketItemId: itemId });
  }
}

/** Advance the fired items of one order at one station; held items are skipped. */
export async function advanceTicket(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  stationId: string,
  to: Exclude<TicketState, "queued">,
): Promise<void> {
  void cfg;
  await tx
    .update(ticketItems)
    .set(advanceSet(to))
    .where(
      and(
        eq(ticketItems.workingOrderId, orderId),
        eq(ticketItems.stationId, stationId),
        eq(ticketItems.state, TICKET_TRANSITIONS[to].from),
        isNotNull(ticketItems.firedAt),
      ),
    );
}

/** The LIVE course row an item's snapshotted `course_id` names. Not filtered by `active`, so a course
 *  deactivated after the item was fired still names its header. */
export interface StationQueueCourse {
  id: string;
  name: string;
  displayOrder: number;
}

/** A child modifier line on a queue item: never its own ticket item. */
export interface QueueModifier {
  descriptions: Record<string, string>;
  /** The extra's OWN allergens, shown beside the dish's own, never folded into them. */
  addAllergens?: ProductAllergens | null;

  suitableFor?: string[] | null;
}

export interface StationQueueItem {
  id: string;
  workingOrderLineId: string;
  state: TicketState;
  optionSnapshots?: OptionSnapshot[];
  /** The KITCHEN name, the same one the printed kitchen ticket carries. */
  name: string;
  quantity: string;
  unitName: Record<string, string> | null;
  unitPrecision: number | null;
  modifiers: QueueModifier[];
  /** The dish's OWN allergens, no modifier contribution. `pending` when they are unreviewed. */
  asServed: { allergens: ProductAllergens; pending: boolean };
  asServedDiet?: DietProfile;
  course: StationQueueCourse | null;
  /** `null` while the item is HELD. */
  firedAt: string | null;
  /** Snapshotted at fire, so a later draft edit never changes what the kitchen already sees. */
  note: string | null;
  queuedAt: string;
  /** The age band at fetch time; the client re-ticks it locally afterwards. */
  band: TimingBand;
}

/** One order's lines at a station. `queuedAt` is its OLDEST line's. */
export interface StationQueueGroup {
  orderId: string;
  orderNumber: number;
  label: string | null;
  queuedAt: string;
  /** The till reads COLLECTABLE off this alone: only a `settled` order awaits the counter handover. */
  status: WorkingOrderStatus;
  items: StationQueueItem[];
  thresholds: StationThresholds;
}

/**
 * Each parent line's child modifier lines, then its product's OWN allergens and diet: no modifier
 * fold, each dish shows its own figures.
 */
async function readQueueSubItems(
  tx: Transaction,
  parentLineIds: string[],
): Promise<{
  modifiersByParent: Map<string, QueueModifier[]>;
  asServedByParent: Map<
    string,
    {
      asServed: { allergens: ProductAllergens; pending: boolean };
      asServedDiet: DietProfile;
    }
  >;
}> {
  const modifiersByParent = new Map<string, QueueModifier[]>();
  const asServedByParent = new Map<
    string,
    {
      asServed: { allergens: ProductAllergens; pending: boolean };
      asServedDiet: DietProfile;
    }
  >();
  if (parentLineIds.length === 0) return { modifiersByParent, asServedByParent };

  // LEFT join, so a child whose product row has gone still renders its frozen text.
  const childRows = await tx
    .select({
      parentLineId: workingOrderLines.parentLineId,
      descriptions: workingOrderLines.descriptions,
      addAllergens: effectiveProductColumns.allergens,
      dietaryDeclarations: effectiveProductColumns.dietaryDeclarations,
    })
    .from(workingOrderLines)
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(parentProducts, parentJoin)
    .where(inArray(workingOrderLines.parentLineId, parentLineIds))
    .orderBy(workingOrderLines.lineNo);
  for (const child of childRows) {
    const mods = modifiersByParent.get(child.parentLineId!) ?? [];
    mods.push({
      descriptions: child.descriptions,
      addAllergens: (child.addAllergens as ProductAllergens | null) ?? null,
      suitableFor: expandDietaryDeclarations(child.dietaryDeclarations as DietaryLabel[]),
    });
    modifiersByParent.set(child.parentLineId!, mods);
  }

  const parents = await tx
    .select({
      lineId: workingOrderLines.id,
      allergens: effectiveProductColumns.allergens,
      dietaryDeclarations: effectiveProductColumns.dietaryDeclarations,
    })
    .from(workingOrderLines)
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(parentProducts, parentJoin)
    .where(inArray(workingOrderLines.id, parentLineIds));
  for (const p of parents) {
    const allergens = (p.allergens ?? {}) as ProductAllergens;
    const expanded = expandDietaryDeclarations(p.dietaryDeclarations as DietaryLabel[]);
    const asServedDiet: DietProfile = {
      vegan: expanded.includes("vegan") ? "yes" : "unknown",
      vegetarian: expanded.includes("vegetarian") ? "yes" : "unknown",
      contains: [],
      ...(expanded.includes("halal") ? { halal: "yes" as const } : {}),
      ...(expanded.includes("kosher") ? { kosher: "yes" as const } : {}),
    };
    asServedByParent.set(p.lineId, {
      asServed: { allergens, pending: p.allergens == null },
      asServedDiet,
    });
  }
  return { modifiersByParent, asServedByParent };
}

/**
 * The venue's ticket items at one station, grouped by order, oldest first. An abandoned or collected
 * order drops out; items are not filtered by state, so a `ready` line stays until its order collects.
 */
export async function listStationQueue(
  tx: Transaction,
  stationId: string,
): Promise<StationQueueGroup[]> {
  const rows = await tx
    .select({
      itemId: ticketItems.id,
      workingOrderLineId: ticketItems.workingOrderLineId,
      state: ticketItems.state,
      queuedAt: ticketItems.queuedAt,
      // Customer-facing text is deliberately not read: a cook reads the kitchen name.
      name: workingOrderLines.name,
      kitchenName: workingOrderLines.kitchenName,
      variantName: workingOrderLines.variantName,
      variantKitchenName: workingOrderLines.variantKitchenName,
      optionSnapshots: workingOrderLines.optionSnapshots,
      quantity: firedQuantity,
      unitName: workingOrderLines.unitName,
      unitPrecision: workingOrderLines.unitPrecision,
      lineNo: workingOrderLines.lineNo,
      courseId: ticketItems.courseId,
      courseName: kitchenCourses.name,
      courseDisplayOrder: kitchenCourses.displayOrder,
      firedAt: ticketItems.firedAt,
      // The fire-time snapshot, not the live line.
      note: ticketItems.note,
      orderId: workingOrders.id,
      orderNumber: workingOrders.orderNumber,
      label: workingOrders.label,
      status: workingOrders.status,
      warmAfterMinutes: kitchenStations.warmAfterMinutes,
      overdueAfterMinutes: kitchenStations.overdueAfterMinutes,
      forgottenAfterMinutes: kitchenStations.forgottenAfterMinutes,
    })
    .from(ticketItems)
    .innerJoin(workingOrders, eq(ticketItems.workingOrderId, workingOrders.id))
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .innerJoin(kitchenStations, eq(ticketItems.stationId, kitchenStations.id))
    // Not filtered by `active`: a course deactivated after the item was fired still names its header.
    .leftJoin(kitchenCourses, eq(ticketItems.courseId, kitchenCourses.id))
    .where(
      and(
        eq(ticketItems.stationId, stationId),
        ne(workingOrders.status, "abandoned"),
        isNull(workingOrders.collectedAt),
      ),
    )
    // `line_no` breaks the tie between lines fired together with an identical `queued_at`.
    .orderBy(ticketItems.queuedAt, workingOrderLines.lineNo);

  const { modifiersByParent, asServedByParent } = await readQueueSubItems(
    tx,
    rows.map((row) => row.workingOrderLineId),
  );

  const nowMs = Date.now();
  // The Map keeps insertion order, so groups come out oldest-first.
  const groups = new Map<string, StationQueueGroup>();
  for (const row of rows) {
    const thresholds: StationThresholds = {
      warmAfterMinutes: row.warmAfterMinutes,
      overdueAfterMinutes: row.overdueAfterMinutes,
      forgottenAfterMinutes: row.forgottenAfterMinutes,
    };
    let group = groups.get(row.orderId);
    if (group === undefined) {
      group = {
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        label: row.label,
        queuedAt: row.queuedAt,
        status: row.status,
        items: [],
        thresholds,
      };
      groups.set(row.orderId, group);
    }
    group.items.push({
      id: row.itemId,
      workingOrderLineId: row.workingOrderLineId,
      state: row.state,
      name: kitchenPresentationName(row),
      optionSnapshots: row.optionSnapshots,
      quantity: thousandthsToDecimal(row.quantity),
      unitName: row.unitName,
      unitPrecision: row.unitPrecision,
      modifiers: modifiersByParent.get(row.workingOrderLineId) ?? [],
      asServed: asServedByParent.get(row.workingOrderLineId)?.asServed ?? {
        allergens: {},
        pending: true,
      },
      asServedDiet: asServedByParent.get(row.workingOrderLineId)?.asServedDiet ?? {
        vegan: "unknown",
        vegetarian: "unknown",
        contains: [],
      },
      // A non-null `course_id` always matches a `kitchen_courses` row: the foreign key guarantees it.
      course:
        row.courseId === null
          ? null
          : { id: row.courseId, name: row.courseName!, displayOrder: row.courseDisplayOrder! },
      firedAt: row.firedAt,
      note: row.note,
      queuedAt: row.queuedAt,
      // Rounded to the whole minute first: what the bands were tuned against.
      band: classifyBand(nowMs - minutesSince(row.queuedAt, nowMs) * 60_000, nowMs, thresholds),
    });
  }
  return [...groups.values()];
}

/** One item on the cross-station expo board. */
export interface ExpoItem {
  optionSnapshots?: OptionSnapshot[];
  id: string;
  /** The same KITCHEN name the stations read. */
  name: string;
  qty: string;
  unitName: Record<string, string> | null;
  unitPrecision: number | null;
  stationName: string;
  state: TicketState;
  firedAt: string | null;
  awayAt: string | null;
  note: string | null;
  modifiers: QueueModifier[];
  asServed: { allergens: ProductAllergens; pending: boolean };
  asServedDiet?: DietProfile;
  queuedAt: string;
  /** This item's OWN station's order-timing thresholds — per item, not per order, because one order's
   *  items can span several stations each with different thresholds. */
  thresholds: StationThresholds;
  band: TimingBand;
}

/** One course of an expo order; the null course sorts earliest. `fired` and `away` are true only once
 *  EVERY item of the course carries that stamp. */
export interface ExpoCourse {
  courseId: string | null;
  courseName: string | null;
  displayOrder: number | null;
  fired: boolean;
  away: boolean;
  items: ExpoItem[];
}

/** One order on the cross-station expo board. `tableLabel` is absent for a bare walk-up. */
export interface ExpoOrder {
  orderId: string;
  tableLabel?: string;
  orderNumber: number;
  openedMinutes: number;
  courses: ExpoCourse[];
  /** The worst age band over the UNSERVED lines: a served line has reached the guest. */
  worstBand: TimingBand;
}

/**
 * The cross-station expo read: every order in the venue that is not abandoned, not collected, and
 * has at least one item not yet away (open, placed and settled orders alike), its items gathered
 * across all stations and grouped by course. A surviving order carries ALL its items, away ones
 * included, so a per-course `away` flag can be rolled up. `locationId` scopes only the table label.
 */
export async function listExpoQueue(
  tx: Transaction,
  cfg: TillConfig,
  locationId?: string,
): Promise<ExpoOrder[]> {
  const loc = locationId ?? cfg.locationId;
  const rows = await tx
    .select({
      itemId: ticketItems.id,
      lineId: ticketItems.workingOrderLineId,
      state: ticketItems.state,
      firedAt: ticketItems.firedAt,
      awayAt: ticketItems.awayAt,
      note: ticketItems.note,
      name: workingOrderLines.name,
      kitchenName: workingOrderLines.kitchenName,
      variantName: workingOrderLines.variantName,
      variantKitchenName: workingOrderLines.variantKitchenName,
      optionSnapshots: workingOrderLines.optionSnapshots,
      quantity: firedQuantity,
      unitName: workingOrderLines.unitName,
      unitPrecision: workingOrderLines.unitPrecision,
      lineNo: workingOrderLines.lineNo,
      // Not exposed; read only to leave a served line out of `worstBand`.
      servedAt: workingOrderLines.servedAt,
      stationName: kitchenStations.name,
      // Per item, not per order: one order's items can span stations with different thresholds.
      queuedAt: ticketItems.queuedAt,
      warmAfterMinutes: kitchenStations.warmAfterMinutes,
      overdueAfterMinutes: kitchenStations.overdueAfterMinutes,
      forgottenAfterMinutes: kitchenStations.forgottenAfterMinutes,
      courseId: ticketItems.courseId,
      courseName: kitchenCourses.name,
      courseDisplayOrder: kitchenCourses.displayOrder,
      orderId: workingOrders.id,
      orderNumber: workingOrders.orderNumber,
      openedAt: workingOrders.openedAt,
      // A scalar subquery, not a LEFT JOIN, which would multiply the item rows when several tables
      // match (the tables joined to one tab, or a tab's table and a table the order delivers to).
      // The `order by` makes the label picked deterministic: a table whose `tab_id` is this order
      // first, then the lowest table id.
      tableLabel: sql<string | null>`(
        select dt.label from dining_tables dt
        where dt.location_id = ${loc}
          and (dt.tab_id = ${workingOrders.id} or ${workingOrders.deliveryTableId} = dt.id)
        order by (dt.tab_id = ${workingOrders.id}) desc nulls last, dt.id
        limit 1)`,
    })
    .from(ticketItems)
    .innerJoin(workingOrders, eq(ticketItems.workingOrderId, workingOrders.id))
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .innerJoin(kitchenStations, eq(ticketItems.stationId, kitchenStations.id))
    // Not filtered by `active`, as in `listStationQueue`.
    .leftJoin(kitchenCourses, eq(ticketItems.courseId, kitchenCourses.id))
    .where(
      and(
        ne(workingOrders.status, "abandoned"),
        isNull(workingOrders.collectedAt),
        // An order leaves once every item is away. `served_at` is a separate floor marker, not
        // consulted here.
        sql`exists (
          select 1 from ${ticketItems} tix
          where tix.working_order_id = ${workingOrders.id}
            and tix.away_at is null)`,
      ),
    )
    .orderBy(
      workingOrders.openedAt,
      sql`${kitchenCourses.displayOrder} asc nulls first`,
      workingOrderLines.lineNo,
      ticketItems.id,
    );

  const { modifiersByParent, asServedByParent } = await readQueueSubItems(
    tx,
    rows.map((row) => row.lineId),
  );

  const nowMs = Date.now();
  // Maps keep insertion order, so the SQL order survives the grouping.
  const orders = new Map<string, ExpoOrder>();
  const courseMaps = new Map<string, Map<string, ExpoCourse>>();
  for (const row of rows) {
    let order = orders.get(row.orderId);
    if (order === undefined) {
      order = {
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        openedMinutes: minutesSince(row.openedAt, nowMs),
        courses: [],
        ...(row.tableLabel === null ? {} : { tableLabel: row.tableLabel }),
        worstBand: "fresh",
      };
      orders.set(row.orderId, order);
      courseMaps.set(row.orderId, new Map());
    }
    const byCourse = courseMaps.get(row.orderId)!;
    const courseKey = row.courseId ?? "__none__";
    let course = byCourse.get(courseKey);
    if (course === undefined) {
      course = {
        courseId: row.courseId,
        courseName: row.courseId === null ? null : row.courseName!,
        displayOrder: row.courseId === null ? null : row.courseDisplayOrder!,
        fired: true,
        away: true,
        items: [],
      };
      byCourse.set(courseKey, course);
      order.courses.push(course);
    }
    const thresholds: StationThresholds = {
      warmAfterMinutes: row.warmAfterMinutes,
      overdueAfterMinutes: row.overdueAfterMinutes,
      forgottenAfterMinutes: row.forgottenAfterMinutes,
    };
    // Rounded to the whole minute first, as in `listStationQueue`.
    const band = classifyBand(
      nowMs - minutesSince(row.queuedAt, nowMs) * 60_000,
      nowMs,
      thresholds,
    );
    course.items.push({
      id: row.itemId,
      name: kitchenPresentationName(row),
      optionSnapshots: row.optionSnapshots,
      qty: thousandthsToDecimal(row.quantity),
      unitName: row.unitName,
      unitPrecision: row.unitPrecision,
      stationName: row.stationName,
      state: row.state,
      firedAt: row.firedAt,
      awayAt: row.awayAt,
      note: row.note,
      modifiers: modifiersByParent.get(row.lineId) ?? [],
      asServed: asServedByParent.get(row.lineId)?.asServed ?? {
        allergens: {},
        pending: true,
      },
      asServedDiet: asServedByParent.get(row.lineId)?.asServedDiet ?? {
        vegan: "unknown",
        vegetarian: "unknown",
        contains: [],
      },
      queuedAt: row.queuedAt,
      thresholds,
      band,
    });
    if (row.firedAt === null) course.fired = false;
    if (row.awayAt === null) course.away = false;
    if (row.servedAt === null) order.worstBand = worstBand([order.worstBand, band]);
  }
  return [...orders.values()];
}

/** One row of the occupancy read-model. */
export interface TableState {
  id: string;
  label: string;
  zoneId: string | null;
  capacity: number | null;
  state: "free" | "open-tab" | "delivery-pending";
  hasOpenTab: boolean;
  tabId?: string;
  tabLineCount?: number;
  /** The open tab's GROSS draft total. */
  tabTotal?: string;
  pendingDeliveries: number;
  /** The open tab's unserved lines, whatever their kitchen state. */
  pendingToServe: number;
  /** The open tab's unserved lines whose ticket item is `ready`. */
  readyToServe: number;
  /** The open tab's unserved lines the pass has sent away. Such a line counts in `readyToServe` too. */
  enRoute: number;
  /** The worst age band over the open tab's unserved lines; a counter delivery does not feed it. */
  timingBand: TimingBand;
  /** The MANUAL service status, independent of occupancy: a `free` table may carry one. */
  status: { id: string; label: string; color: string } | null;
  /** Floor-plan placement, `null` when unplaced. */
  posX: number | null;
  posY: number | null;
  shape: FloorTableShape | null;
  rotation: number | null;
  /** Merged from the enabled modules' floor annotators; `null` when none annotates the table. */
  nextReservation: { time: string } | null;
}

/**
 * Read the location's active tables with their occupancy. An open tab takes precedence over a
 * delivery. A pending delivery has kitchen items and is neither collected nor abandoned.
 */
export async function listTablesWithState(
  tx: Transaction,
  cfg: TillConfig,
  annotators: readonly FloorAnnotator[] = [],
  locationId?: string,
  now: Date = new Date(),
): Promise<TableState[]> {
  const loc = locationId ?? cfg.locationId;
  const result = await tx.execute<{
    id: string;
    label: string;
    zone_id: string | null;
    capacity: number | null;
    tab_id: string | null;
    tab_line_count: number;
    tab_total: string | null;
    pending_to_serve: number;
    ready_to_serve: number;
    en_route: number;
    // Classified in JS, never in SQL, so server and client share one classifier.
    tab_unserved_lines: string;
    pending_deliveries: number;
    status_id: string | null;
    status_label: string | null;
    status_color: string | null;
    pos_x: number | null;
    pos_y: number | null;
    shape: FloorTableShape | null;
    rotation: number | null;
  }>(sql`
    select
      dt.id, dt.label, dt.zone_id, dt.capacity,
      dt.pos_x, dt.pos_y, dt.shape, dt.rotation,
      tab.id as tab_id,
      cast(coalesce(tab.line_count, 0) as int) as tab_line_count,
      tab.tab_total,
      cast(coalesce(tab.pending_to_serve, 0) as int) as pending_to_serve,
      cast(coalesce(tab.ready_to_serve, 0) as int) as ready_to_serve,
      cast(coalesce(tab.en_route, 0) as int) as en_route,
      coalesce(tab.unserved_lines, '[]') as tab_unserved_lines,
      cast(coalesce(del.pending, 0) as int) as pending_deliveries,
      tss.id as status_id, tss.label as status_label, tss.color as status_color
    from dining_tables dt
    -- A GROUPED derived table joined on the tab id, not a LEFT JOIN LATERAL ... ON TRUE: this
    -- engine has no LATERAL and refuses it at prepare with near "select": syntax error (measured
    -- 2026-09-22 on Node v26.7.0). The LATERAL form's only correlation was wo.id = dt.tab_id, which is
    -- an ordinary join key, so every open order is aggregated once and matched by id. Same shape,
    -- same rows; the engine does more grouping work and the answer is unchanged.
    left join (
      select wo.id,
             cast(count(wol.id) as int) as line_count,
             cast(count(wol.id) filter (where wol.served_at is null) as int) as pending_to_serve,
             -- KDS-1 section 3d "N listos": lines the kitchen has bumped ready but the waiter has not
             -- yet carried out (served_at is null). The ticket item is joined 1:1 on the line -- its
             -- (working_order_line_id) UNIQUE gives at most one ti per wol, so this LEFT JOIN
             -- neither multiplies wol rows (line_count / tab_total stay correct) nor double-counts. An
             -- unfired or not-yet-ready line has ti.state null or != 'ready' and is excluded by the filter.
             cast(count(*) filter (where ti.state = 'ready' and wol.served_at is null) as int) as ready_to_serve,
             -- KDS-3 section 3c "en camino": lines the pass has DISPATCHED (ti.away_at is not null, set by
             -- markCourseAway) that the waiter has not yet carried out (served_at is null). Same 1:1
             -- ti-on-line join as ready_to_serve, so no wol multiplication; an away item is still ready
             -- and unserved, so it counts here AND in ready_to_serve until served -- the client applies the
             -- en-camino > listos precedence off the two counts.
             cast(count(*) filter (where ti.away_at is not null and wol.served_at is null) as int) as en_route,
             -- A count of whole cents read raw, cast to text and converted by rawCentsToDecimal in
             -- the mapping below -- see its doc comment for why it is text and not an integer cast.
             cast(coalesce(sum(wol.line_total), 0) as text) as tab_total,
             -- KDS order-timing alerts (design §3/§6): the queued_at + thresholds of each unserved,
             -- FIRED (ti.id is not null) line, one JSON object per line -- never a band label (§3's
             -- raw-material-in-SQL, classified-in-JS split), reduced with classifyBand/worstBand in
             -- JS below. An unfired line (no ticket_items row) has not reached a station yet, so it
             -- carries no stamp and is excluded, same as a served one.
             --
             -- json_group_array(json_object(...)) in place of PostgreSQL's aggregate pair:
             -- those two are PostgreSQL names and this engine does not have them. The result is
             -- JSON TEXT here rather than a value the driver parses, so the row mapping parses it.
             json_group_array(
               json_object(
                 'queuedAt', ti.queued_at,
                 'warmAfterMinutes', ks.warm_after_minutes,
                 'overdueAfterMinutes', ks.overdue_after_minutes,
                 'forgottenAfterMinutes', ks.forgotten_after_minutes
               )
             ) filter (where wol.served_at is null and ti.id is not null) as unserved_lines
      from working_orders wo
      left join working_order_lines wol
        on wol.working_order_id = wo.id
      left join ticket_items ti
        on ti.working_order_line_id = wol.id
      -- The unserved line's OWN station thresholds, for the JSON aggregate above. LEFT (not INNER): a row
      -- with no ticket item (ti null) must survive so line_count/tab_total/the other aggregates above
      -- are unaffected by this join — such a row is excluded from unserved_lines by the FILTER instead.
      left join kitchen_stations ks
        on ks.id = ti.station_id
      where wo.status = 'open'
      group by wo.id
    ) tab on tab.id = dt.tab_id
    -- The delivery count, grouped the same way: the LATERAL form's correlation was
    -- d.delivery_table_id = dt.id, so it becomes the join key. A NULL delivery_table_id groups
    -- to a row nothing joins to, which is the LATERAL form's no-rows answer.
    left join (
      select d.delivery_table_id, cast(count(*) as int) as pending
      from working_orders d
      where d.status <> 'abandoned' and d.collected_at is null
        and exists (
          select 1 from ticket_items ti
          where ti.working_order_id = d.id
        )
      group by d.delivery_table_id
    ) del on del.delivery_table_id = dt.id
    left join table_service_statuses tss
      on tss.id = dt.status_id
    where dt.location_id = ${loc} and dt.active = true
    order by dt.label
  `);

  // Not the `now` parameter, which is the VENUE clock the annotators take and a caller may supply.
  const nowMs = Date.now();
  const states = result.rows.map((r) => {
    const hasOpenTab = r.tab_id !== null;
    const pendingDeliveries = Number(r.pending_deliveries);
    const state: TableState["state"] = hasOpenTab
      ? "open-tab"
      : pendingDeliveries > 0
        ? "delivery-pending"
        : "free";
    const timingBand = worstBand(
      parseUnservedLines(r.tab_unserved_lines).map((line) =>
        classifyBand(nowMs - minutesSince(line.queuedAt, nowMs) * 60_000, nowMs, {
          warmAfterMinutes: line.warmAfterMinutes,
          overdueAfterMinutes: line.overdueAfterMinutes,
          forgottenAfterMinutes: line.forgottenAfterMinutes,
        }),
      ),
    );
    return {
      id: r.id,
      label: r.label,
      zoneId: r.zone_id,
      capacity: r.capacity,
      state,
      hasOpenTab,
      pendingToServe: Number(r.pending_to_serve),
      readyToServe: Number(r.ready_to_serve),
      enRoute: Number(r.en_route),
      timingBand,
      pendingDeliveries,
      status:
        r.status_id !== null
          ? { id: r.status_id, label: r.status_label!, color: r.status_color! }
          : null,
      posX: r.pos_x,
      posY: r.pos_y,
      shape: r.shape,
      rotation: r.rotation,
      nextReservation: null as { time: string } | null,
      ...(hasOpenTab
        ? {
            tabId: r.tab_id!,
            tabLineCount: Number(r.tab_line_count),
            tabTotal: rawCentsToDecimal(r.tab_total!),
          }
        : {}),
    };
  });

  if (annotators.length > 0) {
    const tableIds = states.map((s) => s.id);
    const annCfg = { locationId: brandLocationId(loc) };
    for (const annotator of annotators) {
      const annotations = await annotator.annotate(tx, annCfg, now, tableIds);
      for (const s of states) {
        const reserved = annotations.get(s.id)?.reservedTime ?? null;
        if (reserved !== null) s.nextReservation = { time: reserved };
      }
    }
  }
  return states;
}
