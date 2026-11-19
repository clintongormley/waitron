import { paymentRefunds } from "@waitron/payments/src/schema/payment-refunds.js";
import { outsideCardDetails, type OutsideCardDetails } from "./outside-card.js";
import { readBillSlipPayments } from "./payment-slip-print.js";
import { withIssuanceTransaction } from "@waitron/core";
import { prepareIssueClock } from "@waitron/fiscal";
import { requireEconomicWrite } from "./trading-admission.js";
import { parseBillEditExpected, requireOrderBillEditor } from "./bill-editing.js";
import type { BillEditExpected } from "./order-drafts.js";
import { readSaleOperationDescription } from "./sale-operation-description.js";
import { assertBillHasNoUnsent, readBillUnsent } from "./bill-unsent.js";
import { selectOrderInvoice } from "./invoice-selection.js";
import { withReceiptListPrices } from "./receipt-lines.js";
import { linkSaleDishes } from "./order-portions.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  billPaymentLines,
  billPaymentRefunds,
  billPayments,
  insertInChunks,
  isUniqueViolation,
  sales,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { assertQuantityPrecision } from "@waitron/menu";
import {
  AppError,
  addDecimal,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  diskFullIn,
  firstCodeInCauseChain,
  isAppError,
  MONEY_SCALE,
  multiplyDecimal,
  stringToThousandths,
  subtractDecimal,
  sumDecimals,
  thousandthsToDecimal,
  toScale,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import type { Decimal, Dining } from "@waitron/shared";
import { refuseOtherDining } from "./order-dining.js";
import { recordSale, settleSale } from "@waitron/core";
import { IssuanceRefusedError } from "@waitron/fiscal";
import type { SettleSaleTender } from "@waitron/core";
import { VENUE_SERVICE } from "./modules.js";
import {
  associatePaymentWithSale,
  ChargeNotSavedError,
  findPaymentsByBillPayments,
  findPaymentByBillPayment,
  findCaptureWarning,
  MANUAL_PROVIDER,
  recordManualCardPayment,
} from "@waitron/payments";
import type {
  PaymentProvider,
  PaymentResult,
  PaymentResultState,
  RefundRefusalReason,
} from "@waitron/payments";
import {
  cashChange,
  confirmAllocation,
  invalid,
  money,
  previewAllocation,
  ZERO,
} from "./bill-allocation.js";
import type {
  AllocationChoice,
  AllocationPreview,
  AllocationRequest,
  BillFunds,
} from "./bill-allocation.js";
import { issuancePass } from "./issuance-pass.js";
import { issueMoment, pinnedAt } from "./issue-moment.js";
import { claimLive, perDatabase } from "./live-in-process.js";
import { readReceiptPresentation } from "./receipt-presentation.js";
import { readReceiptIssuer } from "./receipt-issuer.js";
import { saleReceiptFacts, type GuestCountChoice } from "./receipt-guests.js";
import { receiptLines } from "./receipt-adjustments.js";
import { readReceiptOrder } from "./receipt-order.js";
import {
  enqueueBillCardSlipDrawer,
  enqueueBillPaymentDrawer,
  enqueueSaleReceipt,
  printerLookup,
} from "./receipt-print.js";
import type { PrinterLookup } from "./receipt-print.js";
import type { DeviceRequestConfig, TradingContext } from "./trading-context.js";
import { storedDeviceOrigin } from "./request-config.js";
import {
  captureWholePayment,
  fireDishesAtPayment,
  readBillTenderLines,
  readSettledTicket,
  readOutstandingSaleForOrder,
  readTenderBlock,
  receiptQr,
  refusePlacedPaymentInFlight,
  settleIssuedOrder,
  storeSentReceiptLanguage,
} from "./till-sale.js";
import type { TillSaleResult } from "./till-sale.js";
import { fingerprint } from "./parties.js";
import {
  priceStoredOrderForIssuance,
  readInvoiceNumber,
  refuseOrderPaymentMarked,
  refuseRefundInProgress,
  storedOrderTotal,
  toVatBreakdown,
} from "./working-order.js";
import type { GrossOrder, TillSaleDeps } from "./working-order.js";
import { clearBillRequestIfPaid } from "./bill-request.js";
import { storePrepayMadeHere } from "./made-here.js";
import { assertStillSignedIn } from "./till-session.js";
import { refuseSetMenuMoney } from "./set-menu-bill.js";
import "./errors.js";
import { freezeCardSlip, printCapturedCardSlip } from "./payment-slip-print.js";
import { raiseDishesNotSent } from "./dish-not-sent-alert.js";
import { saleLanguageFor } from "./venue-locale.js";
import type { AttendanceRecorder } from "./attendance-capture.js";
import type { Logger } from "./logger.js";
import { refuseForDiskStop, type DiskFullState } from "./disk-full-state.js";

export type BillPaymentDeps = TillSaleDeps & {
  attendance?: AttendanceRecorder;
  /**
   * Unset in suites that test no full-disk stop; unset, nothing is refused for a full disk. A live
   * boot supplies it.
   */
  disk?: DiskFullState;
};

/** What a payment request asks for, before the operator has seen an allocation. */
export interface BillPaymentAsk {
  expectedEdit: BillEditExpected | null;
  dining?: Dining;
  kind: "items" | "contribution" | "share";
  /** `items` only. A line's `quantity`, absent, is the whole line. */
  lines?: { lineNo: number; quantity?: string }[];
  /** `contribution` only. */
  amount?: string;
  /** `share` only: how many people are still to pay. */
  shareOf?: number;
  method: "cash" | "card";
  /** Cash only: the money handed over. */
  tendered?: string;
  /** What the payer adds as a tip on top of what the allocation's own rule makes one. */
  addedTip?: string;
  choice?: AllocationChoice;
}

/** A payment request as taken: the ask, the allocation the operator saw, and its retry key. */
export interface BillPaymentRequest extends BillPaymentAsk, OutsideCardDetails {
  submissionId: string;
  printCardSlip?: boolean;
  /** A card only: `manual` is a card charged on a terminal the POS does not drive, `reader` one
   * the provider drives. */
  entry?: "manual" | "reader";
  /** A hand-keyed card's terminal operation number. */
  externalRef?: string;
  /** A reader card only, passed to the provider's `collect`. */
  simulationOutcome?: "captured" | "declined" | "attempting";
  applied: string;
  tip: string;
  receiptLanguage?: string;
  /** What the receipt prints if this payment completes the bill; absent stores the default then. */
  guestCount?: number | null;
}

/** Money given back from one bill payment before the invoice. */
export interface BillRefundView {
  refusalReason?: RefundRefusalReason;
  id: string;
  paymentId: string;
  submissionId: string;
  appliedAmount: Decimal;
  tipAmount: Decimal;
  reason: string;
  state: "pending" | "completed" | "failed";
  createdAt: string;
  completedAt: string | null;
}

export interface BillPaymentView extends OutsideCardDetails {
  externalRef?: string;
  canCopySlip?: true;
  id: string;
  submissionId: string;
  kind: "items" | "contribution" | "share";
  shareOf: number | null;
  method: "cash" | "card";
  /** A card's: keyed on a separate terminal (`manual`), or taken at a reader; `null` for cash. */
  entry: "manual" | "reader" | null;
  applied: Decimal;
  tip: Decimal;
  tendered: Decimal | null;
  /** Cash only: handed back when the payment was taken. */
  change: Decimal | null;
  state: "pending" | "received" | "failed" | "declined";
  createdAt: string;
  receivedAt: string | null;
  /** An item payment's lines; `lineNo` is the line's number on this bill now. */
  lines: { lineId: string; lineNo: number | null; quantity: Decimal; amount: Decimal }[];
  refunds: BillRefundView[];
}

export interface BillBalance {
  captureWarning?: import("@waitron/payments").CaptureMismatch;
  workingOrderId: string;
  status: "open" | "placed" | "settled" | "abandoned";
  total: Decimal;
  /** The net applied of the received payments. */
  received: Decimal;
  /** The applied amount of the pending payments. */
  reserved: Decimal;
  /** The total less received and reserved; zero once the bill is settled or abandoned. */
  outstanding: Decimal;
  /** The net tips of the received payments. */
  tips: Decimal;
  payments: BillPaymentView[];
  paidLines: { lineId: string; lineNo: number; paidQuantity: Decimal }[];
}

export interface BillPaymentResult {
  slipPrintFailed?: true;
  /** The payment's state; a reader card's own answer is `declined`, `timeout` (still pending),
   * `network_unavailable` (failed, nothing charged). A retry whose own sign-in is open on an active
   * till (the first sign-in or a later one) answers the state it finds. */
  outcome: "received" | "pending" | "failed" | "declined" | "timeout" | "network_unavailable";
  payment: BillPaymentView;
  balance: BillBalance;
  /** Present when the bill is invoiced: by this payment, or, on a replay, since. */
  invoice?: TillSaleResult;
}

type PaymentRow = typeof billPayments.$inferSelect;
type PaymentLineRow = typeof billPaymentLines.$inferSelect;
type RefundRow = typeof billPaymentRefunds.$inferSelect;

export interface PaymentMoney {
  row: PaymentRow;
  netApplied: Decimal;
  netTip: Decimal;
  /** How many completed refunds it has. */
  refunds: number;
}

/** Each payment with what its completed refunds leave of it; `refunds` may hold refunds of other
 * payments, and in other states. */
function moneyOf(
  rows: readonly PaymentRow[],
  refunds: readonly Pick<RefundRow, "billPaymentId" | "appliedAmount" | "tipAmount" | "state">[],
): PaymentMoney[] {
  return rows.map((row) => {
    const own = refunds.filter(
      (refund) => refund.billPaymentId === row.id && refund.state === "completed",
    );
    const refunded = (pick: (refund: (typeof own)[number]) => number) =>
      own.reduce((sum, refund) => sum + pick(refund), 0);
    return {
      row,
      netApplied: centsToDecimal(row.applied - refunded((refund) => refund.appliedAmount)),
      netTip: centsToDecimal(row.tip - refunded((refund) => refund.tipAmount)),
      refunds: own.length,
    };
  });
}

async function completedRefundsOf(tx: Transaction, rows: readonly PaymentRow[]) {
  if (rows.length === 0) return [];
  return tx
    .select({
      billPaymentId: billPaymentRefunds.billPaymentId,
      appliedAmount: billPaymentRefunds.appliedAmount,
      tipAmount: billPaymentRefunds.tipAmount,
      state: billPaymentRefunds.state,
    })
    .from(billPaymentRefunds)
    .where(
      and(
        inArray(
          billPaymentRefunds.billPaymentId,
          rows.map((row) => row.id),
        ),
        eq(billPaymentRefunds.state, "completed"),
      ),
    );
}

async function readPaymentRows(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<PaymentRow[]> {
  if (workingOrderIds.length === 0) return [];
  return (
    tx
      .select()
      .from(billPayments)
      .where(inArray(billPayments.workingOrderId, [...workingOrderIds]))
      // Two payments can share a millisecond; a tie falls back to `rowid`, the order the rows were
      // written in.
      .orderBy(billPayments.createdAt, sql`${billPayments}.rowid`)
  );
}

/** Each payment of the bills, with what its completed refunds leave of it. */
export async function readPaymentMoney(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<PaymentMoney[]> {
  const rows = await readPaymentRows(tx, workingOrderIds);
  return moneyOf(rows, await completedRefundsOf(tx, rows));
}

/** {@link readPaymentMoney} for one payment already read. */
export async function readOnePaymentMoney(tx: Transaction, row: PaymentRow): Promise<PaymentMoney> {
  return moneyOf([row], await completedRefundsOf(tx, [row]))[0]!;
}

/** The bill's payments, oldest first, and every refund of them, oldest first. */
async function readPaymentsAndRefunds(
  tx: Transaction,
  workingOrderId: string,
): Promise<{ rows: PaymentRow[]; refunds: RefundRow[] }> {
  const rows = await readPaymentRows(tx, [workingOrderId]);
  const refunds =
    rows.length === 0
      ? []
      : await tx
          .select()
          .from(billPaymentRefunds)
          .where(
            inArray(
              billPaymentRefunds.billPaymentId,
              rows.map((row) => row.id),
            ),
          )
          // Two refunds can share a millisecond; a tie falls back to `rowid`, the order the rows
          // were written in.
          .orderBy(billPaymentRefunds.createdAt, sql`${billPaymentRefunds}.rowid`);
  return { rows, refunds };
}

async function readPaymentLines(
  tx: Transaction,
  payments: readonly PaymentMoney[],
): Promise<PaymentLineRow[]> {
  if (payments.length === 0) return [];
  return tx
    .select()
    .from(billPaymentLines)
    .where(
      inArray(
        billPaymentLines.billPaymentId,
        payments.map(({ row }) => row.id),
      ),
    );
}

function fundsOf(
  workingOrderId: string,
  total: Decimal,
  money: readonly PaymentMoney[],
): BillFunds {
  const pending = money.filter((payment) => payment.row.state === "pending");
  return {
    workingOrderId,
    total,
    received: sumDecimals(
      money
        .filter((payment) => payment.row.state === "received")
        .map((payment) => payment.netApplied),
    ),
    reserved: sumDecimals(pending.map((payment) => centsToDecimal(payment.row.applied))),
    hasPending: pending.length > 0,
  };
}

/**
 * Each line's paid quantity, in thousandths: what its pending and received item payments cover.
 * An item payment is refunded only whole (design §6), and once it is, its lines are free again.
 */
function paidQuantitiesOf(
  payments: readonly PaymentMoney[],
  lines: readonly Pick<PaymentLineRow, "billPaymentId" | "lineId" | "quantity">[],
): Map<string, number> {
  const holding = new Set(
    payments
      .filter(
        ({ row, refunds, netApplied }) =>
          (row.state === "pending" || row.state === "received") &&
          !(refunds > 0 && compareDecimal(netApplied, ZERO) === 0),
      )
      .map(({ row }) => row.id),
  );
  const paid = new Map<string, number>();
  for (const line of lines) {
    if (!holding.has(line.billPaymentId)) continue;
    paid.set(line.lineId, (paid.get(line.lineId) ?? 0) + line.quantity);
  }
  return paid;
}

/** The states in which a payment is held on its bill, one given back in full included. */
const HOLDING_STATES: readonly PaymentRow["state"][] = ["pending", "received"];

/** {@link paidQuantitiesOf} the bill, read. */
export async function readPaidQuantities(
  tx: Transaction,
  workingOrderId: string,
): Promise<ReadonlyMap<string, number>> {
  const lines = await tx
    .select({
      billPaymentId: billPaymentLines.billPaymentId,
      lineId: billPaymentLines.lineId,
      quantity: billPaymentLines.quantity,
    })
    .from(billPaymentLines)
    .innerJoin(billPayments, eq(billPayments.id, billPaymentLines.billPaymentId))
    .where(
      and(
        eq(billPayments.workingOrderId, workingOrderId),
        inArray(billPayments.state, [...HOLDING_STATES]),
      ),
    );
  if (lines.length === 0) return new Map();
  return paidQuantitiesOf(await readPaymentMoney(tx, [workingOrderId]), lines);
}

/**
 * Refuse `bill.line_paid` for the first of these lines of the bill that would hold less than its
 * paid quantity after the write: `keeps` is the quantity, in thousandths, the write leaves on that
 * line's row. A write that must not touch a paid line at all passes 0. `paid` is the bill's
 * {@link readPaidQuantities}, when the caller has read them already.
 */
export async function refusePaidLines(
  tx: Transaction,
  workingOrderId: string,
  lines: readonly { id: string; lineNo: number; keeps: number }[],
  paid?: ReadonlyMap<string, number>,
): Promise<void> {
  if (lines.length === 0) return;
  const quantities = paid ?? (await readPaidQuantities(tx, workingOrderId));
  const refused = lines.find((line) => (quantities.get(line.id) ?? 0) > line.keeps);
  if (refused !== undefined) {
    throw new AppError("bill.line_paid", { workingOrderId, lineNo: refused.lineNo });
  }
}

/**
 * The invariant of design §4.4, for the money: the net applied of each bill's received payments
 * plus the applied of its pending ones is at most its total. The line writers that take lines off
 * a bill or lower a quantity call it before they commit. No trigger stands behind it, because the
 * total is computed, not stored, so a writer that forgets it is seen only by its own tests.
 */
export async function assertBillInvariant(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<void> {
  const payments = await readPaymentMoney(tx, workingOrderIds);
  for (const workingOrderId of workingOrderIds) {
    const held = payments.filter(({ row }) => row.workingOrderId === workingOrderId);
    if (held.length === 0) continue;
    const funds = fundsOf(workingOrderId, await billPaymentTotal(tx, workingOrderId), held);
    const excess = subtractDecimal(addDecimal(funds.received, funds.reserved), funds.total);
    if (compareDecimal(excess, ZERO) > 0) {
      throw new AppError("bill.received_exceeds_total", { workingOrderId, excess: money(excess) });
    }
  }
}

function receivedHoldsMoney({ row, netApplied, netTip }: PaymentMoney): boolean {
  return row.state === "received" && compareDecimal(addDecimal(netApplied, netTip), ZERO) > 0;
}

/** A pending payment, or a received one with applied money or a tip it has not given back. */
function holdsMoney(payments: readonly PaymentMoney[]): boolean {
  return payments.some((payment) => payment.row.state === "pending" || receivedHoldsMoney(payment));
}

/** Refuse `bill.payments_received` for the first of these bills that holds money (design §4.5). */
export async function refuseBillHoldingMoney(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<void> {
  const holding = await billsHoldingMoney(tx, workingOrderIds);
  const workingOrderId = workingOrderIds.find((id) => holding.has(id));
  if (workingOrderId !== undefined) {
    throw new AppError("bill.payments_received", { workingOrderId });
  }
}

/** What an issued bill still owes: its amount due less the money its payments have kept. */
export async function stillOwedOnIssuedBill(
  tx: Transaction,
  workingOrderId: string,
  amountDue: Decimal,
): Promise<Decimal> {
  const { received } = fundsOf(
    workingOrderId,
    amountDue,
    await readPaymentMoney(tx, [workingOrderId]),
  );
  return outstandingOf(amountDue, received);
}

/** Those of these bills that hold money: a pending payment, or received money not given back. */
export async function billsHoldingMoney(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<Set<string>> {
  const payments = await readPaymentMoney(tx, workingOrderIds);
  return new Set(
    workingOrderIds.filter((workingOrderId) =>
      holdsMoney(payments.filter(({ row }) => row.workingOrderId === workingOrderId)),
    ),
  );
}

/**
 * Refuse `bill.payments_received` when the bill holds any pending or received payment, even one
 * given back in full (design §7): the single-payment routes and placing invoice the whole total as
 * one tender and link no bill payment's card to the sale (§2.5).
 */
export async function refuseBillWithPayments(
  tx: Transaction,
  workingOrderId: string,
): Promise<void> {
  if (await holdsPayment(tx, workingOrderId)) {
    throw new AppError("bill.payments_received", { workingOrderId });
  }
}

/** Whether the bill holds a pending or received payment, one given back in full included. */
export async function holdsPayment(tx: Transaction, workingOrderId: string): Promise<boolean> {
  const [held] = await tx
    .select({ id: billPayments.id })
    .from(billPayments)
    .where(
      and(
        eq(billPayments.workingOrderId, workingOrderId),
        inArray(billPayments.state, [...HOLDING_STATES]),
      ),
    )
    .limit(1);
  return held !== undefined;
}

/**
 * For these bills: the net applied money each has received, for those that have received any, the
 * bills holding a payment as {@link holdsPayment} reads it, and those holding money as
 * {@link billsHoldingMoney} reads it.
 */
export async function readPaymentsByBill(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<{ received: Map<string, Decimal>; holding: Set<string>; holdingMoney: Set<string> }> {
  const received = new Map<string, Decimal>();
  const holding = new Set<string>();
  const holdingMoney = new Set<string>();
  for (const payment of await readPaymentMoney(tx, workingOrderIds)) {
    const { state, workingOrderId: bill } = payment.row;
    if (HOLDING_STATES.includes(state)) holding.add(bill);
    if (holdsMoney([payment])) holdingMoney.add(bill);
    if (state === "received")
      received.set(bill, addDecimal(received.get(bill) ?? ZERO, payment.netApplied));
  }
  return { received, holding, holdingMoney };
}

/** A bill's `total` less what it has received, at the money scale. */
export function outstandingOf(total: Decimal, received: Decimal | undefined): Decimal {
  return received === undefined ? total : toScale(subtractDecimal(total, received), MONEY_SCALE);
}

async function readLineNos(tx: Transaction, workingOrderId: string): Promise<Map<string, number>> {
  const rows = await tx
    .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, workingOrderId));
  return new Map(rows.map((row) => [row.id, row.lineNo]));
}

export function toRefundView(refund: RefundRow): BillRefundView {
  return {
    id: refund.id,
    paymentId: refund.billPaymentId,
    submissionId: refund.submissionId,
    appliedAmount: centsToDecimal(refund.appliedAmount),
    tipAmount: centsToDecimal(refund.tipAmount),
    reason: refund.reason,
    state: refund.state,
    createdAt: refund.createdAt,
    completedAt: refund.completedAt,
  };
}

function toView(
  payment: PaymentRow,
  lines: readonly PaymentLineRow[],
  refunds: readonly RefundRow[],
  lineNos: ReadonlyMap<string, number>,
  manualCards: ReadonlyMap<string, OutsideCardDetails & { externalRef: string | null }>,
): BillPaymentView {
  const manual = manualCards.get(payment.id);
  return {
    ...outsideCardDetails(manual ?? {}),
    ...(manual?.externalRef == null ? {} : { externalRef: manual.externalRef }),
    id: payment.id,
    submissionId: payment.submissionId,
    kind: payment.kind,
    shareOf: payment.shareOf,
    method: payment.method,
    entry: payment.method === "cash" ? null : manualCards.has(payment.id) ? "manual" : "reader",
    applied: centsToDecimal(payment.applied),
    tip: centsToDecimal(payment.tip),
    tendered: payment.tendered === null ? null : centsToDecimal(payment.tendered),
    change:
      payment.tendered === null ? null : cashChange(payment.tendered, payment.applied, payment.tip),
    state: payment.state,
    createdAt: payment.createdAt,
    receivedAt: payment.receivedAt,
    lines: lines
      .filter((line) => line.billPaymentId === payment.id)
      .map((line) => ({
        lineId: line.lineId,
        lineNo: lineNos.get(line.lineId) ?? null,
        quantity: thousandthsToDecimal(line.quantity),
        amount: centsToDecimal(line.amount),
      })),
    refunds: refunds.filter((refund) => refund.billPaymentId === payment.id).map(toRefundView),
  };
}

/**
 * Point the provider row of each of these received card bill payments at the sale, a payment
 * given back in full included (design §2.5).
 */
async function linkCardBillPayments(
  tx: Transaction,
  received: readonly PaymentRow[],
  saleId: string,
): Promise<void> {
  const provided = await findPaymentsByBillPayments(
    tx,
    received.filter((row) => row.method === "card").map((row) => row.id),
  );
  for (const row of received) {
    const card = provided.get(row.id);
    // An invoice issued before the bill was paid in full linked its cards then.
    if (card !== undefined && card.saleId !== saleId) {
      await associatePaymentWithSale(tx, {
        provider: card.provider,
        paymentRef: card.paymentRef,
        saleId,
      });
    }
  }
}

/** Link the bill's received card payments to the invoice issued without them (design §2.5). */
export async function linkBillCardPaymentsToSale(
  tx: Transaction,
  workingOrderId: string,
  saleId: string,
): Promise<void> {
  const rows = await readPaymentRows(tx, [workingOrderId]);
  await linkCardBillPayments(
    tx,
    rows.filter((row) => row.state === "received"),
    saleId,
  );
}

/** The card payments keyed on a separate terminal: their provider row is the manual one, written in
 * the payment's own transaction (`takeBillPayment`). */
async function manualCardsOf(tx: Transaction, rows: readonly PaymentRow[]) {
  const provided = await findPaymentsByBillPayments(
    tx,
    rows.filter((row) => row.method === "card").map((row) => row.id),
  );
  return new Map(
    [...provided]
      .filter(([, card]) => card.provider === MANUAL_PROVIDER)
      .map(([id, card]) => [id, { ...outsideCardDetails(card), externalRef: card.externalRef }]),
  );
}

async function billPaymentTotal(
  tx: Transaction,
  id: string,
  pricedTotal?: Decimal,
): Promise<Decimal> {
  return (
    (await readOutstandingSaleForOrder(tx, id))?.amountDue ??
    pricedTotal ??
    (await storedOrderTotal(tx, id))
  );
}

/**
 * The bill's balance and its payments; `working_order.not_found` for an unknown bill. `total` is
 * the bill's total when the caller has priced its current lines in this transaction already.
 */
export async function readBillBalance(
  tx: Transaction,
  workingOrderId: string,
  total?: Decimal,
): Promise<BillBalance> {
  const [order] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  if (order === undefined) {
    throw new AppError("working_order.not_found", { workingOrderId });
  }
  const { rows, refunds } = await readPaymentsAndRefunds(tx, workingOrderId);
  const held = moneyOf(rows, refunds);
  const lines = await readPaymentLines(tx, held);
  const lineNos = await readLineNos(tx, workingOrderId);
  const manualCards = await manualCardsOf(tx, rows);
  const funds = fundsOf(workingOrderId, await billPaymentTotal(tx, workingOrderId, total), held);
  const outstanding = subtractDecimal(subtractDecimal(funds.total, funds.received), funds.reserved);
  const copyable = new Set((await readBillSlipPayments(tx, workingOrderId)).map((card) => card.id));
  const captureWarning = await findCaptureWarning(tx, { orderIds: [workingOrderId] });
  return {
    ...(captureWarning === undefined ? {} : { captureWarning }),
    workingOrderId,
    status: order.status,
    total: money(funds.total),
    received: money(funds.received),
    reserved: money(funds.reserved),
    outstanding: order.status === "open" || order.status === "placed" ? money(outstanding) : ZERO,
    tips: money(
      sumDecimals(held.filter(({ row }) => row.state === "received").map(({ netTip }) => netTip)),
    ),
    payments: held.map(({ row }) => ({
      ...toView(row, lines, refunds, lineNos, manualCards),
      ...(copyable.has(row.id) ? { canCopySlip: true as const } : {}),
    })),
    paidLines: [...paidQuantitiesOf(held, lines)]
      .flatMap(([lineId, quantity]) => {
        const lineNo = lineNos.get(lineId);
        return lineNo === undefined
          ? []
          : [{ lineId, lineNo, paidQuantity: thousandthsToDecimal(quantity) }];
      })
      .sort((a, b) => a.lineNo - b.lineNo),
  };
}

/**
 * {@link issueIfFullyPaid}, answering also the bill's total when it priced the bill. `total` is the
 * bill's total when the caller has priced its current lines in this transaction already.
 */
async function issueWhenFullyPaid(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  operatorId: string | undefined,
  options: {
    moneyMoved?: boolean;
    closeZero?: boolean;
    total?: Decimal;
    printers?: PrinterLookup;
    guestCount?: GuestCountChoice;
  },
): Promise<{ invoice: TillSaleResult | null; total?: Decimal }> {
  await requireEconomicWrite(tx, cfg, deps.admission);
  const notYet = { invoice: null, total: options.total };
  const [order] = await tx
    .select({
      status: workingOrders.status,
      partyId: workingOrders.partyId,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  if (order?.status !== "open" && order?.status !== "placed") return notYet;
  const { rows, refunds } = await readPaymentsAndRefunds(tx, workingOrderId);
  const received = rows.filter((row) => row.state === "received");
  if (
    (received.length === 0 && options.closeZero !== true) ||
    rows.some((row) => row.state === "pending")
  )
    return notYet;
  // A card refund still pending leaves the bill's received money unknown.
  if (refunds.some((refund) => refund.state === "pending")) return notYet;
  // A captured reservation must finish even if a restored draft is still open.
  if (options.moneyMoved !== true && (await readBillUnsent(tx, workingOrderId)).length > 0)
    return notYet;
  const held = moneyOf(rows, refunds);
  const issued = await readOutstandingSaleForOrder(tx, workingOrderId);
  const total = issued?.amountDue ?? options.total ?? (await storedOrderTotal(tx, workingOrderId));
  const zero = compareDecimal(total, ZERO) === 0;
  if (zero && options.closeZero !== true) return { invoice: null, total };
  if (compareDecimal(fundsOf(workingOrderId, total, held).received, total) !== 0) {
    return { invoice: null, total };
  }
  if (zero && held.some(receivedHoldsMoney)) return { invoice: null, total };
  const tendersOfBill: SettleSaleTender[] = held
    .filter(receivedHoldsMoney)
    .sort((a, b) => a.row.receivedAt!.localeCompare(b.row.receivedAt!))
    .map(({ row, netApplied, netTip }) => ({
      method: row.method,
      amount: money(addDecimal(netApplied, netTip)),
      tipAmount: money(netTip),
      cashTendered: row.tendered === null ? null : centsToDecimal(row.tendered),
      settledAt: new Date(row.receivedAt!),
      billPaymentId: row.id,
    }));

  const lastReceipt = received
    .map((row) => row.receivedAt!)
    .reduce<string | undefined>(
      (latest, at) => (latest === undefined || at > latest ? at : latest),
      undefined,
    );
  if (issued !== undefined) {
    const settledAt = zero ? deps.clock.now().instant : new Date(lastReceipt!);
    await settleIssuedOrder(
      tx,
      { workingOrderId, saleId: issued.saleId },
      tendersOfBill,
      settledAt,
      deps.log,
    );
    await linkCardBillPayments(tx, received, issued.saleId);
    const ticket = await readSettledTicket(deps.backend, tx, cfg, workingOrderId);
    if (!zero) await enqueueSaleReceipt(tx, cfg, ticket, issued.saleId, options.printers);
    return { invoice: ticket, total };
  }

  // A card already captured cannot be undone by refusing its invoice, so a line whose product has
  // since gone off sale is filed as it stands, as a whole-order card recovery files it.
  let stored: GrossOrder;
  try {
    stored = await priceStoredOrderForIssuance(tx, workingOrderId, {
      refuseUnsentUnavailable: options.moneyMoved !== true,
    });
  } catch (error) {
    // Automatic issuance must leave an edit intact while set-menu billing is unavailable.
    if (isAppError(error) && error.code === "set_menu.payment_not_ready") {
      return { invoice: null, total };
    }
    throw error;
  }
  const { priced, clock, gross } = issueMoment(
    await prepareIssueClock(tx, cfg, deps.clock),
    await issuancePass(tx, workingOrderId, stored),
    deps.backend,
  );
  const selected = await selectOrderInvoice(tx, deps.backend, cfg, workingOrderId, priced.total);
  const language = await saleLanguageFor(tx, selected.receiptLocale, {
    log: deps.log,
    workingOrderId,
  });
  const operationDescription = await readSaleOperationDescription(tx, cfg, {
    kind: "order",
    orderId: workingOrderId,
  });
  const { saleId, fiscal } = await recordSale(tx, deps.backend, {
    receipt: await saleReceiptFacts(
      tx,
      workingOrderId,
      selected.sale.counterparty,
      options.guestCount,
    ),
    origin: cfg.origin,
    nodeId: cfg.nodeId,
    ...selected.sale,
    operationDescription,
    workingOrderId: brandWorkingOrderId(workingOrderId),
    ...language,
    total: priced.total,
    lines: withReceiptListPrices(priced.lines, stored.identities),
    vatBreakdown: priced.vatBreakdown,
    clock,
    operatorId,
    settlement: { kind: "deferred" },
  });
  await linkSaleDishes(tx, saleId, stored.identities);
  await settleSale(tx, { saleId, tenders: tendersOfBill });
  await linkCardBillPayments(tx, received, saleId);

  const notSent = await fireDishesAtPayment(tx, cfg, workingOrderId, order.partyId);
  await storePrepayMadeHere(tx, workingOrderId, [...(cfg.madeHereSink ?? [])]);
  const settledAt = zero ? clock.now().instant.toISOString() : lastReceipt!;
  const receiptOrder = await readReceiptOrder(tx, workingOrderId, { atIssuance: true });
  await tx
    .update(workingOrders)
    .set({ label: receiptOrder.orderLabel, status: "settled", settledAt })
    .where(eq(workingOrders.id, workingOrderId));
  await VENUE_SERVICE.withdrawPendingDepartmentTransfers(tx, [workingOrderId]);
  await clearBillRequestIfPaid(tx, workingOrderId, deps.log);
  if (notSent !== null) {
    await raiseDishesNotSent(
      tx,
      cfg,
      saleId,
      workingOrderId,
      notSent,
      deps.clock.now().instant,
      deps.log,
    );
  }

  if (fiscal === undefined) {
    const ticket = await readSettledTicket(deps.backend, tx, cfg, workingOrderId);
    await enqueueSaleReceipt(tx, cfg, ticket, saleId, options.printers);
    return { invoice: ticket, total };
  }
  const ticket = {
    ...(await readReceiptIssuer(deps.backend, tx, saleId)),
    ...(await readReceiptPresentation(tx, saleId, language.locale, cfg.practiceMode === true)),
    invoiceType: selected.invoiceType,
    ...(selected.recipient === undefined ? {} : { recipient: selected.recipient }),
    ...receiptOrder,
    locale: language.locale,
    namesLocale: language.invoiceLocales[0]!,
    invoiceNumber: await readInvoiceNumber(tx, saleId),
    issuedAt: fiscal.issuedAt.toISOString(),
    total: priced.total,
    vatBreakdown: toVatBreakdown(priced.vatBreakdown),
    ...(await receiptLines(tx, workingOrderId, gross, stored.identities, saleId)),
    tender: await readTenderBlock(tx, saleId, workingOrderId),
    ...(zero ? {} : { payments: await readBillTenderLines(tx, saleId) }),
    ...receiptQr(deps.backend, fiscal.verificationUrl),
  };
  await enqueueSaleReceipt(tx, cfg, ticket, saleId, options.printers);
  return { invoice: ticket, total };
}

export async function issueIfFullyPaid(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  operatorId?: string,
  options: { moneyMoved?: boolean; closeZero?: boolean } = {},
): Promise<TillSaleResult | null> {
  return (await issueWhenFullyPaid(tx, deps, cfg, workingOrderId, operatorId, options)).invoice;
}

interface ItemsDue {
  due: Decimal;
  rows: { lineId: string; quantity: number; amount: number }[];
}

/**
 * What an item payment's lines cost, and the rows it records. Whole units only for a line sold by
 * the unit; a weighed line, and a dish with extras, whose extras are paid with it, only whole. A
 * held line may be paid for. `held` is the bill's {@link readPaymentMoney}.
 */
async function itemsDue(
  tx: Transaction,
  workingOrderId: string,
  requested: readonly { lineNo: number; quantity?: string }[],
  held: readonly PaymentMoney[],
): Promise<ItemsDue> {
  if (requested.length === 0) throw invalid("lines");
  if (new Set(requested.map((line) => line.lineNo)).size !== requested.length) {
    throw invalid("lines");
  }
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      quantity: workingOrderLines.quantity,
      unitPriceGross: workingOrderLines.unitPriceGross,
      unitPrecision: workingOrderLines.unitPrecision,
      lineTotal: workingOrderLines.lineTotal,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, workingOrderId));
  const paid = paidQuantitiesOf(held, await readPaymentLines(tx, held));
  const byLineNo = new Map(lines.map((line) => [line.lineNo, line]));
  const childrenOf = new Map<string, (typeof lines)[number][]>();
  for (const line of lines) {
    if (line.parentLineId === null) continue;
    const siblings = childrenOf.get(line.parentLineId);
    if (siblings === undefined) childrenOf.set(line.parentLineId, [line]);
    else siblings.push(line);
  }
  const rows: ItemsDue["rows"] = [];
  for (const asked of requested) {
    const line = byLineNo.get(asked.lineNo);
    if (line === undefined) {
      throw new AppError("tab.line_not_found", { tabId: workingOrderId, lineNo: asked.lineNo });
    }
    if (line.parentLineId !== null) throw invalid("lines");
    const children = childrenOf.get(line.id) ?? [];
    let quantity = line.quantity;
    if (asked.quantity !== undefined) {
      try {
        assertQuantityPrecision(asked.quantity, 0, { positive: true });
        quantity = stringToThousandths(asked.quantity);
      } catch {
        throw invalid("lines");
      }
      if (quantity > line.quantity) throw invalid("lines");
      const whole = quantity === line.quantity;
      if (!whole && (children.length > 0 || (line.unitPrecision ?? 0) !== 0)) {
        throw invalid("lines");
      }
    }
    const already = [line, ...children].some((part) => (paid.get(part.id) ?? 0) > 0);
    if ((paid.get(line.id) ?? 0) + quantity > line.quantity || (children.length > 0 && already)) {
      throw new AppError("bill.line_paid", { workingOrderId, lineNo: line.lineNo });
    }
    rows.push({
      lineId: line.id,
      quantity,
      amount:
        quantity === line.quantity
          ? line.lineTotal
          : decimalToCents(
              money(
                multiplyDecimal(
                  centsToDecimal(line.unitPriceGross),
                  thousandthsToDecimal(quantity),
                ),
              ),
            ),
    });
    for (const child of children) {
      rows.push({ lineId: child.id, quantity: child.quantity, amount: child.lineTotal });
    }
  }
  return { due: sumDecimals(rows.map((row) => centsToDecimal(row.amount))), rows };
}

async function allocationRequestFor(
  tx: Transaction,
  workingOrderId: string,
  ask: BillPaymentAsk,
  held: readonly PaymentMoney[],
): Promise<{ request: AllocationRequest; items: ItemsDue | null }> {
  const addedTip = decimal(ask.addedTip ?? "0.00");
  const payment =
    ask.method === "cash"
      ? { method: "cash" as const, tendered: decimal(ask.tendered!), addedTip }
      : { method: "card" as const, addedTip };
  const choice = ask.choice === undefined ? {} : { choice: ask.choice };
  switch (ask.kind) {
    case "items": {
      const items = await itemsDue(tx, workingOrderId, ask.lines ?? [], held);
      return { request: { kind: "items", due: items.due, payment, ...choice }, items };
    }
    case "contribution":
      return {
        request: { kind: "contribution", amount: decimal(ask.amount!), payment, ...choice },
        items: null,
      };
    case "share":
      return {
        request: { kind: "share", shareOf: ask.shareOf!, payment, ...choice },
        items: null,
      };
  }
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

async function hasInvoice(tx: Transaction, workingOrderId: string): Promise<boolean> {
  const [invoice] = await tx
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.workingOrderId, workingOrderId))
    .limit(1);
  return invoice !== undefined;
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
  held?: PaymentMoney[];
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
    const held = await readPaymentMoney(tx, [workingOrderId]);
    return { ...order, status: "placed", held, invoiced: true };
  }
  throw new AppError("working_order.not_open", { workingOrderId });
}

/** Design §3.6: what a payment of the bill would be, writing nothing. */
export async function previewBillPayment(
  deps: TillSaleDeps,
  cfg: TradingContext,
  workingOrderId: string,
  ask: BillPaymentAsk,
  operatorId: string | undefined,
): Promise<AllocationPreview> {
  return withTransaction(deps.db, async (tx) => {
    const payable = await requirePayableBill(tx, workingOrderId);
    refuseOtherDining(workingOrderId, payable, ask.dining);
    if (payable.status === "placed") {
      await refusePlacedPaymentInFlight(deps.db, tx, [workingOrderId], { wholeOrderOnly: true });
    }
    await requireOrderBillEditor(tx, workingOrderId, {
      operatorId,
      expectedEdit: ask.expectedEdit,
    });
    await assertBillHasNoUnsent(tx, workingOrderId);
    const held = payable.held ?? (await readPaymentMoney(tx, [workingOrderId]));
    const { request } = await allocationRequestFor(tx, workingOrderId, ask, held);
    const funds = fundsOf(workingOrderId, await billPaymentTotal(tx, workingOrderId), held);
    return previewAllocation(funds, request, { tipsEnabled: cfg.tipsEnabled });
  });
}

/** `total` is the bill's total when the caller has priced its current lines in this transaction
 * already. */
async function resultOf(
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

/** A payment request as its retry fingerprint reads it: the lines in line order and every amount at
 * the money scale, an absent added tip as none, so a resend that spells the same request another
 * way is the same request. `guestCount` is left out: a resend is matched on the payment alone. */
export function retryShapeOf(req: BillPaymentRequest): Record<string, unknown> {
  const scaled = (value: string | undefined) =>
    value === undefined ? undefined : money(decimal(value));
  return {
    ...req,
    expectedEdit: req.expectedEdit == null ? null : parseBillEditExpected(req.expectedEdit),
    guestCount: undefined,
    printCardSlip: undefined,
    lines: req.lines?.slice().sort((a, b) => a.lineNo - b.lineNo),
    amount: scaled(req.amount),
    tendered: scaled(req.tendered),
    addedTip: scaled(req.addedTip ?? "0"),
    applied: scaled(req.applied),
    tip: scaled(req.tip),
  };
}

/** What already uses `submissionId` on the bill (design §5.1): one of its payments, or a refund of
 * one of them. */
export async function findSubmission(
  tx: Transaction,
  workingOrderId: string,
  submissionId: string,
): Promise<{ payment: PaymentRow | undefined; refund: RefundRow | undefined }> {
  const [payment] = await tx
    .select()
    .from(billPayments)
    .where(
      and(
        eq(billPayments.workingOrderId, workingOrderId),
        eq(billPayments.submissionId, submissionId),
      ),
    );
  const [found] = await tx
    .select({ refund: billPaymentRefunds })
    .from(billPaymentRefunds)
    .innerJoin(billPayments, eq(billPayments.id, billPaymentRefunds.billPaymentId))
    .where(
      and(
        eq(billPayments.workingOrderId, workingOrderId),
        eq(billPaymentRefunds.submissionId, submissionId),
      ),
    );
  return { payment, refund: found?.refund };
}

async function requireReadyForPayment(
  tx: Transaction,
  db: Database,
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
  await refuseSetMenuMoney(tx, workingOrderId);
  await refuseRefundInProgress(tx, [workingOrderId]);
  await refuseOrderPaymentMarked(tx, [workingOrderId]);
  // A part payment's card reserves its share, as on an open bill (design §5.2).
  if (payable.status === "placed") {
    await refusePlacedPaymentInFlight(db, tx, [workingOrderId], { wholeOrderOnly: true });
  }
}

/** Close a zero bill through Pay using the same issuance transaction as a money payment. */
export async function closeZeroBill(
  deps: BillPaymentDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  req: BillPaymentRequest,
  operator: { personId: string; sessionId: string },
): Promise<{ outcome: "settled"; balance: BillBalance; invoice: TillSaleResult }> {
  const preRead = deps.disk !== undefined && deps.disk.since() !== null && (await deps.disk.full());
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
      if (balance.status === "settled") {
        return {
          outcome: "settled",
          balance,
          invoice: await readSettledTicket(deps.backend, tx, cfg, workingOrderId),
        };
      }

      const payable = await requirePayableBill(tx, workingOrderId);
      await requireReadyForPayment(tx, deps.db, workingOrderId, payable, operator, req);
      if (preRead || (deps.disk?.noted() ?? false)) refuseForDiskStop(deps.log, workingOrderId);
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
        { closeZero: true, total: ZERO, guestCount: req.guestCount },
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
      return { outcome: "settled", balance: await readBillBalance(tx, workingOrderId), invoice };
    },
    deps.log,
  );
}

/**
 * The start every payment of a bill shares, in the caller's transaction: the operator must still
 * be signed in on the requesting device ({@link assertStillSignedIn}); a retry finds its first row;
 * otherwise the bill must be payable (`requirePayableBill`) with no payment of the whole order in
 * flight, the allocation must be the one the operator saw (design §3.6), and the payment and its
 * lines are inserted in `state`. A new payment answers the bill's total too, which the insert
 * leaves as it was.
 *
 * Keyed by `submissionId` within the bill (design §5.1): the same payment again, whatever its
 * `guestCount`, answers the first row and writes nothing; the id with another payment, or naming one of
 * the bill's refunds, is `submission.id_reused`.
 */
async function beginBillPayment(
  tx: Transaction,
  deps: BillPaymentDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  req: BillPaymentRequest,
  operator: { personId: string; sessionId: string },
  state: "received" | "pending",
  read: TillSaleDeps["clock"]["now"],
  refusals: { diskFull: () => boolean; log?: Logger },
  attendance?: AttendanceRecorder,
): Promise<{ replay: PaymentRow } | { payment: PaymentRow; total: Decimal }> {
  // Before the replay lookup: a retry the route would now refuse is refused too.
  await assertStillSignedIn(tx, {
    deviceId: cfg.origin.deviceId,
    sessionId: operator.sessionId,
    personId: operator.personId,
  });
  const print = fingerprint(retryShapeOf(req));
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
  deps.admission.require();
  const reading = read();
  if (!Number.isFinite(reading.instant.getTime()))
    throw new AppError("venue.time_zone_conversion_failed", { reason: "invalid_instant" });
  await deps.backend.refuseUntilRecordable(tx, reading);
  await deps.backend.refuseNewIssuance(tx, cfg.nodeId);

  const payable = await requirePayableBill(tx, workingOrderId);
  await requireReadyForPayment(tx, deps.db, workingOrderId, payable, operator, req);
  const held = payable.held ?? (await readPaymentMoney(tx, [workingOrderId]));
  const { request, items } = await allocationRequestFor(tx, workingOrderId, req, held);
  const total = await billPaymentTotal(tx, workingOrderId);
  deps.backend.assertRecordableAt(reading);
  if (refusals.diskFull()) refuseForDiskStop(refusals.log, workingOrderId);
  if (!payable.invoiced) {
    await selectOrderInvoice(tx, deps.backend, cfg, workingOrderId, total);
    await readSaleOperationDescription(tx, cfg, { kind: "order", orderId: workingOrderId });
  }
  const funds = fundsOf(workingOrderId, total, held);
  const allocation = confirmAllocation(
    funds,
    request,
    { tipsEnabled: cfg.tipsEnabled },
    {
      applied: decimal(req.applied),
      tip: decimal(req.tip),
    },
  );
  // A reserved card may finish on recovery, so save the language once the bill is covered.
  if (
    req.receiptLanguage !== undefined &&
    !payable.invoiced &&
    compareDecimal(sumDecimals([funds.received, funds.reserved, allocation.applied]), total) === 0
  )
    await storeSentReceiptLanguage(tx, workingOrderId, payable, req.receiptLanguage);

  await requireEconomicWrite(tx, cfg, deps.admission);
  if (state === "pending") await prepareIssueClock(tx, cfg, pinnedAt(deps.clock, reading));
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
      state,
      requestedBy: operator.personId,
      source: cfg.origin.source,
      deviceId: cfg.origin.deviceId,
      receivedAt: state === "received" ? reading.instant.toISOString() : null,
    })
    .returning();
  if (items !== null) {
    await insertInChunks(
      tx,
      billPaymentLines,
      items.rows.map((row) => ({ billPaymentId: payment!.id, ...row })),
    );
  }
  await captureBillPaymentAttendance(tx, payment!, attendance, {
    at: reading.instant.toISOString(),
  });
  return { payment: payment!, total };
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
): Promise<BillPaymentResult> {
  // Awaited only while `since()` names a refusal: otherwise the payment enters the write queue in
  // this turn.
  const preRead = deps.disk !== undefined && deps.disk.since() !== null && (await deps.disk.full());
  return withIssuanceTransaction(
    deps.db,
    async (tx) => {
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
      );
      if ("replay" in begun) return resultOf(tx, deps, cfg, begun.replay, null);
      const { payment } = begun;
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
      const { invoice, total } = await issueWhenFullyPaid(
        tx,
        deps,
        cfg,
        workingOrderId,
        operator.personId,
        {
          total: begun.total,
          printers,
          guestCount: req.guestCount,
        },
      );
      return resultOf(tx, deps, cfg, payment, invoice, total);
    },
    deps.log,
  );
}

