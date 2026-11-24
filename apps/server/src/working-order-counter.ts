import "./errors.js";
import { withIssuanceTransaction } from "@waitron/core";
import {
  withTransaction,
  workingOrders,
  workingOrderLines,
  nowIso,
  type Transaction,
  appendOrderAmendment,
  ticketItems,
  orderTableLabels,
} from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { type PinAttempts, type Override, authorize } from "@waitron/identity";
import type { ServiceMode } from "@waitron/module";
import { AppError, rawCentsToDecimal } from "@waitron/shared";
import { eq, and, isNull, sql, isNotNull, gt, or, inArray } from "drizzle-orm";
import { type AttendanceRecorder, captureKitchenActivity } from "./attendance-capture.js";
import { type OrderEditAuthority, requireOrderBillEditor } from "./bill-editing.js";
import { refuseBillWithPayments, refuseBillHoldingMoney } from "./bill-payments.js";
import {
  creditWholeInvoice,
  readOrderInvoice,
  type IssuedInvoice as OrderInvoice,
} from "./cancel-credit.js";
import { readFormerNumbers } from "./former-numbers.js";
import { firedQuantity, enqueueCorrectionSlips, isStarted } from "./kitchen-print.js";
import type { LateSendConfirmation } from "./late-send.js";
import { captureSentLineNutrition } from "./line-nutrition.js";
import { VENUE_SERVICE } from "./modules.js";
import { type OrderPreviewItem, readOrderPreviewItems } from "./order-preview.js";
import { type OrderStateCounts, readOrderStateCounts } from "./order-state-counts.js";
import {
  runServiceCommand,
  ensureFamilyBill,
  bumpPartyRevision,
  readDeferredBillIds,
} from "./parties.js";
import { overrideToCheck, withPinCheckAhead, withCheck } from "./pin-check-ahead.js";
import { enqueueCollectionTicket } from "./receipt-print.js";
import { readIssuedSales } from "./sale-due.js";
import { stillMovable } from "./station-move.js";
import { readInvoiceNumbers } from "./stored-order-lines.js";
import { ordersWithUnfiledPayment } from "./till-sale.js";
import { requireEconomicWrite } from "./trading-admission.js";
import type { DeviceRequestConfig, OriginConfig, TradingContext } from "./trading-context.js";
import {
  type TillSaleDeps,
  type WorkingOrderDeps,
  type OrderAttendance,
  paysAfterSending,
} from "./working-order-context.js";
import { refusePaymentInFlight, refusePendingPartPayment } from "./working-order-edit-state.js";
import { unsentDishLines, assertSendable, fireLines } from "./working-order-kitchen-fire.js";
import { lateUnsentDishes } from "./working-order-late-send.js";
import { optional } from "./working-order-station-queue.js";

export interface PlaceOrderResult {
  id: string;
  status: "placed";
}

export async function placeOrder(
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  id: string,
  operatorId: string,
  expectedEdit: OrderEditAuthority["expectedEdit"],
  lateSend?: LateSendConfirmation,
): Promise<PlaceOrderResult> {
  return withTransaction(deps.db, (tx) =>
    runServiceCommand(
      tx,
      { kind: "bill", workingOrderId: id },
      `place:${id}`,
      "order.place",
      { workingOrderId: id, operatorId, origin: cfg.origin, expectedEdit },
      async () => {
        const [locked] = await tx
          .select({ status: workingOrders.status, orderNumber: workingOrders.orderNumber })
          .from(workingOrders)
          .where(eq(workingOrders.id, id));
        if (locked === undefined || locked.status !== "open") {
          throw new AppError("working_order.not_open", { workingOrderId: id });
        }
        await requireOrderBillEditor(tx, id, { operatorId, expectedEdit });
        await refusePaymentInFlight(tx, [id]);
        await refuseBillWithPayments(tx, id);
        const serviceContext = await VENUE_SERVICE.findOrderContext(tx, id);
        const orderFlow = serviceContext?.serviceMode ?? "prepay";
        // Placing changes no line's quantity, course or note, so the lines read now are the ones fired.
        // Read before the stamp below. A bill moved here from a table has dishes already sent.
        const lines = await unsentDishLines(tx, id);
        await assertSendable(
          tx,
          lines.map((line) => line.id),
        );
        await lateUnsentDishes(tx, id, lines, { ask: lateSend });
        // Placing commits the whole order, a course the kitchen holds included, so every line is sent.
        const stamped = await tx
          .update(workingOrderLines)
          .set({ sentAt: nowIso() })
          .where(and(eq(workingOrderLines.workingOrderId, id), isNull(workingOrderLines.sentAt)))
          .returning({ id: workingOrderLines.id });
        await captureSentLineNutrition(
          tx,
          stamped.map((row) => row.id),
        );

        await markOrderPlaced(tx, deps.clock, cfg, id, operatorId, deps.attendance);

        if (orderFlow === "ticket_then_pay" && serviceContext !== null) {
          await enqueueCollectionTicket(tx, cfg, serviceContext.zoneId, locked.orderNumber);
        }

        await fireLines(tx, cfg, id, lines);

        return { id, status: "placed" as const };
      },
      cfg.madeHereSink,
    ),
  );
}

