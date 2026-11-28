import { outsideCardDetails } from "./outside-card.js";
import { withIssuanceTransaction } from "@waitron/core";
import { prepareIssueClock, type TrustedReading } from "@waitron/fiscal";
import { requireEconomicWrite } from "./trading-admission.js";
import { requireOrderBillEditor } from "./bill-editing.js";
import { readSaleOperationDescription } from "./sale-operation-description.js";
import { assertBillHasNoUnsent } from "./bill-unsent.js";
import { selectOrderInvoice } from "./invoice-selection.js";
import { reopenedChainIds } from "./reopened-bills.js";
import { hasInvoice } from "./sent-order-open.js";
import { and, eq, sql } from "drizzle-orm";
import { refunds as refundRows, billPayments, withTransaction, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  AppError,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  sumDecimals,
} from "@waitron/shared";
import type { Decimal, Dining } from "@waitron/shared";
import { refuseOtherDining } from "./order-dining.js";
import { readPaymentsSettings, recordManualCardPayment } from "@waitron/payments";
import { confirmAllocation, invalid, previewAllocation, ZERO } from "./bill-allocation.js";
import type { AllocationPreview, AllocationRequest } from "./bill-allocation.js";
import { pinnedAt } from "./issue-moment.js";
import {
  enqueueBillCardSlipDrawer,
  enqueueBillPaymentDrawer,
  printerLookup,
} from "./receipt-print.js";
import type { DeviceRequestConfig, TradingContext } from "./trading-context.js";
import {
  captureWholePayment,
  readSettledTicket,
  refuseUnavailableInvoiceRequest,
  storeSentReceiptLanguage,
} from "./till-sale.js";
import type { TillSaleResult } from "./till-sale.js";
import { billPaymentFingerprint } from "./bill-payment-fingerprint.js";
import { parseSetMenuWireLines } from "./set-menu-wire-lines.js";
import { refuseUnavailableFullInvoice } from "./working-order-invoice.js";
import { saveHeldOrderIn } from "./working-order-held-write.js";
import { refusePaymentInFlight, refuseRefundInProgress } from "./working-order-edit-state.js";
import { createOpenOrder } from "./working-order-open.js";
import { captureOrderEdit } from "./working-order-context.js";
import type { TillSaleDeps } from "./working-order-context.js";
import { refuseWhileAdvanceCorrectionOpen } from "./bill-advances.js";
import { refuseDiscountsNotHolding } from "./bill-discounts-crystallise.js";
import { assertStillSignedIn } from "./till-session.js";
import "./errors.js";
import { enqueueRequestedPaymentSlip, readerSlipWanted } from "./payment-slip-print.js";
import type { AttendanceRecorder } from "./attendance-capture.js";
import type { Logger } from "./logger.js";
import { refuseForDiskStop } from "./disk-full-state.js";
import {
  type HeldMoney,
  readHeld,
  fundsOf,
  billPaymentTotal,
  type PaymentRow,
  type RefundRow,
  type BillFigures,
  readBillFigures,
  HOLDING_STATES,
} from "./bill-payment-rows.js";
import { type BillBalance, readBillBalance } from "./bill-balance.js";
import type {
  SettledBill,
  BillPaymentAsk,
  BillPaymentResult,
  BillPaymentRequest,
  BillPaymentDeps,
  CounterPayment,
} from "./bill-payment-types.js";
import {
  issueWhenFullyPaid,
  refuseFullInvoiceAdvance,
  recordBillDrawerPayment,
  issueAdvanceIfOwed,
} from "./bill-payment-settlement.js";

function settledBill(balance: BillBalance, invoice: TillSaleResult): SettledBill {
  return { outcome: "settled", balance, invoice };
}

function allocationRequestFor(ask: BillPaymentAsk): AllocationRequest {
  const addedTip = decimal(ask.addedTip ?? "0.00");
  const payment =
    ask.method === "cash"
      ? { method: "cash" as const, tendered: decimal(ask.tendered!), addedTip }
      : { method: "card" as const, addedTip };
  return ask.kind === "contribution"
    ? { kind: "contribution", amount: decimal(ask.amount!), payment }
    : { kind: "share", shareOf: ask.shareOf!, payment };
}