/** The card bill payments at a reader in this process, by id: a pending payment missing here is
 * one no attempt is still driving. */
const liveBillPaymentsOf = perDatabase(() => new Set<string>());

/** Whether a card for this bill payment is at a reader in this process. */
export function billPaymentIsLive(db: Database, billPaymentId: string): boolean {
  return liveBillPaymentsOf(db).has(billPaymentId);
}

/** A post-capture refusal must not describe a completed charge as declined. */
export async function afterCardCharged<T>(
  deps: { sayCardChargedNotRecorded?: boolean; log?: Logger },
  workingOrderId: string,
  work: () => Promise<T>,
): Promise<T> {
  if (deps.sayCardChargedNotRecorded !== true) return work();
  try {
    return await work();
  } catch (error) {
    const reason = notRecordedReason(error);
    if (reason === null) throw error;
    const recoveryUrl =
      error instanceof IssuanceRefusedError
        ? (error.params as Record<string, unknown>).recoveryUrl
        : undefined;
    throw chargedNotRecorded(
      deps.log,
      workingOrderId,
      reason,
      typeof recoveryUrl === "string" ? recoveryUrl : undefined,
    );
  }
}

export function clockUnconfirmedRefusal(error: unknown): boolean {
  return error instanceof AppError && error.code === "clock.unconfirmed";
}

