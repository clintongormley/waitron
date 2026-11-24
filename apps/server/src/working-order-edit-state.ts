import "./errors.js";
import {
  workingOrderLines,
  type Transaction,
  workingOrders,
  billPayments,
  refunds,
  products,
  lineServiceCancellations,
  orderGroups,
  ticketItems,
} from "@waitron/db";
import { parentProducts, parentJoin } from "@waitron/menu";
import {
  type ExtraSelection,
  type OptionSelection,
  type Dining,
  type Decimal,
  type OptionSnapshot,
  AppError,
  thousandthsToDecimal,
  centsToDecimal,
} from "@waitron/shared";
import { eq, and, inArray, sql } from "drizzle-orm";
import type { OrderEditAuthority } from "./bill-editing.js";
import { initiatedAt } from "./kitchen-phase.js";
import { firedQuantity } from "./kitchen-print.js";
import type { LateSendConfirmation } from "./late-send.js";
import { VENUE_SERVICE } from "./modules.js";
import { partyOfOrder } from "./parties.js";
import type { SET_MENU_DRAFT_LINE, SetMenuDraftLine } from "./set-menu-bill.js";
import { productSellable } from "./stored-order-lines.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import type { TillSaleDeps } from "./working-order-context.js";
import type { LineExtras, priceOrderLines } from "./working-order-pricing.js";
import type { TicketState } from "./kitchen-print.js";

/**
 * The complete edited basket and an optional label. A line naming a stored line by
 * `workingOrderLineId`, with the same offer and variant, is an edit of it; any other line is new. A
 * stored line the basket does not name is removed. The request never supplies a price.
 */
export interface UpdateHeldOrderRequest {
  expectedEdit: OrderEditAuthority["expectedEdit"];
  lines: ({
    workingOrderLineId?: string;
    menuItemId: string;
    quantity: string;
    extras?: ExtraSelection[];
    options?: OptionSelection[];
    [SET_MENU_DRAFT_LINE]?: SetMenuDraftLine;
  } & LineExtras)[];
  label?: string;
  revision: number;
  /** Who saves: credited with the lines the save adds, and named by a group it starts or removes. */
  operatorId?: string;
  /**
   * The request's confirmation of the save's fresh dishes, and extras added to stored dishes, whose
   * period ended earlier today.
   */
  lateSend?: LateSendConfirmation;
  /** The way the till showed; refused `working_order.out_of_date` when the order has the other. */
  dining?: Dining;
}
/** What {@link updateHeldOrder} needs to issue the bill's invoice when the save leaves it fully paid. */
export interface IssueOnSave {
  fiscal: TillSaleDeps;
  saleCfg: DeviceRequestConfig;
}
/** What `PUT /api/working-orders/:id/lines/:lineNo` changes on one line; an absent optional field is kept. */
export interface OrderLinePatch {
  makeAt?: string | null;
  quantity?: string;
  note?: string | null;
  options?: OptionSelection[];
  extras?: ExtraSelection[];
  /**
   * The other dishes of the URL line's Sent row, changed with it in one save. `quantity`
   * is the row's total and may only rise; nothing is removed this way.
   */
  portionLineNos: number[];
}
/** A stored line as the edit path reads it, with its ticket item's kitchen state. */
export interface EditableLine {
  id: string;
  cancelledQuantity: number;
  lineNo: number;
  parentLineId: string | null;
  productId: string | null;
  setMenuRole: (typeof workingOrderLines.$inferSelect)["setMenuRole"];
  setMenuId: string | null;
  menuVersionId: string | null;
  /** Set on a variant line: the variant's parent, the dish whose lists the line answered. */
  parentProductId: string | null;
  quantity: Decimal;
  priceQuantity: Decimal;
  unitPriceGross: Decimal;
  unitPrecision: number | null;
  note: string | null;
  optionSnapshots: OptionSnapshot[];
  extraListId: string | null;
  courseId: string | null;
  makeAtStationId: string | null;
  sentAt: string | null;
  groupId: string | null;
  groupState: string | null;
  creditedTo: string | null;
  /** A comp or discount has set its price (`list_unit_price_gross` is set). */
  adjusted: boolean;
  ticket: {
    id: string;
    requestedAt: string | null;
    holdPaperQueued: boolean;
    firedAt: string | null;
    state: TicketState;
    stationId: string;
    stationChosenAt: string | null;
    courseId: string | null;
    madeHere: boolean;
    sentOrderNumber: number | null;
    /** Thousandths. */
    firedQuantity: number;
  } | null;
  /** Thousandths. */
  servedQuantity: number;
}
/** A stored dish line, its extras children and the offer it was sold through. */
export interface EditableParent extends EditableLine {
  menuItemId: string | undefined;
  children: EditableLine[];
}
export interface EditableOrder {
  /** The party the order belongs to; null for a counter order or a bill of no party. */
  partyId: string | null;
  lines: EditableLine[];
  parents: EditableParent[];
  maxLineNo: number;
  /**
   * What a line the edit adds gets from the kitchen: `fire` where some line of the order was sent
   * outside a held group, as a round's line would; a sent made-here line in a held group counts
   * as held work. `hold` where the kitchen holds items or a group holds lines; `none` where the order has no ticket item, no
   * grouped line and nothing sent, as a parked counter order, whose lines are fired when it is
   * placed.
   */
  newWork: "fire" | "hold" | "none";
  /** The courses in which the kitchen already has fired work, read before the edit changes any. */
  firedCourseIds: Set<string>;
}
/** Whether the dish or any of its extras is Requested: sent by the waiter and not yet fired. */
export function hasRequestedPart(parent: EditableParent): boolean {
  return [parent, ...parent.children].some(
    ({ ticket }) => ticket !== null && ticket.firedAt === null && ticket.requestedAt !== null,
  );
}
/**
 * What a line the kitchen has not fired is waiting for, in {@link EditableOrder.newWork}'s terms: a
 * Requested item was sent by the waiter; a held item waits to be sent; a line with no
 * item was released when it was stamped sent, waits in its held group when it has one, and is
 * otherwise a line nothing has sent.
 */