/** An open bill, else `working_order.not_found` or `working_order.not_open`. */
export async function requireOpenBill(tx: Transaction, workingOrderId: string): Promise<void> {
  const [order] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  if (order === undefined) {
    throw new AppError("working_order.not_found", { workingOrderId });
  }
  if (order.status !== "open") {
    throw new AppError("working_order.not_open", { workingOrderId });
  }
}

/** A bill whose payments can still be refunded before its invoice: open, or sent or presented with
 * no invoice issued; else `working_order.not_found` or `working_order.not_open`. Returns which of
 * the two it found. */
export async function requireRefundableBill(
  tx: Transaction,
  workingOrderId: string,
): Promise<"open" | "placed"> {
  const [order] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  if (order?.status === "placed" && !(await hasInvoice(tx, workingOrderId))) return "placed";
  await requireOpenBill(tx, workingOrderId);
  return "open";
}

interface PayableBill {
  status: "open" | "placed";
  dining: Dining;
  revision: number;
  receiptLocale: string | null;
  held?: HeldMoney;
  invoiced?: true;
}

async function requirePayableBill(tx: Transaction, workingOrderId: string): Promise<PayableBill> {
  const [order] = await tx
    .select({
      status: workingOrders.status,
      dining: workingOrders.dining,
      revision: workingOrders.revision,
      receiptLocale: workingOrders.receiptLocale,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  if (order === undefined) throw new AppError("working_order.not_found", { workingOrderId });
  if (order.status === "open") return { ...order, status: "open" };
  if (order.status === "placed") {
    if (!(await hasInvoice(tx, workingOrderId))) return { ...order, status: "placed" };
    const held = await readHeld(tx, [workingOrderId]);
    return { ...order, status: "placed", held, invoiced: true };
  }
  throw new AppError("working_order.not_open", { workingOrderId });
}

/** Design §3.6: what a payment of the bill would be, writing nothing. */
export async function previewBillPayment(
  deps: TillSaleDeps,
  workingOrderId: string,
  ask: BillPaymentAsk,
  operatorId: string | undefined,
): Promise<AllocationPreview> {
  return withTransaction(deps.db, async (tx) => {
    const payable = await requirePayableBill(tx, workingOrderId);
    refuseOtherDining(workingOrderId, payable, ask.dining);
    await requireOrderBillEditor(tx, workingOrderId, {
      operatorId,
      expectedEdit: ask.expectedEdit,
    });
    await assertBillHasNoUnsent(tx, workingOrderId);
    const { held, advances } = payable.held ?? (await readHeld(tx, [workingOrderId]));
    const funds = fundsOf(
      workingOrderId,
      await billPaymentTotal(tx, workingOrderId, advances),
      held,
    );
    const { doc } = await readPaymentsSettings(tx);
    const preview = previewAllocation(funds, allocationRequestFor(ask), {
      tipsEnabled: doc.tipsEnabled,
    });
    // A hand-keyed card is charged before its payment is sent, so this is where it is asked.
    if (
      !payable.invoiced &&
      compareDecimal(
        sumDecimals([funds.received, funds.reserved, preview.applied]),
        funds.total,
      ) === 0
    )
      await refuseDiscountsNotHolding(tx, workingOrderId);
    return preview;
  });
}

/** `total` is the bill's total when the caller has priced its current lines in this transaction
 * already. */
export async function resultOf(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: TradingContext,
  payment: PaymentRow,
  invoice: TillSaleResult | null,
  total?: Decimal,
): Promise<BillPaymentResult> {
  const balance = await readBillBalance(tx, payment.workingOrderId, total);
  const view = balance.payments.find((candidate) => candidate.id === payment.id)!;
  const ticket =
    invoice ??
    (balance.status === "settled"
      ? await readSettledTicket(deps.backend, tx, cfg, payment.workingOrderId)
      : null);
  return {
    outcome: payment.state,
    payment: view,
    balance,
    ...(ticket === null ? {} : { invoice: ticket }),
  };
}

/** What already uses `submissionId` on the bill or a bill reopened from it (design §5.1): one of
 * their payments, or a refund of one of them. */
export async function findSubmission(
  tx: Transaction,
  workingOrderId: string,
  submissionId: string,
): Promise<{ payment: PaymentRow | undefined; refund: RefundRow | undefined }> {
  const bills = reopenedChainIds(workingOrderId);
  const [payment] = await tx
    .select()
    .from(billPayments)
    .where(
      and(
        sql`${billPayments.workingOrderId} in ${bills}`,
        eq(billPayments.submissionId, submissionId),
      ),
    );
  const [found] = await tx
    .select({ refund: refundRows })
    .from(refundRows)
    .innerJoin(billPayments, eq(billPayments.id, refundRows.billPaymentId))
    .where(
      and(
        sql`${billPayments.workingOrderId} in ${bills}`,
        eq(refundRows.submissionId, submissionId),
      ),
    );
  return { payment, refund: found?.refund };
}

async function requireReadyForPayment(
  tx: Transaction,
  workingOrderId: string,
  payable: PayableBill,
  operator: { personId: string },
  req: BillPaymentRequest,
): Promise<void> {
  refuseOtherDining(workingOrderId, payable, req.dining);
  await requireOrderBillEditor(tx, workingOrderId, {
    operatorId: operator.personId,
    expectedEdit: req.expectedEdit,
  });
  await assertBillHasNoUnsent(tx, workingOrderId);
  await refuseRefundInProgress(tx, [workingOrderId]);
}

/** Close a zero bill through Pay using the same issuance transaction as a money payment. */
export async function closeZeroBill(
  deps: BillPaymentDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  req: BillPaymentRequest,
  operator: { personId: string; sessionId: string },
): Promise<SettledBill> {
  const pending = diskFullBeforePayment(deps);
  const preRead = pending !== false && (await pending);
  return withIssuanceTransaction(
    deps.db,
    async (tx) => {
      await assertStillSignedIn(tx, {
        deviceId: cfg.origin.deviceId,
        sessionId: operator.sessionId,
        personId: operator.personId,
      });
      const earlier = await findSubmission(tx, workingOrderId, req.submissionId);
      if (earlier.payment !== undefined || earlier.refund !== undefined) {
        throw new AppError("submission.id_reused", { submissionId: req.submissionId });
      }
      const balance = await readBillBalance(tx, workingOrderId);
      if (compareDecimal(balance.total, ZERO) !== 0) throw invalid("amount");
      if (compareDecimal(decimal(req.applied), ZERO) !== 0) throw invalid("applied");
      if (
        compareDecimal(decimal(req.tip), ZERO) !== 0 ||
        compareDecimal(decimal(req.addedTip ?? ZERO), ZERO) !== 0
      ) {
        throw new AppError("bill.tip_not_allowed", { workingOrderId, chargeable: ZERO });
      }
      return closeZeroBillIn(
        tx,
        deps,
        cfg,
        workingOrderId,
        req,
        operator,
        balance,
        preRead || (deps.disk?.noted() ?? false),
      );
    },
    deps.log,
  );
}

async function closeZeroBillIn(
  tx: Transaction,
  deps: BillPaymentDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  req: BillPaymentRequest,
  operator: { personId: string },
  balance: BillBalance,
  diskFull: boolean,
): Promise<SettledBill> {
  if (balance.status === "settled") {
    return settledBill(balance, await readSettledTicket(deps.backend, tx, cfg, workingOrderId));
  }

  const payable = await requirePayableBill(tx, workingOrderId);
  await requireReadyForPayment(tx, workingOrderId, payable, operator, req);
  if (diskFull) refuseForDiskStop(deps.log, workingOrderId);
  const reading = deps.clock.now();
  await deps.backend.refuseUntilRecordable(tx, reading);
  await deps.backend.refuseNewIssuance(tx, cfg.nodeId);
  if (!payable.invoiced)
    await storeSentReceiptLanguage(tx, workingOrderId, payable, req.receiptLanguage);
  const { invoice } = await issueWhenFullyPaid(
    tx,
    { ...deps, clock: pinnedAt(deps.clock, reading) },
    cfg,
    workingOrderId,
    operator.personId,
    { closeZero: true, pricedMeal: ZERO, guestCount: req.guestCount },
  );
  if (invoice === null) {
    throw new AppError("bill.nothing_outstanding", { workingOrderId });
  }
  await captureWholePayment(
    tx,
    deps.attendance,
    workingOrderId,
    operator.personId,
    reading.instant,
  );
  return settledBill(await readBillBalance(tx, workingOrderId), invoice);
}

async function saveCounterBasket(
  tx: Transaction,
  deps: BillPaymentDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  req: BillPaymentRequest,
  operatorId: string,
  basket: CounterPayment,
  status: typeof workingOrders.$inferSelect.status | undefined,
): Promise<void> {
  refuseUnavailableInvoiceRequest(basket.invoiceType, basket.recipient);
  const lines = parseSetMenuWireLines(basket.lines);
  const zoneConfirmation = { zoneId: basket.closedZoneId, personId: operatorId };
  if (status !== undefined) {
    if (status !== "open") throw new AppError("working_order.not_open", { workingOrderId });
    await refusePaymentInFlight(tx, [workingOrderId]);
    await refuseUnavailableFullInvoice(tx, workingOrderId);
    if (basket.revision !== undefined) {
      const attendance =
        deps.attendance === undefined
          ? undefined
          : { recorder: deps.attendance, clock: deps.clock };
      const saved = await saveHeldOrderIn(
        tx,
        cfg,
        workingOrderId,
        {
          ...basket,
          lines,
          zoneConfirmation,
          revision: basket.revision,
          expectedEdit: req.expectedEdit,
          dining: req.dining,
          operatorId,
        },
        attendance,
      );
      if (saved.changed)
        await captureOrderEdit(
          tx,
          attendance,
          workingOrderId,
          operatorId,
          saved.revision,
          "save",
          saved.at,
        );
    }
    return;
  }
  if (basket.revision !== undefined)
    throw new AppError("working_order.not_open", { workingOrderId });
  if (lines.length === 0) throw new AppError("sale.empty_basket", {});
  await createOpenOrder(tx, cfg, workingOrderId, lines, null, {
    kitchenNote: basket.kitchenNote,
    zoneId: basket.zoneId,
    creditedTo: operatorId,
    invalidMakeAt: "ignore",
    lateSend: basket.lateSend,
    zoneConfirmation,
    dining: req.dining,
  });
}

/**
 * The start every payment of a bill shares, in the caller's transaction: the operator must still
 * be signed in on the requesting device ({@link assertStillSignedIn}); a retry finds its first row;
 * otherwise the bill must be payable (`requirePayableBill`) with no payment of the whole order in
 * flight, the allocation must be the one the operator saw (design §3.6), and the payment is
 * inserted in `state`. A new payment answers the bill's total too, which the insert leaves as it
 * was.
 *
 * Keyed by `submissionId` within the bill (design §5.1): a matched retry returns the first row
 * without changing it here. A different fingerprint or an id already used for a refund is
 * `submission.id_reused`.
 */
export async function beginBillPayment(
  tx: Transaction,
  deps: BillPaymentDeps & { readerId?: string },
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  req: BillPaymentRequest,
  operator: { personId: string; sessionId: string },
  state: "received" | "pending",
  read: TillSaleDeps["clock"]["now"],
  refusals: { diskFull: () => boolean; log?: Logger },
  attendance?: AttendanceRecorder,
  basket?: CounterPayment,
  printOverride?: string,
): Promise<
  | { replay: PaymentRow }
  | { payment: PaymentRow; figures: BillFigures; reading: TrustedReading }
  | { settled: SettledBill }
> {
  // Before the replay lookup: a retry the route would now refuse is refused too.
  await assertStillSignedIn(tx, {
    deviceId: cfg.origin.deviceId,
    sessionId: operator.sessionId,
    personId: operator.personId,
  });
  const print = printOverride ?? billPaymentFingerprint(req, basket);
  const earlier = await findSubmission(tx, workingOrderId, req.submissionId);
  if (earlier.payment !== undefined) {
    if (earlier.payment.fingerprint !== print) {
      throw new AppError("submission.id_reused", { submissionId: req.submissionId });
    }
    return { replay: earlier.payment };
  }
  if (earlier.refund !== undefined) {
    throw new AppError("submission.id_reused", { submissionId: req.submissionId });
  }
  let counterStatus: typeof workingOrders.$inferSelect.status | undefined;
  if (basket !== undefined) {
    const [order] = await tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, workingOrderId));
    counterStatus = order?.status;
    if (counterStatus === "settled") {
      if (basket.revision !== undefined)
        throw new AppError("working_order.not_open", { workingOrderId });
      return {
        settled: settledBill(
          await readBillBalance(tx, workingOrderId),
          await readSettledTicket(deps.backend, tx, cfg, workingOrderId),
        ),
      };
    }
  }
  deps.admission.require();
  const reading = read();
  if (!Number.isFinite(reading.instant.getTime()))
    throw new AppError("venue.time_zone_conversion_failed", { reason: "invalid_instant" });
  await deps.backend.refuseUntilRecordable(tx, reading);
  await deps.backend.refuseNewIssuance(tx, cfg.nodeId);

  if (basket !== undefined) {
    if (refusals.diskFull()) refuseForDiskStop(refusals.log, workingOrderId);
    await requireEconomicWrite(tx, cfg, deps.admission);
    await saveCounterBasket(
      tx,
      deps,
      cfg,
      workingOrderId,
      req,
      operator.personId,
      basket,
      counterStatus,
    );
  }
  const payable = await requirePayableBill(tx, workingOrderId);
  await requireReadyForPayment(tx, workingOrderId, payable, operator, req);
  if (req.ownReceipt === true && !payable.invoiced)
    await refuseFullInvoiceAdvance(tx, workingOrderId);
  const { held, advances } = payable.held ?? (await readHeld(tx, [workingOrderId]));
  const figures = await readBillFigures(tx, workingOrderId, advances);
  const total = figures.meal;
  if (basket !== undefined && held.some(({ row }) => HOLDING_STATES.includes(row.state))) {
    if (
      basket.revision !== undefined &&
      compareDecimal(fundsOf(workingOrderId, total, held).received, total) === 0
    ) {
      const { invoice } = await issueWhenFullyPaid(
        tx,
        { ...deps, clock: pinnedAt(deps.clock, reading) },
        cfg,
        workingOrderId,
        operator.personId,
        { figures, guestCount: req.guestCount },
      );
      if (invoice !== null) {
        return { settled: settledBill(await readBillBalance(tx, workingOrderId, total), invoice) };
      }
    }
    throw new AppError("bill.payments_received", { workingOrderId });
  }
  if (basket !== undefined && compareDecimal(total, ZERO) === 0) {
    if (compareDecimal(decimal(req.addedTip ?? ZERO), ZERO) > 0 && req.entry !== "reader")
      throw new AppError("bill.tip_not_allowed", { workingOrderId, chargeable: ZERO });
    return {
      settled: await closeZeroBillIn(
        tx,
        { ...deps, clock: pinnedAt(deps.clock, reading) },
        cfg,
        workingOrderId,
        req,
        operator,
        await readBillBalance(tx, workingOrderId, total),
        refusals.diskFull(),
      ),
    };
  }
  const { tipsEnabled } = (await readPaymentsSettings(tx)).doc;
  const addedTip =
    basket !== undefined && req.entry === "reader" && !tipsEnabled ? ZERO : req.addedTip;
  deps.backend.assertRecordableAt(reading);
  if (refusals.diskFull()) refuseForDiskStop(refusals.log, workingOrderId);
  if (!payable.invoiced) {
    await selectOrderInvoice(tx, deps.backend, cfg, workingOrderId, total);
    await readSaleOperationDescription(tx, cfg, { kind: "order", orderId: workingOrderId });
  }
  const funds = fundsOf(workingOrderId, total, held);
  const allocation = confirmAllocation(
    funds,
    allocationRequestFor({ ...req, addedTip }),
    { tipsEnabled },
    {
      applied: basket === undefined ? decimal(req.applied) : total,
      tip: decimal(basket === undefined ? req.tip : (addedTip ?? ZERO)),
    },
  );
  const coversBill =
    !payable.invoiced &&
    compareDecimal(sumDecimals([funds.received, funds.reserved, allocation.applied]), total) === 0;
  // Refused before any card is charged: the payment would issue the bill's invoice.
  if (coversBill && advances.credits.has(workingOrderId))
    await refuseWhileAdvanceCorrectionOpen(tx, workingOrderId);
  if (coversBill) await refuseDiscountsNotHolding(tx, workingOrderId);
  // A reserved card may finish on recovery, so save the language once the bill is covered.
  if (req.receiptLanguage !== undefined && coversBill)
    await storeSentReceiptLanguage(tx, workingOrderId, payable, req.receiptLanguage);

  await requireEconomicWrite(tx, cfg, deps.admission);
  if (state === "pending") await prepareIssueClock(tx, cfg, pinnedAt(deps.clock, reading));
  const slipWanted =
    state === "pending" && (await readerSlipWanted(tx, cfg, req.printCardSlip, deps.readerId));
  const [payment] = await tx
    .insert(billPayments)
    .values({
      workingOrderId,
      submissionId: req.submissionId,
      fingerprint: print,
      kind: req.kind,
      shareOf: req.kind === "share" ? req.shareOf! : null,
      method: req.method,
      applied: decimalToCents(allocation.applied),
      tip: decimalToCents(allocation.tip),
      tendered: req.method === "cash" ? decimalToCents(decimal(req.tendered!)) : null,
      ownReceipt: req.ownReceipt === true,
      state,
      requestedBy: operator.personId,
      source: cfg.origin.source,
      deviceId: cfg.origin.deviceId,
      receivedAt: state === "received" ? reading.instant.toISOString() : null,
      slipWanted,
    })
    .returning();
  await captureBillPaymentAttendance(tx, payment!, attendance, {
    at: reading.instant.toISOString(),
  });
  return { payment: payment!, figures, reading };
}