function notRecordedReason(error: unknown): NotRecordedReason | null {
  if (error instanceof IssuanceRefusedError || isUniqueViolation(error)) return "issuance_refused";
  if (diskFullIn(error) || firstCodeInCauseChain(error, (code) => code === "ENOSPC") !== null)
    return "disk_full";
  if (error instanceof AppError && error.code === "clock.unusable") return "clock_unusable";
  if (clockUnconfirmedRefusal(error)) return "clock_unconfirmed";
  return null;
}

/**
 * What a failed `collect` is answered with. When `deps` opts in, a charge the provider could not
 * save for a full disk ({@link ChargeNotSavedError}) becomes `sale.charged_not_recorded`; any
 * other failure, a full disk before the charge among them, passes through unchanged.
 */
export function collectFailure(
  deps: { sayCardChargedNotRecorded?: boolean; log?: Logger },
  workingOrderId: string,
  error: unknown,
): unknown {
  if (deps.sayCardChargedNotRecorded !== true || !(error instanceof ChargeNotSavedError)) {
    return error;
  }
  return chargedNotRecorded(deps.log, workingOrderId, "disk_full");
}

type NotRecordedReason = "disk_full" | "clock_unusable" | "clock_unconfirmed" | "issuance_refused";

/** Carries no cause: the error boundary answers `storage.disk_full` for any full disk in the chain. */
function chargedNotRecorded(
  log: Logger | undefined,
  workingOrderId: string,
  reason: NotRecordedReason,
  recoveryUrl?: string,
): AppError {
  log?.("error", "sale.charged_not_recorded", { workingOrderId });
  return new AppError("sale.charged_not_recorded", {
    workingOrderId,
    reason,
    ...(recoveryUrl === undefined ? {} : { recoveryUrl }),
  });
}

