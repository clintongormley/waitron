import "./errors.js";
import { refuseOverSimplifiedLimit, formatInvoiceNumber } from "@waitron/core";
import {
  products,
  workingOrderLines,
  type Transaction,
  workingOrders,
  sales,
  invoiceSeries,
  kitchenCourses,
  ticketItems,
  kitchenStations,
  orderGroups,
  lineServiceCancellations,
} from "@waitron/db";
import {
  parentProducts,
  parentJoin,
  type LockedLine,
  type GrossLines,
  grossLockedLines,
} from "@waitron/menu";
import {
  type DatedRate,
  type VatClass,
  AppError,
  centsToDecimal,
  thousandthsToDecimal,
  optionSnapshotNames,
  type SaleLineClassification,
  type Decimal,
  decimal,
  compareDecimal,
  type SaleId,
  type OptionSnapshot,
  type ChangesAfterSending,
  staffPresentationName,
} from "@waitron/shared";
import { sql, type SQL, type GetColumnData, eq, inArray } from "drizzle-orm";
import { type LineNutrition, readDisplayLineNutrition } from "./line-nutrition.js";
import { readLineCancellations } from "./line-service-state.js";
import { readLineVatRates } from "./line-vat-rates.js";
import { VENUE_SERVICE } from "./modules.js";
import { type PortionBinding, projectPortionSale } from "./portion-sale-projection.js";
import { refuseTakeawaySetMenuMoney } from "./set-menu-bill.js";
import { stillMovable } from "./station-move.js";
import type { TradingContext } from "./trading-context.js";
import { dishesWithHeldExtra, dishWaitsInHeldGroup } from "./working-order-serving.js";
import type { TicketState } from "./kitchen-print.js";

export const productActive = sql<number>`(${products.active} and (${parentProducts.id} is null or ${parentProducts.active}))`;
/** A line's product can be sold now: Active and Available, and so is its parent for a variant. */
export const productSellable = sql<number>`(${products.active} and ${products.available}
  and (${parentProducts.id} is null or (${parentProducts.active} and ${parentProducts.available})))`;
const storedLineColumns = {
  id: workingOrderLines.id,
  productId: workingOrderLines.productId,
  parentLineId: workingOrderLines.parentLineId,
  grossUnitPrice: workingOrderLines.unitPriceGross,
  listUnitPriceGross: workingOrderLines.listUnitPriceGross,
  quantity: workingOrderLines.quantity,
  priceQuantity: workingOrderLines.priceQuantity,
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
  classification: workingOrderLines.classification,
  setMenuRole: workingOrderLines.setMenuRole,
};
type StoredLineRow = {
  [K in keyof typeof storedLineColumns]: (typeof storedLineColumns)[K] extends SQL<infer T>
    ? T
    : GetColumnData<Exclude<(typeof storedLineColumns)[K], SQL>>;
};
/**
 * Read a persisted order's STORED lines, snapshotted at add time, so every path that files a
 * persisted order files the same locked composition and a later menu price or VAT change never
 * moves the filed total. Bound portions come back grouped into the row their round was priced as
 * (`projectPortionSale`); an order holding no bound line is returned line for line, ungrouped.
 *
 * Refuses a LINELESS order with `sale.empty_basket`: an empty tab is a reachable state, and this is
 * the last check before its pay or place reaches a fiscal write or a card charge.
 */
export async function readLockedLines(
  tx: Transaction,
  workingOrderId: string,
): Promise<StoredOrderLine[]> {
  const rows = await tx
    .select({ ...storedLineColumns, ...portionColumns })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, workingOrderId))
    .orderBy(workingOrderLines.lineNo);
  return groupedByPortion(rows, toStoredLines(rows));
}
/** {@link readLockedLines}'s rows, `grouped`, and each working line ungrouped with whether it may be
 * paid now, `lines`. */