async function captureBillPaymentAttendance(
  tx: Transaction,
  payment: PaymentRow,
  attendance: AttendanceRecorder | undefined,
  requested: { at: string },
): Promise<void> {
  if (attendance === undefined) return;
  await attendance(tx, {
    source: "bill-payment",
    key: payment.id,
    personId: payment.requestedBy,
    kind: "payment",
    at: requested.at,
    offsetMinutes: 0,
    outcome: "qualified",
  });
}

/**
 * Take a cash or hand-keyed card payment against a bill `requirePayableBill` admits, in one
 * transaction: it is received at once, and when it leaves the bill fully paid the same transaction
 * issues the invoice.
 */
export async function takeBillPayment(
  deps: BillPaymentDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  req: BillPaymentRequest,
  operator: { personId: string; sessionId: string },
  basket: CounterPayment | undefined,
): Promise<BillPaymentResult | SettledBill>;
export async function takeBillPayment(
  deps: BillPaymentDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  req: BillPaymentRequest,
  operator: { personId: string; sessionId: string },
): Promise<BillPaymentResult>;
export async function takeBillPayment(
  deps: BillPaymentDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  req: BillPaymentRequest,
  operator: { personId: string; sessionId: string },
  basket?: CounterPayment,
): Promise<BillPaymentResult | SettledBill> {
  const pending = diskFullBeforePayment(deps);
  const preRead = pending !== false && (await pending);
  return withIssuanceTransaction(
    deps.db,
    (tx) =>
      takeBillPaymentWithin(tx, deps, cfg, workingOrderId, req, operator, { preRead, basket }),
    deps.log,
  );
}