async function captureOrderAmendment(
  tx: Transaction,
  attendance: AttendanceRecorder | undefined,
  amendmentId: string,
  personId: string,
  at: Date,
): Promise<void> {
  if (attendance === undefined) return;
  await attendance(tx, {
    source: "order",
    key: amendmentId,
    personId,
    kind: "order",
    at: at.toISOString(),
    offsetMinutes: 0,
    outcome: "qualified",
  });
}
/** An open order becomes placed, and its `order_placed` amendment is appended. */
export async function markOrderPlaced(
  tx: Transaction,
  clock: TrustedClock,
  cfg: OriginConfig,
  id: string,
  operatorId: string,
  attendance?: AttendanceRecorder,
): Promise<void> {
  await tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, id));

  const now = clock.now();
  const amendment = await appendOrderAmendment(tx, {
    workingOrderId: id,
    kind: "order_placed",
    actorId: operatorId,
    reason: null,
    origin: cfg.origin,
    capturedByNodeId: cfg.nodeId,
    eventAt: now.instant,
    eventOffsetMinutes: now.offsetMinutes,
  });
  await captureOrderAmendment(tx, attendance, amendment.id, operatorId, now.instant);
}
/** Cancel a placed order, crediting an issued invoice only with `sale.rectify`. */
export async function cancelPlacedOrder(
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  id: string,
  reason: string,
  operator: { personId: string; sessionId: string; attempts: PinAttempts },
  override?: Override,
): Promise<void> {
  // The reason is the amendment's accountable content. Checked before the status, so a missing reason
  // is a request-shape error, not the state conflict `not_placed` names.
  if (reason.trim() === "") {
    throw new AppError("working_order.reason_required", { workingOrderId: id });
  }
  await withRectifyPinAhead(deps, id, operator, override, (checkedOverride) =>
    withIssuanceTransaction(deps.db, async (tx) => {
      const authz = { sessionId: operator.sessionId, override: checkedOverride };
      const { partyId, invoice } = await lockPlacedOrder(tx, deps, cfg, id);
      if (invoice !== undefined) {
        await authorize(tx, { ...authz, permission: "sale.rectify" }, operator.attempts);
      }
      await refusePlacedOrderMoney(tx, id);
      if (invoice !== undefined) await creditWholeInvoice(tx, deps, cfg, invoice, authz);
      await abandonPlacedOrder(tx, cfg, id);
      if (partyId !== null && (await ensureFamilyBill(tx, cfg, partyId))) {
        await bumpPartyRevision(tx, partyId);
      }
      await recordPlacedOrderCancelled(tx, deps, cfg, id, operator.personId, reason);
    }),
  );
}
/**
 * Runs `transaction` with the override it should check, its PIN checked ahead when the order has an
 * invoice to credit under `sale.rectify` ({@link withPinCheckAhead}).
 */