/** {@link takeReaderBillPayment}'s deps: the fiscal ones, and the reader's provider. */
export type ReaderBillPaymentDeps = BillPaymentDeps & {
  provider: PaymentProvider;
  /** The chosen reader's vendor reference, passed to `collect`; absent for the simulator. */
  readerRef?: string;
  /** The device profile the route checked the request under, passed to `collect`. */
  deviceProfileId?: string;
  /** The chosen reader's `card_readers.id`, passed to `collect`; absent for the simulator. */
  readerId?: string;
  /**
   * Report a known charge separately when storage, the clock or held issuance prevents its invoice.
   */
  sayCardChargedNotRecorded?: boolean;
};

/** Who confirmed a payment's or a refund's outcome by hand, and their note. */
export interface Attestation {
  attestedBy: string;
  note: string;
}

/** The columns an attested outcome writes beside its state. */
export function attestationColumns(attestation: Attestation | undefined) {
  return attestation === undefined
    ? {}
    : { attestedBy: attestation.attestedBy, attestationNote: attestation.note };
}

/** Receive a pending card payment at its settlement time, then issue when fully paid.
 * A partial refund requires explicit net amounts: the gross provider charge includes returned money. */
export async function completeBillPayment(
  tx: Transaction,
  deps: BillPaymentDeps,
  cfg: TradingContext,
  billPaymentId: string,
  receivedAt: Date,
  attestation?: Attestation,
  guestCount?: GuestCountChoice,
  confirmedNet?: { applied: Decimal; tip: Decimal },
): Promise<{ payment: PaymentRow; invoice: TillSaleResult | null; total?: Decimal }> {
  await requireEconomicWrite(tx, cfg, deps.admission);
  const [pending] = await tx
    .select({
      applied: billPayments.applied,
      workingOrderId: billPayments.workingOrderId,
      method: billPayments.method,
    })
    .from(billPayments)
    .where(eq(billPayments.id, billPaymentId));
  const provided = await findPaymentByBillPayment(tx, billPaymentId);
  if (provided?.state === "partially_refunded") {
    const refunds = await tx
      .select()
      .from(paymentRefunds)
      .where(and(eq(paymentRefunds.paymentId, provided.id), eq(paymentRefunds.state, "succeeded")));
    const net = subtractDecimal(
      decimal(provided.amount),
      sumDecimals(refunds.map((r) => centsToDecimal(r.amount))),
    );
    if (
      !confirmedNet ||
      compareDecimal(net, ZERO) <= 0 ||
      compareDecimal(addDecimal(confirmedNet.applied, confirmedNet.tip), net) !== 0
    )
      throw new AppError("bill.attestation_contradicted", {
        id: billPaymentId,
        evidence: "captured",
      });
  } else if (confirmedNet) {
    throw new AppError("bill.attestation_contradicted", {
      id: billPaymentId,
      evidence: "captured",
    });
  }
  const actual = confirmedNet
    ? decimalToCents(addDecimal(confirmedNet.applied, confirmedNet.tip))
    : provided !== undefined && provided.state === "captured"
      ? decimalToCents(decimal(provided.amount))
      : undefined;
  const applied = confirmedNet
    ? decimalToCents(confirmedNet.applied)
    : actual === undefined
      ? undefined
      : Math.min(pending!.applied, actual);
  let remainingAfter: number | undefined;
  if (pending!.method === "card") {
    const funds = fundsOf(
      pending!.workingOrderId,
      await billPaymentTotal(tx, pending!.workingOrderId),
      await readPaymentMoney(tx, [pending!.workingOrderId]),
    );
    remainingAfter = decimalToCents(
      subtractDecimal(
        subtractDecimal(funds.total, funds.received),
        centsToDecimal(applied ?? pending!.applied),
      ),
    );
  }
  const [payment] = await tx
    .update(billPayments)
    .set({
      remainingAfter,
      applied,
      tip: actual === undefined ? undefined : actual - applied!,
      state: "received",
      receivedAt: receivedAt.toISOString(),
      ...attestationColumns(attestation),
    })
    .where(eq(billPayments.id, billPaymentId))
    .returning();
  const issued = await issueWhenFullyPaid(
    tx,
    deps,
    // The invoice is filed under the device that took the payment, whoever completes it.
    { ...cfg, origin: storedDeviceOrigin(payment!) },
    payment!.workingOrderId,
    payment!.requestedBy,
    { moneyMoved: true, guestCount },
  );
  return { payment: payment!, ...issued };
}