/**
 * The full-disk refusal a payment reads before it opens its transaction, asked of the disk only
 * while `since()` names a refusal. Otherwise it is `false` with no promise, so a caller that awaits
 * only a promise enters the write queue in its own turn.
 */
export function diskFullBeforePayment(
  deps: Pick<BillPaymentDeps, "disk">,
): false | Promise<boolean> {
  return deps.disk !== undefined && deps.disk.since() !== null && deps.disk.full();
}

/** What {@link takeBillPaymentIn} may be told besides the request. */
export interface TakeBillPaymentOptions {
  /** The full-disk refusal {@link takeBillPayment} reads before it opens its transaction. */
  preRead?: boolean;
  /** The retry fingerprint to store and compare in place of the request's own. */
  print?: string;
}

/** {@link takeBillPayment} of a bill with no counter basket, in the caller's issuance transaction. */
export async function takeBillPaymentIn(
  tx: Transaction,
  deps: BillPaymentDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  req: BillPaymentRequest,
  operator: { personId: string; sessionId: string },
  options: TakeBillPaymentOptions = {},
): Promise<BillPaymentResult> {
  return (await takeBillPaymentWithin(
    tx,
    deps,
    cfg,
    workingOrderId,
    req,
    operator,
    options,
  )) as BillPaymentResult;
}