export async function withRectifyPinAhead<T>(
  deps: Pick<TillSaleDeps, "db">,
  id: string,
  operator: { sessionId: string; attempts: PinAttempts },
  override: Override | undefined,
  transaction: (override: Override | undefined) => Promise<T>,
): Promise<T> {
  const toCheck =
    (await readOrderInvoice(deps.db, id)) === undefined
      ? undefined
      : await overrideToCheck(
          deps.db,
          { sessionId: operator.sessionId, permission: "sale.rectify" },
          override,
        );
  return withPinCheckAhead(deps.db, toCheck, operator.attempts, (checked) =>
    transaction(withCheck(override, checked)),
  );
}
/** The placed order's party and invoice, else `working_order.not_placed`. */
export async function lockPlacedOrder(
  tx: Transaction,
  deps: Pick<TillSaleDeps, "admission">,
  cfg: DeviceRequestConfig,
  id: string,
): Promise<{ partyId: string | null; invoice: OrderInvoice | undefined }> {
  await requireEconomicWrite(tx, cfg, deps.admission);
  const [locked] = await tx
    .select({
      status: workingOrders.status,
      partyId: workingOrders.partyId,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, id));
  if (locked === undefined || locked.status !== "placed") {
    throw new AppError("working_order.not_placed", { workingOrderId: id });
  }
  return { partyId: locked.partyId, invoice: await readOrderInvoice(tx, id) };
}
/** Refuses a placed order holding money, or with a payment on its way. */
export async function refusePlacedOrderMoney(tx: Transaction, id: string): Promise<void> {
  await refusePendingPartPayment(tx, [id], "any");
  await refuseBillHoldingMoney(tx, [id]);
  if ((await ordersWithUnfiledPayment(tx, [id])).has(id)) {
    throw new AppError("order.payment_in_flight", { workingOrderId: id });
  }
}
/** Tells each station still making the order's dishes, then marks the order abandoned. */
export async function abandonPlacedOrder(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  id: string,
): Promise<void> {
  const toCorrect = await tx
    .select({
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      quantity: sql<number>`${firedQuantity} - ${workingOrderLines.servedQuantity}`,
      state: ticketItems.state,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(
      and(
        eq(workingOrderLines.workingOrderId, id),
        isNotNull(ticketItems.firedAt),
        isNull(workingOrders.collectedAt),
        isNull(workingOrderLines.servedAt),
        gt(firedQuantity, workingOrderLines.servedQuantity),
      ),
    );
  await enqueueCorrectionSlips(
    tx,
    cfg,
    id,
    toCorrect.map(({ state, ...item }) => ({
      ...item,
      wasStarted: isStarted(state),
    })),
    "VOID",
  );

  await tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));
}
/** Withdraws the order's pending department transfers and records its cancellation. */
export async function recordPlacedOrderCancelled(
  tx: Transaction,
  deps: Pick<TillSaleDeps, "clock" | "attendance">,
  cfg: DeviceRequestConfig,
  id: string,
  operatorId: string,
  reason: string,
): Promise<void> {
  await VENUE_SERVICE.withdrawPendingDepartmentTransfers(tx, [id]);

  const now = deps.clock.now();
  const amendment = await appendOrderAmendment(tx, {
    workingOrderId: id,
    kind: "order_cancelled",
    actorId: operatorId,
    reason,
    origin: cfg.origin,
    capturedByNodeId: cfg.nodeId,
    eventAt: now.instant,
    eventOffsetMinutes: now.offsetMinutes,
  });
  await captureOrderAmendment(tx, deps.attendance, amendment.id, operatorId, now.instant);
}
/**
 * Stamp a fired order as collected so it leaves the kitchen queue: a settled one, or a counter order
 * sent without payment in a mode that takes payment after the kitchen has it.
 */
export async function markCollected(
  deps: WorkingOrderDeps,
  cfg: TradingContext,
  id: string,
): Promise<void> {
  return withTransaction(deps.db, (tx) => handOverOrder(tx, cfg, id));
}
/**
 * {@link markCollected} in the caller's transaction. With a `submissionId` it runs at most once per
 * id on this order: a resent request answers as the first did, and the same id sent for another
 * command on this bill is `submission.id_reused`.
 */