export function kitchenStateOf(line: EditableLine): EditableOrder["newWork"] {
  if (line.ticket !== null) return initiatedAt(line.ticket) === null ? "hold" : "fire";
  if (line.sentAt !== null) return "fire";
  return line.groupId === null ? "none" : "hold";
}
/** What an edit asks of one stored dish line. `null` options or extras keep the stored ones. */
export interface LineIntent {
  makeAt?: string | null;
  quantity: string;
  note: string | null;
  options: { set: unknown } | null;
  extras: { set: unknown } | null;
}
export type RequestedLine = Parameters<typeof priceOrderLines>[3][number];
/**
 * An OPEN order, else `working_order.not_open`, whose revision is `revision`, else
 * `working_order.out_of_date`.
 */
export async function requireEditableOrder(
  tx: Transaction,
  orderId: string,
  revision: number,
): Promise<{ label: string | null }> {
  const [order] = await tx
    .select({
      status: workingOrders.status,
      revision: workingOrders.revision,
      label: workingOrders.label,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  if (order === undefined || order.status !== "open") {
    throw new AppError("working_order.not_open", { workingOrderId: orderId });
  }
  if (revision !== order.revision) {
    throw new AppError("working_order.out_of_date", {
      workingOrderId: orderId,
      revision: order.revision,
    });
  }
  return { label: order.label };
}
/**
 * Refuse `bill.refund_in_progress` while a card refund of any of these bills is pending (bill
 * payments design §5.2, §6b): until its outcome is known, the money the bill has received is not
 * known either.
 */
export async function refuseRefundInProgress(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<void> {
  const [pending] = await tx
    .select({ workingOrderId: billPayments.workingOrderId })
    .from(refunds)
    .innerJoin(billPayments, eq(billPayments.id, refunds.billPaymentId))
    .where(and(inArray(billPayments.workingOrderId, [...orderIds]), eq(refunds.state, "pending")))
    .orderBy(billPayments.workingOrderId)
    .limit(1);
  if (pending !== undefined) {
    throw new AppError("bill.refund_in_progress", { workingOrderId: pending.workingOrderId });
  }
}
/**
 * Refuse while money on any of these OPEN orders is moving: `bill.refund_in_progress` for a pending
 * card refund, else `order.payment_in_flight` for a pending card payment. Every line write
 * that can change the bill's total stops here,
 * because the capture that completes the bill invoices it from that total; a served mark
 * (`writeServed`) does not.
 */
export async function refusePaymentInFlight(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<void> {
  await refuseRefundInProgress(tx, orderIds);
  await refusePendingPartPayment(tx, orderIds, "open");
}
/** Refuse `order.payment_in_flight` while a card part payment of one of these orders is pending;
 * `"open"` looks only at open orders. */
export async function refusePendingPartPayment(
  tx: Transaction,
  orderIds: readonly string[],
  orders: "open" | "any",
): Promise<void> {
  const [pending] = await tx
    .select({ workingOrderId: billPayments.workingOrderId })
    .from(billPayments)
    .innerJoin(workingOrders, eq(workingOrders.id, billPayments.workingOrderId))
    .where(
      and(
        inArray(billPayments.workingOrderId, [...orderIds]),
        eq(billPayments.state, "pending"),
        orders === "open" ? eq(workingOrders.status, "open") : undefined,
      ),
    )
    .orderBy(billPayments.workingOrderId)
    .limit(1);
  if (pending !== undefined) {
    throw new AppError("order.payment_in_flight", { workingOrderId: pending.workingOrderId });
  }
}
/**
 * Count one more write on each OPEN order named; a settled or placed order's revision stays. It
 * refuses first (`refusePaymentInFlight`), so a write that ends here is refused on an order being
 * paid, rolling back what it did before. A served mark does not end here (`writeServed`).
 */
export async function bumpRevision(tx: Transaction, orderIds: readonly string[]): Promise<void> {
  await refusePaymentInFlight(tx, orderIds);
  await bumpRevisionKeepingPayment(tx, orderIds);
}
/** {@link bumpRevision} without the refusal, for a write that changes nothing the bill charges. */
export async function bumpRevisionKeepingPayment(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<void> {
  await tx
    .update(workingOrders)
    .set({ revision: sql`${workingOrders.revision} + 1` })
    .where(and(inArray(workingOrders.id, [...orderIds]), eq(workingOrders.status, "open")));
}
export async function readEditableOrder(tx: Transaction, orderId: string): Promise<EditableOrder> {
  const rows = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      productId: workingOrderLines.productId,
      setMenuRole: workingOrderLines.setMenuRole,
      setMenuId: workingOrderLines.setMenuId,
      menuVersionId: workingOrderLines.menuVersionId,
      parentProductId: products.parentId,
      quantity: workingOrderLines.quantity,
      cancelledQuantity: lineServiceCancellations.quantity,
      priceQuantity: workingOrderLines.priceQuantity,
      unitPriceGross: workingOrderLines.unitPriceGross,
      listUnitPriceGross: workingOrderLines.listUnitPriceGross,
      unitPrecision: workingOrderLines.unitPrecision,
      note: workingOrderLines.note,
      optionSnapshots: workingOrderLines.optionSnapshots,
      extraListId: workingOrderLines.extraListId,
      courseId: workingOrderLines.courseId,
      makeAtStationId: workingOrderLines.makeAtStationId,
      sentAt: workingOrderLines.sentAt,
      groupId: workingOrderLines.groupId,
      groupState: orderGroups.state,
      creditedTo: workingOrderLines.creditedTo,
      ticketId: ticketItems.id,
      requestedAt: ticketItems.requestedAt,
      holdPaperQueued: ticketItems.holdPaperQueued,
      firedAt: ticketItems.firedAt,
      state: ticketItems.state,
      stationId: ticketItems.stationId,
      stationChosenAt: ticketItems.stationChosenAt,
      ticketCourseId: ticketItems.courseId,
      madeHere: ticketItems.madeHere,
      sentOrderNumber: ticketItems.sentOrderNumber,
      firedQuantity,
      servedQuantity: workingOrderLines.servedQuantity,
    })
    .from(workingOrderLines)
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .leftJoin(lineServiceCancellations, eq(lineServiceCancellations.lineId, workingOrderLines.id))
    .where(eq(workingOrderLines.workingOrderId, orderId))
    .orderBy(workingOrderLines.lineNo);
  const lines: EditableLine[] = rows.map((row) => ({
    id: row.id,
    lineNo: row.lineNo,
    parentLineId: row.parentLineId,
    productId: row.productId,
    parentProductId: row.parentProductId,
    setMenuRole: row.setMenuRole,
    setMenuId: row.setMenuId,
    menuVersionId: row.menuVersionId,
    quantity: thousandthsToDecimal(row.quantity),
    cancelledQuantity: row.cancelledQuantity ?? 0,
    priceQuantity: thousandthsToDecimal(row.priceQuantity),
    unitPriceGross: centsToDecimal(row.unitPriceGross),
    unitPrecision: row.unitPrecision,
    note: row.note,
    optionSnapshots: row.optionSnapshots,
    extraListId: row.extraListId,
    courseId: row.courseId,
    makeAtStationId: row.makeAtStationId,
    sentAt: row.sentAt,
    groupId: row.groupId,
    groupState: row.groupState,
    creditedTo: row.creditedTo,
    adjusted: row.listUnitPriceGross !== null,
    ticket:
      row.ticketId === null
        ? null
        : {
            id: row.ticketId,
            requestedAt: row.requestedAt,
            holdPaperQueued: row.holdPaperQueued!,
            firedAt: row.firedAt,
            state: row.state!,
            stationId: row.stationId!,
            stationChosenAt: row.stationChosenAt,
            courseId: row.ticketCourseId,
            madeHere: row.madeHere!,
            sentOrderNumber: row.sentOrderNumber,
            firedQuantity: row.firedQuantity,
          },
    servedQuantity: row.servedQuantity,
  }));
  const menuItemByLine = new Map(
    (await VENUE_SERVICE.listLineContexts(tx, orderId)).map((line) => [
      line.workingOrderLineId,
      line.menuItemId,
    ]),
  );
  const parents = lines
    .filter((line) => line.parentLineId === null && line.setMenuRole !== "set_menu")
    .map((line) => ({
      ...line,
      menuItemId: menuItemByLine.get(line.id),
      children: lines.filter((child) => child.parentLineId === line.id),
    }));
  const partyId = await partyOfOrder(tx, orderId);
  return {
    partyId,
    lines,
    parents,
    maxLineNo: Math.max(0, ...lines.map((line) => line.lineNo)),
    newWork: rows.some(
      (line) =>
        (partyId !== null || line.setMenuRole !== "set_menu") &&
        line.sentAt !== null &&
        (!line.madeHere || line.groupState !== "held"),
    )
      ? "fire"
      : lines.some((line) => line.ticket !== null || line.groupId !== null)
        ? "hold"
        : "none",
    firedCourseIds: new Set(
      lines
        .filter(
          (line) =>
            line.ticket?.firedAt != null && !line.ticket.madeHere && line.ticket.courseId !== null,
        )
        .map((line) => line.ticket!.courseId!),
    ),
  };
}
/** Refuse `product.unavailable` for the first of these products that cannot be sold now. */
export async function assertProductsSellable(
  tx: Transaction,
  productIds: readonly string[],
): Promise<void> {
  if (productIds.length === 0) return;
  const [refused] = await tx
    .select({ id: products.id })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(and(inArray(products.id, [...productIds]), sql`not ${productSellable}`))
    .limit(1);
  if (refused !== undefined) {
    throw new AppError("product.unavailable", { productId: refused.id });
  }
}