async function takeBillPaymentWithin(
  tx: Transaction,
  deps: BillPaymentDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  req: BillPaymentRequest,
  operator: { personId: string; sessionId: string },
  { preRead = false, print, basket }: TakeBillPaymentOptions & { basket?: CounterPayment },
): Promise<BillPaymentResult | SettledBill> {
  const begun = await beginBillPayment(
    tx,
    deps,
    cfg,
    workingOrderId,
    req,
    operator,
    "received",
    () => deps.clock.now(),
    { diskFull: () => preRead || (deps.disk?.noted() ?? false), log: deps.log },
    deps.attendance,
    basket,
    print,
  );
  if ("settled" in begun) return begun.settled;
  if ("replay" in begun) return resultOf(tx, deps, cfg, begun.replay, null);
  const { payment, reading } = begun;
  const receivedAt = new Date(payment.receivedAt!);
  const printers = printerLookup(tx, cfg.origin);
  if (req.method === "card") {
    await recordManualCardPayment(tx, {
      origin: cfg.origin,
      workingOrderId,
      nodeId: cfg.nodeId,
      amount: centsToDecimal(payment.applied + payment.tip),
      settledAt: receivedAt,
      externalRef: req.externalRef,
      ...outsideCardDetails(req),
      billPaymentId: payment.id,
      requestedBy: operator.personId,
    });
    await enqueueBillCardSlipDrawer(tx, cfg, payment.id, operator.personId, printers);
  } else {
    await enqueueBillPaymentDrawer(tx, cfg, payment.id, operator.personId, printers);
  }
  await recordBillDrawerPayment(tx, cfg, payment, printers);
  const paidAt = { ...deps, clock: pinnedAt(deps.clock, reading) };
  const { invoice, figures } = await issueWhenFullyPaid(
    tx,
    paidAt,
    cfg,
    workingOrderId,
    operator.personId,
    { figures: begun.figures, printers, guestCount: req.guestCount },
  );
  // An invoice issued or settled is answered, so with none `figures` still stand.
  if (invoice === null) await issueAdvanceIfOwed(tx, paidAt, cfg, payment, printers, figures);
  const slip = await enqueueRequestedPaymentSlip(
    tx,
    cfg,
    workingOrderId,
    req.printCardSlip,
    {
      id: payment.id,
      method: req.method,
      charged: payment.applied + payment.tip,
      tip: payment.tip,
      tendered: payment.tendered,
      paidAt: payment.receivedAt!,
      reference: req.externalRef ?? null,
      machine: outsideCardDetails(req).externalMachine ?? null,
    },
    printers,
  );
  return { ...(await resultOf(tx, deps, cfg, payment, invoice, figures?.meal)), ...slip };
}