async function readLockedLinesForIssuance(
  tx: Transaction,
  workingOrderId: string,
  refuseSetMenus: boolean,
): Promise<{
  lines: (StoredOrderLine & { payable: boolean })[];
  grouped: StoredOrderLine[];
  /** Each grouped line's dated rates, at its index. */
  rates: (readonly DatedRate[])[];
}> {
  const rows = await tx
    .select({
      ...storedLineColumns,
      ...portionColumns,
      dining: workingOrders.dining,
      takeawayVatClass: workingOrderLines.takeawayVatClass,
      sentAt: workingOrderLines.sentAt,
      active: productActive,
    })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(parentProducts, parentJoin)
    .where(eq(workingOrderLines.workingOrderId, workingOrderId))
    .orderBy(workingOrderLines.lineNo);
  if (refuseSetMenus) await refuseTakeawaySetMenuMoney(tx, workingOrderId, rows, rows[0]?.dining);
  const stored = toStoredLines(rows);
  const grouped = groupedByPortion(rows, stored);
  const rowRates = await readLineVatRates(
    tx,
    rows[0]!.dining,
    rows.map((row) => ({
      productId: row.productId,
      setMenuRole: row.setMenuRole,
      takeawayVatClass: row.takeawayVatClass as VatClass,
    })),
  );
  // A grouped row carries the id of the first working line it stands for; the lines it stands for
  // share everything their rates depend on.
  const ratesById = new Map(rows.map((row, i) => [row.id, rowRates[i]!]));
  return {
    lines: stored.map((line, i) => ({
      ...line,
      payable:
        line.identity.productId === null || rows[i]!.sentAt !== null || Boolean(rows[i]!.active),
    })),
    grouped,
    rates: grouped.map((line) => ratesById.get(line.identity.id)!),
  };
}
const portionColumns = {
  cohortId: workingOrderLines.cohortId,
  ordinal: workingOrderLines.cohortOrdinal,
};
/** Bound portions grouped back into the rows they were priced as; an order with none is as stored. */
function groupedByPortion(
  rows: readonly {
    id: string;
    cohortId: string | null;
    ordinal: number | null;
  }[],
  stored: StoredOrderLine[],
): StoredOrderLine[] {
  const bindings = new Map<string, PortionBinding>();
  for (const row of rows) {
    if (row.cohortId === null) continue;
    bindings.set(row.id, {
      lineId: row.id,
      cohortId: row.cohortId,
      ordinal: row.ordinal!,
    });
  }
  return bindings.size === 0 ? stored : projectPortionSale(stored, bindings);
}
function toStoredLines(stored: readonly StoredLineRow[]): StoredOrderLine[] {
  if (stored.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }
  // `parentLineNo` is rebuilt in the array-position space `grossRows` renumbers into (`i + 1`), NOT
  // the stored `line_no` space: a void or a transfer leaves stored numbers with gaps, and keying on
  // them would file a child under the wrong parent in the immutable record.
  const positionById = new Map(stored.map((line, i) => [line.id, i + 1]));
  return stored.map((line) => ({
    identity: {
      id: line.id,
      productId: line.productId,
      classification: line.classification,
      listUnitGross:
        line.listUnitPriceGross === null ? null : centsToDecimal(line.listUnitPriceGross),
    },
    locked: {
      grossUnitPrice: centsToDecimal(line.grossUnitPrice),
      quantity: thousandthsToDecimal(line.quantity),
      priceQuantity: thousandthsToDecimal(line.priceQuantity),
      name: line.name,
      descriptions: line.descriptions,
      optionSnapshots: line.optionSnapshots.map(optionSnapshotNames),
      category: line.category,
      unitName: line.unitName,
      unitPrecision: line.unitPrecision,
      parentLineNo:
        line.parentLineId == null ? null : (positionById.get(line.parentLineId) ?? null),
      variantName: line.variantName,
      variantDescriptions: line.variantDescriptions,
      variantKitchenName: line.variantKitchenName,
      kitchenName: line.kitchenName,
      ...(line.setMenuRole === null ? {} : { setMenuRole: line.setMenuRole }),
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
  /** Recorded when the line was added. */
  classification: SaleLineClassification | null;
  /** The unit price before a comp or a discount changed it, or null. */
  listUnitGross: Decimal | null;
  /** Set on every row of an order holding a bound portion: every working line the row stands for,
   * `id` first. Absent on every row of an order holding none. */
  lineIds?: string[];
  /** The dish lines the sale row represents. An extra links to its parents. Unbound rows have none. */
  dishLineIds?: string[];
}
/** Gross lines together with, at the same index, the working-order line each was priced from. */
export interface GrossOrder {
  gross: GrossLines;
  identities: OrderLineIdentity[];
}
/** A persisted order's gross lines exactly as they are stored, to rebuild a filed ticket's lines or
 * total a bill. A rebuilt ticket takes its VAT breakdown from the filed record. */
export async function priceStoredOrder(
  tx: Transaction,
  workingOrderId: string,
): Promise<GrossLines> {
  return (await readStoredOrder(tx, workingOrderId)).gross;
}
/** What a persisted order's stored lines total, the figure its invoice is issued at; a lineless
 * order totals nothing. */
export async function storedOrderTotal(tx: Transaction, workingOrderId: string): Promise<Decimal> {
  return (await hasStoredLines(tx, workingOrderId))
    ? (await priceStoredOrder(tx, workingOrderId)).total
    : decimal("0.00");
}
/** Whether the order holds any line, so {@link readStoredOrder} can read it without refusing. */
export async function hasStoredLines(tx: Transaction, workingOrderId: string): Promise<boolean> {
  const [line] = await tx
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, workingOrderId))
    .limit(1);
  return line !== undefined;
}
/** An order's {@link storedOrderTotal} before an edit, for {@link refuseOrderOverSimplifiedLimit};
 * null, and nothing read, where the regime sets no limit. */
export async function totalBeforeEdit(
  tx: Transaction,
  cfg: TradingContext,
  workingOrderId: string,
): Promise<Decimal | null> {
  return cfg.simplifiedInvoiceLimit === null ? null : storedOrderTotal(tx, workingOrderId);
}
/** A saved F1 choice has no simplified ceiling. An F2 already over its ceiling can shrink
 * without first becoming payable. */
export async function refuseOrderOverSimplifiedLimit(
  tx: Transaction,
  cfg: TradingContext,
  workingOrderId: string,
  before: Decimal | null,
): Promise<void> {
  if (cfg.simplifiedInvoiceLimit === null) return;
  const [order] = await tx
    .select({ invoiceType: workingOrders.invoiceType })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  if (order?.invoiceType === "F1") return;
  const after = await storedOrderTotal(tx, workingOrderId);
  if (before !== null && compareDecimal(after, before) <= 0) return;
  refuseOverSimplifiedLimit(cfg.simplifiedInvoiceLimit, after);
}
/** {@link priceStoredOrder}, with the working-order line each gross line was priced from. */
export async function readStoredOrder(
  tx: Transaction,
  workingOrderId: string,
): Promise<GrossOrder> {
  const stored = await readLockedLines(tx, workingOrderId);
  return {
    gross: grossLockedLines(stored.map(({ locked }) => locked)),
    identities: stored.map(({ identity }) => identity),
  };
}
/**
 * Use `refuseUnsentUnavailable: false` only to record money already captured. That path must
 * still record it after product archival or on a takeaway bill holding a set menu.
 */
export async function priceStoredOrderForIssuance(
  tx: Transaction,
  workingOrderId: string,
  options: { refuseUnsentUnavailable: boolean } = { refuseUnsentUnavailable: true },
): Promise<GrossOrder> {
  const { lines, grouped, rates } = await readLockedLinesForIssuance(
    tx,
    workingOrderId,
    options.refuseUnsentUnavailable,
  );
  const unpayable = lines.find((line) => !line.payable);
  if (options.refuseUnsentUnavailable && unpayable !== undefined) {
    throw new AppError("product.unavailable", { productId: unpayable.identity.productId! });
  }
  return {
    gross: grossLockedLines(
      grouped.map(({ locked }) => locked),
      rates,
    ),
    identities: grouped.map(({ identity }) => identity),
  };
}
/** Read a filed sale's invoice number ("A/1"); the fiscal record reference is regime-opaque and
 * carries none. */
export async function readInvoiceNumber(tx: Transaction, saleId: SaleId): Promise<string> {
  return (await readInvoiceNumbers(tx, [saleId])).get(saleId)!;
}
/** {@link readInvoiceNumber} of each named sale, by sale id, in one read. */
export async function readInvoiceNumbers(
  tx: Transaction,
  saleIds: readonly string[],
): Promise<Map<string, string>> {
  if (saleIds.length === 0) return new Map();
  const issued = await tx
    .select({ id: sales.id, code: invoiceSeries.code, number: sales.invoiceNumber })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(inArray(sales.id, [...saleIds]));
  return new Map(issued.map((row) => [row.id, formatInvoiceNumber(row.code, row.number)]));
}
/** Surcharge fields a VAT band may carry are dropped deliberately: the counter ticket carries base
 * and tax only. */
export function toVatBreakdown(
  bands: readonly { rate: string; base: string; tax: string }[],
): { rate: string; base: string; tax: string }[] {
  return bands.map((v) => ({ rate: v.rate, base: v.base, tax: v.tax }));
}
/** Assert a working order is OPEN, else `tab.not_open`; its revision. */
export async function assertTabOpen(tx: Transaction, tabId: string): Promise<number> {
  const [tab] = await tx
    .select({ status: workingOrders.status, revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, tabId));
  if (tab === undefined || tab.status !== "open") {
    throw new AppError("tab.not_open", { tabId });
  }
  return tab.revision;
}
/** One line of a bill. `unitPriceGross` is the gross unit price LOCKED at add time, NOT a
 *  re-price. */
export interface TabLine {
  nutrition?: LineNutrition;
  /** The row's id, which a group move names. A dish in an order group is listed by it in the group's
   *  `lineIds`; a child extras row never is (`readGroups`, `apps/server/src/order-group-reads.ts`). */
  id: string;
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
  /** Part of the billed quantity cancelled without removing its charge. */
  cancelledQuantity?: string;
  /** Physical amount represented by one priced portion, frozen with the line. */
  priceQuantity: string;
  /** Decimal places the line's unit takes, frozen at add time (0 = sold by the unit). */
  unitPrecision: number | null;
  unitPriceGross: string;
  /** The unit price the line had before a comp or a discount changed it; absent on a line no
   * adjustment has touched. */
  listUnitPriceGross?: string;
  servedAt: string | null;
  courseId: string | null;
  course?: { id: string; name: string; displayOrder: number };
  /** When the line was first released: fired, or for a no-preparation line, when it would have
   * fired. */
  sentAt: string | null;
  /** Null while the line is held or Requested, or has no ticket item at all. A following extra has
   * none; a split-off extra has its own. A parent can lack one too: `openTab` inserts its initial
   * lines without firing. */
  firedAt: string | null;
  /** Null when the line has no ticket item. A following extra has none; a split-off extra has its own. */
  state: TicketState | null;
  stationId: string | null;
  /** The line's own station's choice; null when the line has no kitchen record. */
  changesAfterSending: ChangesAfterSending | null;
  movable: boolean;
  /** The order group the line is released with; null when it is in none, as on a bill with no party
   * or for a line moved here from another party's bill. */
  groupId: string | null;
  /** On a dish its held group has still to release, by the rule of the order screen's `released`;
   * absent otherwise. */
  waitsInHeldGroup?: true;
  note: string | null;
  /** The extras list a CHILD row was picked from; null on a dish. */
  listId: string | null;
  /** The offer the line was sold under (a child row's is its dish's); null on a line with no
   * recorded service context. */
  menuItemId: string | null;
  /** On a dish sold as a variant, `productId` names the variant and this its parent product;
   * otherwise null. */
  parentProductId: string | null;
  /** True on a dish line bound to a whole, unmeasured portion: only those may share a till row. */
  portion: boolean;
}
/** Counter collection still needs the dish details after placing, while edits retain their open-order guard. */
export async function readTabLines(tx: Transaction, tabId: string): Promise<TabLine[]> {
  const [order] = await tx
    .select({ status: workingOrders.status, partyId: workingOrders.partyId })
    .from(workingOrders)
    .where(eq(workingOrders.id, tabId));
  if (
    order === undefined ||
    (order.status !== "open" && !(order.status === "placed" && order.partyId === null))
  ) {
    throw new AppError("tab.not_open", { tabId });
  }
  return readBillLines(tx, tabId);
}
/** A bill's lines whatever its status, in line-number order, at their stored prices. */
export async function readBillLines(tx: Transaction, tabId: string): Promise<TabLine[]> {
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
      priceQuantity: workingOrderLines.priceQuantity,
      unitPrecision: workingOrderLines.unitPrecision,
      unitPriceGross: workingOrderLines.unitPriceGross,
      listUnitPriceGross: workingOrderLines.listUnitPriceGross,
      servedAt: workingOrderLines.servedAt,
      servedQuantity: workingOrderLines.servedQuantity,
      courseId: workingOrderLines.courseId,
      course: {
        id: kitchenCourses.id,
        name: kitchenCourses.name,
        displayOrder: kitchenCourses.displayOrder,
      },
      sentAt: workingOrderLines.sentAt,
      ticketItemId: ticketItems.id,
      requestedAt: ticketItems.requestedAt,
      firedAt: ticketItems.firedAt,
      state: ticketItems.state,
      stationId: ticketItems.stationId,
      changesAfterSending: kitchenStations.changesAfterSending,
      madeHere: ticketItems.madeHere,
      groupId: workingOrderLines.groupId,
      groupState: orderGroups.state,
      note: workingOrderLines.note,
      listId: workingOrderLines.extraListId,
      productParentId: products.parentId,
      wholePortion: workingOrderLines.wholePortion,
    })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .leftJoin(lineServiceCancellations, eq(lineServiceCancellations.lineId, workingOrderLines.id))
    .leftJoin(kitchenStations, eq(kitchenStations.id, ticketItems.stationId))
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(kitchenCourses, eq(kitchenCourses.id, workingOrderLines.courseId))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);
  const contexts = await VENUE_SERVICE.listLineContexts(tx, tabId);
  const nutrition = await readDisplayLineNutrition(tx, rows);
  const menuItemByLine = new Map(
    contexts.map((context) => [context.workingOrderLineId, context.menuItemId]),
  );
  // The stored `line_no` is what this read returns, so, unlike `readLockedLines`, no renumbering.
  const lineNoById = new Map(rows.map((row) => [row.id, row.lineNo]));
  const cancellations = await readLineCancellations(
    tx,
    rows.map((row) => row.id),
  );
  const heldExtras = dishesWithHeldExtra(
    rows.map((row) => ({
      parentLineId: row.parentLineId,
      ticketItemId: row.ticketItemId,
      ticketRequestedAt: row.requestedAt,
      ticketFiredAt: row.firedAt,
    })),
  );
  return rows.map((row) => {
    const sold = soldProduct(row);
    const waits =
      row.parentLineId === null &&
      dishWaitsInHeldGroup(
        {
          groupState: row.groupState,
          ticketItemId: row.ticketItemId,
          ticketFiredAt: row.firedAt,
          ticketRequestedAt: row.requestedAt,
          ticketMadeHere: row.madeHere,
          sentAt: row.sentAt,
          quantity: row.quantity,
          cancelledQuantity: cancellations.get(row.id) ?? 0,
        },
        heldExtras.has(row.id),
      );
    return {
      id: row.id,
      ...(nutrition.has(row.id) ? { nutrition: nutrition.get(row.id)! } : {}),
      lineNo: row.lineNo,
      name: staffPresentationName({ name: row.name, variantName: row.variantName }),
      optionSnapshots: row.optionSnapshots,
      productId: row.productId,
      parentLineNo: row.parentLineId === null ? null : (lineNoById.get(row.parentLineId) ?? null),
      quantity: thousandthsToDecimal(row.quantity),
      ...((cancellations.get(row.id) ?? 0) > 0
        ? { cancelledQuantity: thousandthsToDecimal(cancellations.get(row.id)!) }
        : {}),
      priceQuantity: thousandthsToDecimal(row.priceQuantity),
      unitPrecision: row.unitPrecision,
      unitPriceGross: centsToDecimal(row.unitPriceGross),
      ...(row.listUnitPriceGross === null
        ? {}
        : { listUnitPriceGross: centsToDecimal(row.listUnitPriceGross) }),
      servedAt: row.servedAt,
      courseId: row.courseId,
      ...(row.course === null ? {} : { course: row.course }),
      sentAt: row.sentAt,
      firedAt: row.firedAt,
      state: row.state,
      stationId: row.stationId,
      changesAfterSending: row.changesAfterSending,
      movable:
        row.state !== null && stillMovable({ state: row.state, madeHere: row.madeHere! }, row),
      groupId: row.groupId,
      ...(waits ? { waitsInHeldGroup: true as const } : {}),
      note: row.note,
      listId: row.listId,
      menuItemId: menuItemByLine.get(row.id) ?? null,
      parentProductId: sold.variantId === null ? null : sold.productId,
      portion: row.wholePortion === true,
    };
  });
}
/**
 * A dish sold as a variant stores the variant as its product; the dish the till rebuilds is the
 * variant's parent, with the variant chosen on it. A child row's product is the pick itself and is
 * kept as it is, a variant or not.
 */
export function soldProduct(line: {
  parentLineId: string | null;
  productId: string | null;
  productParentId: string | null;
}): { productId: string | null; variantId: string | null } {
  const variantId =
    line.parentLineId === null && line.productParentId !== null ? line.productId : null;
  return { productId: variantId === null ? line.productId : line.productParentId, variantId };
}