/** A card bill payment that charged nothing becomes `failed`, releasing its reservation. Its callers
 * have read it pending, as {@link completeBillPayment}'s have. */
export async function failBillPayment(
  tx: Transaction,
  billPaymentId: string,
  failedAt: Date,
  attestation?: Attestation,
): Promise<PaymentRow> {
  const [payment] = await tx
    .update(billPayments)
    .set({
      state: "failed",
      failedAt: failedAt.toISOString(),
      ...attestationColumns(attestation),
    })
    .where(eq(billPayments.id, billPaymentId))
    .returning();
  return payment!;
}

/** These outcomes leave no retained charge to allocate to the bill. */
const NO_RETAINED_CHARGE: ReadonlySet<PaymentResultState> = new Set([
  "failed",
  "network_unavailable",
  "refunded",
]);

/** `insertAttempting` (`@waitron/payments`) refuses these before the provider's first write: the
 * SumUp and Stripe terminal providers call it before any write or network call, and the reader
 * codes also come from `assertReaderStartable`, which the test provider calls first. So no money
 * moved, and the reservation can go now rather than at the loop's next pass. */
const REFUSED_START: ReadonlySet<string> = new Set([
  "device.profile_changed",
  "reader.not_held",
  "reader.payment_in_progress",
]);

/**
 * A retry of a payment already taken, whose own sign-in is open on an active till (the first sign-in
 * or a later one), answers its state and never collects again.
 */