export function handOverOrder(
  tx: Transaction,
  cfg: TradingContext,
  id: string,
  submissionId?: string,
  attendance?: OrderAttendance & { personId: string },
): Promise<void> {
  if (submissionId === undefined) return handOver(tx, id, attendance);
  return runServiceCommand(
    tx,
    { kind: "bill", workingOrderId: id },
    submissionId,
    "order.collect",
    { workingOrderId: id },
    () => handOver(tx, id, attendance),
    cfg.madeHereSink,
  );
}

async function handOver(
  tx: Transaction,
  id: string,
  attendance?: OrderAttendance & { personId: string },
): Promise<void> {
  const [order] = await tx
    .select({
      status: workingOrders.status,
      collectedAt: workingOrders.collectedAt,
      partyId: workingOrders.partyId,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, id));
  if (
    order === undefined ||
    (order.status !== "settled" && !(await sentUnpaidCounterOrder(tx, id, order)))
  ) {
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
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(eq(workingOrderLines.workingOrderId, id))
    .limit(1);
  if (fired === undefined) {
    throw new AppError("ticket.not_fired", { workingOrderId: id });
  }

  await tx
    .update(workingOrders)
    .set({ collectedAt: nowIso() })
    .where(and(eq(workingOrders.id, id), isNull(workingOrders.collectedAt)));
  await captureKitchenActivity(tx, attendance, attendance?.personId, [id]);
}

async function sentUnpaidCounterOrder(
  tx: Transaction,
  id: string,
  order: { status: string; partyId: string | null },
): Promise<boolean> {
  if (order.status !== "placed" || order.partyId !== null) return false;
  const context = await VENUE_SERVICE.findOrderContext(tx, id);
  return paysAfterSending(context?.serviceMode);
}
/** A counter order the counter is still waiting on: sent and not paid, or settled and not handed over. */
export interface CounterWaitingOrder {
  items: OrderPreviewItem[];
  counts: OrderStateCounts;
  id: string;
  orderNumber: number;
  label: string | null;
  tableLabel?: string;
  status: "placed" | "settled";
  openedAt: string;
  settledAt: string | null;
  /** When it was handed over; set on a placed order handed over before payment. */
  collectedAt: string | null;
  /** What collecting a placed order charges: the sale already issued for it, net of its credit
   * notes (`readIssuedSales`), else the sum of its lines. A settled order's is the sum of its lines. */
  total: string;
  /** {@link handOverOrder} would accept it now. */
  canHandOver: boolean;
  /** A placed order's frozen service mode, or prepay when it has none; null on a settled one. */
  serviceMode: ServiceMode | null;
  /** Only on a placed order whose invoice is issued: its number. */
  invoiceNumber?: string;
  /** A settled order's top-level dishes that `stillMovable` accepts, in line order; empty on a
   * placed one. */
  movableDishes: { lineId: string; stationId: string }[];
  /** {@link readFormerNumbers}; absent when there are none. */
  formerNumbers?: number[];
  /** Only on a settled order closed as a deferred payment. */
  closedDeferred?: true;
}
/**
 * The venue's counter orders (no party) that are `placed`, or `settled` with a kitchen ticket and no
 * handover, oldest first.
 */
export async function listCounterWaiting(deps: WorkingOrderDeps): Promise<CounterWaitingOrder[]> {
  return deps.db.withWriteLock(async () => {
    const tx = deps.db;
    const firedOrders = tx
      .selectDistinct({ id: workingOrderLines.workingOrderId })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId));
    const rows = await tx
      .select({
        id: workingOrders.id,
        orderNumber: workingOrders.orderNumber,
        label: workingOrders.label,
        status: workingOrders.status,
        openedAt: workingOrders.openedAt,
        settledAt: workingOrders.settledAt,
        collectedAt: workingOrders.collectedAt,
        partyId: workingOrders.partyId,
        deliveryTableId: workingOrders.deliveryTableId,
        deliveryTableLabel: workingOrders.deliveryTableLabel,
        // Cast to text for `rawCentsToDecimal`; see its doc comment.
        total: sql<string>`cast(coalesce(sum(${workingOrderLines.lineTotal}), 0) as text)`,
        // The number 1 or 0: test its truthiness, never with `===`. Qualified, not bare, because
        // the query joins.
        fired: sql<number>`${workingOrders.id} in ${firedOrders}`,
      })
      .from(workingOrders)
      .leftJoin(workingOrderLines, eq(workingOrderLines.workingOrderId, workingOrders.id))
      .where(
        and(
          isNull(workingOrders.partyId),
          or(
            eq(workingOrders.status, "placed"),
            and(
              eq(workingOrders.status, "settled"),
              isNull(workingOrders.collectedAt),
              inArray(workingOrders.id, firedOrders),
            ),
          ),
        ),
      )
      .groupBy(workingOrders.id)
      .orderBy(workingOrders.openedAt, workingOrders.orderNumber);
    const tableLabels = await orderTableLabels(
      tx,
      rows.map((row) => ({ ...row, label: null })),
    );
    const placedIds = rows.filter((row) => row.status === "placed").map((row) => row.id);
    const modes = await VENUE_SERVICE.findOrderModes(tx, placedIds);
    const issued = await readIssuedSales(tx, placedIds);
    const numbers = await readInvoiceNumbers(
      tx,
      [...issued.values()].map((sale) => sale.saleId),
    );
    const settledIds = rows.filter((row) => row.status === "settled").map((row) => row.id);
    const dishes =
      settledIds.length === 0
        ? []
        : await tx
            .select({
              orderId: workingOrderLines.workingOrderId,
              lineId: workingOrderLines.id,
              stationId: ticketItems.stationId,
              state: ticketItems.state,
              madeHere: ticketItems.madeHere,
              servedAt: workingOrderLines.servedAt,
              servedQuantity: workingOrderLines.servedQuantity,
            })
            .from(ticketItems)
            .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
            .where(
              and(
                inArray(workingOrderLines.workingOrderId, settledIds),
                isNull(sql`+${workingOrderLines.parentLineId}`),
              ),
            )
            .orderBy(workingOrderLines.lineNo);
    const deferredIds = await readDeferredBillIds(tx, settledIds);
    const former = await readFormerNumbers(
      tx,
      rows.map((row) => row.id),
    );
    const items = await readOrderPreviewItems(
      tx,
      rows.map((row) => row.id),
    );
    const counts = await readOrderStateCounts(
      tx,
      rows.map((row) => row.id),
    );
    const movable = new Map<string, { lineId: string; stationId: string }[]>();
    for (const dish of dishes) {
      if (!stillMovable(dish, dish)) continue;
      movable.set(dish.orderId, [
        ...(movable.get(dish.orderId) ?? []),
        { lineId: dish.lineId, stationId: dish.stationId },
      ]);
    }
    const waiting: CounterWaitingOrder[] = [];
    for (const row of rows) {
      const placed = row.status === "placed";
      const sale = issued.get(row.id);
      const eligible =
        Boolean(row.fired) &&
        row.collectedAt === null &&
        (!placed || paysAfterSending(modes.get(row.id)));
      waiting.push({
        items: items.get(row.id)!,
        counts: counts.get(row.id)!,
        id: row.id,
        orderNumber: row.orderNumber,
        label: row.label,
        ...optional("tableLabel", tableLabels.get(row.id) ?? undefined),
        status: row.status as CounterWaitingOrder["status"],
        openedAt: row.openedAt,
        settledAt: row.settledAt,
        collectedAt: row.collectedAt,
        total: sale?.amountDue ?? rawCentsToDecimal(row.total),
        canHandOver: eligible,
        serviceMode: placed ? (modes.get(row.id) ?? "prepay") : null,
        ...(sale === undefined ? {} : { invoiceNumber: numbers.get(sale.saleId)! }),
        movableDishes: movable.get(row.id) ?? [],
        ...optional("formerNumbers", former.get(row.id)),
        ...(deferredIds.has(row.id) ? { closedDeferred: true as const } : {}),
      });
    }
    return waiting;
  });
}