export async function takeReaderBillPayment(
  deps: ReaderBillPaymentDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  req: BillPaymentRequest,
  operator: { personId: string; sessionId: string },
): Promise<BillPaymentResult> {
  let release = (): void => {};
  try {
    // Read before the queue wait; `noted()` then catches a refusal noted while this payment waited.
    // Awaited only while `since()` names a refusal: otherwise payment preparation enters the write
    // queue in this turn.
    const preRead =
      deps.disk !== undefined && deps.disk.since() !== null && (await deps.disk.full());
    const begun = await withTransaction(deps.db, async (tx) => {
      const started = await beginBillPayment(
        tx,
        deps,
        cfg,
        workingOrderId,
        req,
        operator,
        "pending",
        () => deps.clock.now(),
        { diskFull: () => preRead || (deps.disk?.noted() ?? false), log: deps.log },
        deps.attendance,
      );
      if ("replay" in started) {
        return {
          kind: "replay" as const,
          result: await resultOf(tx, deps, cfg, started.replay, null),
        };
      }
      // Inside the transaction, so no loop pass runs between the insert and its registration.
      release = claimLive(liveBillPaymentsOf(deps.db), started.payment.id);
      return {
        kind: "collect" as const,
        payment: started.payment,
        slip: await freezeCardSlip(tx, cfg, workingOrderId, req.printCardSlip, deps.readerId),
      };
    });
    if (begun.kind === "replay") return begun.result;
    const { payment } = begun;
    if (deps.disk?.noted() === true) {
      await withTransaction(deps.db, (tx) =>
        failBillPayment(tx, payment.id, deps.clock.now().instant, undefined),
      );
      refuseForDiskStop(deps.log, workingOrderId);
    }

    let result: PaymentResult;
    try {
      result = await deps.provider.collect({
        origin: cfg.origin,
        workingOrderId: brandWorkingOrderId(workingOrderId),
        nodeId: cfg.nodeId,
        amount: centsToDecimal(payment.applied + payment.tip),
        ...(deps.readerRef === undefined ? {} : { readerRef: deps.readerRef }),
        ...(deps.readerId === undefined ? {} : { readerId: deps.readerId }),
        ...(deps.deviceProfileId === undefined ? {} : { deviceProfileId: deps.deviceProfileId }),
        simulationOutcome: req.simulationOutcome,
        billPaymentId: payment.id,
        requestedBy: operator.personId,
      });
    } catch (error) {
      if (isAppError(error) && REFUSED_START.has(error.code)) {
        await withTransaction(deps.db, async (tx) => {
          await requireEconomicWrite(tx, cfg, deps.admission);
          return failBillPayment(tx, payment.id, deps.clock.now().instant, undefined);
        });
      }
      throw collectFailure(deps, workingOrderId, error);
    }

    if (result.state === "partially_refunded")
      throw new AppError("sale.charged_not_recorded", { workingOrderId, reason: "partial_refund" });

    if (result.state === "captured") {
      // A captured result carries its time (`PaymentResult`, provider.ts).
      const settledAt = result.settledAt!;
      // Wrapped outside the transaction: when a full disk ended it or refused its commit,
      // `withTransaction` throws the store's own error (`failure` in `node-sqlite-adapter.ts`).
      const answer = await afterCardCharged(deps, workingOrderId, () =>
        withIssuanceTransaction(
          deps.db,
          async (tx) => {
            const done = await completeBillPayment(
              tx,
              deps,
              cfg,
              payment.id,
              settledAt,
              undefined,
              req.guestCount,
            );
            return resultOf(tx, deps, cfg, done.payment, done.invoice, done.total);
          },
          deps.log,
        ),
      );
      return {
        ...answer,
        ...(await printCapturedCardSlip(
          deps.db,
          cfg,
          workingOrderId,
          result,
          begun.slip,
          undefined,
          deps.log,
        )),
      };
    }
    return await withTransaction(deps.db, async (tx) => {
      await requireEconomicWrite(tx, cfg, deps.admission);
      if (!NO_RETAINED_CHARGE.has(result.state)) {
        const answer = await resultOf(tx, deps, cfg, payment, null);
        return { ...answer, outcome: "timeout" };
      }
      const failed = await failBillPayment(tx, payment.id, deps.clock.now().instant, undefined);
      return {
        ...(await resultOf(tx, deps, cfg, failed, null)),
        outcome: result.state === "network_unavailable" ? "network_unavailable" : "declined",
      };
    });
  } finally {
    release();
  }
}

/** Reads a bill's balance in its own transaction. */
export async function getBillBalance(
  deps: Pick<TillSaleDeps, "db">,
  workingOrderId: string,
): Promise<BillBalance> {
  return withTransaction(deps.db, (tx) => readBillBalance(tx, workingOrderId));
}
