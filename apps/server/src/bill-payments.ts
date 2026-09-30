import { and, eq, inArray } from "drizzle-orm";
import {
  billPaymentLines,
  billPaymentRefunds,
  billPayments,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { assertQuantityPrecision } from "@waitron/catalogue";
import {
  AppError,
  addDecimal,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  MONEY_SCALE,
  multiplyDecimal,
  stringToThousandths,
  subtractDecimal,
  sumDecimals,
  thousandthsToDecimal,
  tillId as brandTillId,
  toScale,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { recordSale, settleSale } from "@waitron/core";
import type { SettleSaleTender } from "@waitron/core";
import {
  associatePaymentWithSale,
  findPaymentsByBillPayments,
  recordManualCardPayment,
} from "@waitron/payments";
import type { PaymentProvider, PaymentResult, PaymentResultState } from "@waitron/payments";
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
import { issueMoment } from "./issue-moment.js";
import { claimLive, perDatabase } from "./live-in-process.js";
import { readReceiptIssuer } from "./receipt-issuer.js";
import { ticketLinesFrom } from "./receipt-lines.js";
import { readReceiptOrder } from "./receipt-order.js";
import { enqueueBillPaymentDrawer, enqueueSaleReceipt } from "./receipt-print.js";
import type { TillConfig } from "./till-config.js";
import {
  firePrepayOrder,
  readBillTenderLines,
  readSettledTicket,
  readTenderBlock,
} from "./till-sale.js";
import type { TillSaleResult } from "./till-sale.js";
import { fingerprint } from "./parties.js";
import {
  priceStoredOrder,
  priceStoredOrderForIssuance,
  readInvoiceNumber,
  refuseOrderPaymentMarked,
  refuseRefundInProgress,
  toVatBreakdown,
} from "./working-order.js";
import type { TillSaleDeps } from "./working-order.js";
import { clearBillRequestIfPaid } from "./bill-request.js";
import "./errors.js";

/**
 * Payments taken against a bill before its invoice exists (bill payments design): the balance they
 * leave, the rules every write to a bill keeps while it holds them, and the invoice issued by the
 * write that leaves the bill fully paid.
 */

/** What a payment request asks for, before the operator has seen an allocation. */
export interface BillPaymentAsk {
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
export interface BillPaymentRequest extends BillPaymentAsk {
  submissionId: string;
  /** A card only: `manual` is a card charged on a terminal the POS does not drive, `reader` one
   * the provider drives. */
  entry?: "manual" | "reader";
  /** A hand-keyed card's terminal operation number. */
  externalRef?: string;
  /** A reader card only, passed to the provider's `collect`. */
  simulationOutcome?: "captured" | "declined";
  applied: string;
  tip: string;
}

/** Money given back from one bill payment before the invoice. */
export interface BillRefundView {
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

export interface BillPaymentView {
  id: string;
  submissionId: string;
  kind: "items" | "contribution" | "share";
  shareOf: number | null;
  method: "cash" | "card";
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
  workingOrderId: string;
  status: "open" | "placed" | "settled" | "abandoned";
  total: Decimal;
  /** The net applied of the received payments. */
  received: Decimal;
  /** The applied amount of the pending payments. */
  reserved: Decimal;
  outstanding: Decimal;
  /** The net tips of the received payments. */
  tips: Decimal;
  payments: BillPaymentView[];
  paidLines: { lineId: string; lineNo: number; paidQuantity: Decimal }[];
}

export interface BillPaymentResult {
  /** The payment's state; a reader card's own answer is `declined`, `timeout` (still pending) or
   * `network_unavailable` (failed, nothing charged). A retry answers the state it finds. */
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
  return tx
    .select()
    .from(billPayments)
    .where(inArray(billPayments.workingOrderId, [...workingOrderIds]))
    .orderBy(billPayments.createdAt, billPayments.id);
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
          .orderBy(billPaymentRefunds.createdAt, billPaymentRefunds.id);
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

async function billTotal(tx: Transaction, workingOrderId: string): Promise<Decimal> {
  const [line] = await tx
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, workingOrderId))
    .limit(1);
  // The same pricing the invoice is issued from; a lineless bill totals nothing.
  return line === undefined ? ZERO : (await priceStoredOrder(tx, workingOrderId)).total;
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
    const funds = fundsOf(workingOrderId, await billTotal(tx, workingOrderId), held);
    const excess = subtractDecimal(addDecimal(funds.received, funds.reserved), funds.total);
    if (compareDecimal(excess, ZERO) > 0) {
      throw new AppError("bill.received_exceeds_total", { workingOrderId, excess: money(excess) });
    }
  }
}

/** A pending payment, or a received one with applied money or a tip it has not given back. */
function holdsMoney(payments: readonly PaymentMoney[]): boolean {
  return payments.some(
    ({ row, netApplied, netTip }) =>
      row.state === "pending" ||
      (row.state === "received" && compareDecimal(addDecimal(netApplied, netTip), ZERO) > 0),
  );
}

/**
 * Refuse `bill.payments_received` for the first of these bills that holds money taken before its
 * invoice (design §4.5): abandoning it, or merging it into another bill, would lose that money from
 * the records.
 */
export async function refuseBillHoldingMoney(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<void> {
  const payments = await readPaymentMoney(tx, workingOrderIds);
  for (const workingOrderId of workingOrderIds) {
    if (holdsMoney(payments.filter(({ row }) => row.workingOrderId === workingOrderId))) {
      throw new AppError("bill.payments_received", { workingOrderId });
    }
  }
}

/**
 * Refuse `bill.payments_received` when the bill holds any pending or received payment, even one
 * given back in full (design §7): the single-payment routes and placing invoice the whole total as
 * one tender and link no bill payment's card to the sale, which only the bill's own invoice does
 * (§2.5).
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
 * For these bills: the net applied money each has received, for those that have received any, and
 * the bills holding a payment as {@link holdsPayment} reads it.
 */
export async function readPaymentsByBill(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<{ received: Map<string, Decimal>; holding: Set<string> }> {
  const received = new Map<string, Decimal>();
  const holding = new Set<string>();
  for (const payment of await readPaymentMoney(tx, workingOrderIds)) {
    const { state, workingOrderId: bill } = payment.row;
    if (HOLDING_STATES.includes(state)) holding.add(bill);
    if (state === "received")
      received.set(bill, addDecimal(received.get(bill) ?? ZERO, payment.netApplied));
  }
  return { received, holding };
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
): BillPaymentView {
  return {
    id: payment.id,
    submissionId: payment.submissionId,
    kind: payment.kind,
    shareOf: payment.shareOf,
    method: payment.method,
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
  const funds = fundsOf(
    workingOrderId,
    total ?? (lineNos.size === 0 ? ZERO : (await priceStoredOrder(tx, workingOrderId)).total),
    held,
  );
  const outstanding = subtractDecimal(subtractDecimal(funds.total, funds.received), funds.reserved);
  return {
    workingOrderId,
    status: order.status,
    total: money(funds.total),
    received: money(funds.received),
    reserved: money(funds.reserved),
    outstanding: order.status === "open" ? money(outstanding) : ZERO,
    tips: money(
      sumDecimals(held.filter(({ row }) => row.state === "received").map(({ netTip }) => netTip)),
    ),
    payments: held.map(({ row }) => toView(row, lines, refunds, lineNos)),
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
 * Thrown by {@link issueIfFullyPaid} given no till when the bill is due its invoice: the caller
 * reads the requesting device's till and runs its write again.
 */
export class SaleTillRequired extends Error {
  constructor() {
    super("a bill's invoice is due and no till was given to file it on");
  }
}

/**
 * {@link issueIfFullyPaid}, answering also the bill's total when it priced the bill. `total` is the
 * bill's total when the caller has priced its current lines in this transaction already.
 */
async function issueWhenFullyPaid(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: TillConfig | null,
  workingOrderId: string,
  operatorId: string | undefined,
  options: { moneyMoved?: boolean; total?: Decimal },
): Promise<{ invoice: TillSaleResult | null; total?: Decimal }> {
  const notYet = { invoice: null, total: options.total };
  const [order] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  if (order?.status !== "open") return notYet;
  const { rows, refunds } = await readPaymentsAndRefunds(tx, workingOrderId);
  const received = rows.filter((row) => row.state === "received");
  if (received.length === 0 || rows.some((row) => row.state === "pending")) return notYet;
  // A card refund still pending leaves the bill's received money unknown.
  if (refunds.some((refund) => refund.state === "pending")) return notYet;
  const held = moneyOf(rows, refunds);
  const total = options.total ?? (await billTotal(tx, workingOrderId));
  if (compareDecimal(total, ZERO) === 0) return { invoice: null, total };
  if (compareDecimal(fundsOf(workingOrderId, total, held).received, total) !== 0) {
    return { invoice: null, total };
  }
  if (cfg === null) throw new SaleTillRequired();

  // A card already captured cannot be undone by refusing its invoice, so a line whose product has
  // since gone off sale is filed as it stands, as a whole-order card recovery files it.
  const { priced, clock } = issueMoment(
    deps.clock,
    await issuancePass(
      tx,
      cfg,
      workingOrderId,
      await priceStoredOrderForIssuance(tx, workingOrderId, {
        refuseUnsentUnavailable: options.moneyMoved !== true,
      }),
    ),
  );
  const tendersOfBill: SettleSaleTender[] = held
    .filter(({ row }) => row.state === "received")
    .filter(({ netApplied, netTip }) => compareDecimal(addDecimal(netApplied, netTip), ZERO) > 0)
    .sort((a, b) => a.row.receivedAt!.localeCompare(b.row.receivedAt!))
    .map(({ row, netApplied, netTip }) => ({
      method: row.method,
      amount: money(addDecimal(netApplied, netTip)),
      tipAmount: money(netTip),
      cashTendered: row.tendered === null ? null : centsToDecimal(row.tendered),
      settledAt: new Date(row.receivedAt!),
      billPaymentId: row.id,
    }));

  // Deferred, then settled with the bill's tenders in this transaction: the filed record is the one
  // an immediate sale files, and settlement is what writes each tender's bill payment.
  const { saleId, fiscal } = await recordSale(tx, deps.backend, {
    tillId: cfg.tillId,
    nodeId: cfg.nodeId,
    seriesId: cfg.seriesId,
    workingOrderId: brandWorkingOrderId(workingOrderId),
    locale: cfg.locale,
    invoiceLocales: cfg.invoiceLocales,
    total: priced.total,
    lines: priced.lines,
    vatBreakdown: priced.vatBreakdown,
    clock,
    operatorId,
    settlement: { kind: "deferred" },
  });
  await settleSale(tx, { saleId, tenders: tendersOfBill });

  const provided = await findPaymentsByBillPayments(
    tx,
    received.filter((row) => row.method === "card").map((row) => row.id),
  );
  for (const row of received) {
    const card = provided.get(row.id);
    if (card !== undefined) {
      await associatePaymentWithSale(tx, {
        provider: card.provider,
        paymentRef: card.paymentRef,
        saleId,
      });
    }
  }

  await firePrepayOrder(tx, cfg, workingOrderId);
  const settledAt = received
    .map((row) => row.receivedAt!)
    .reduce((latest, at) => (at > latest ? at : latest));
  const receiptOrder = await readReceiptOrder(tx, cfg, workingOrderId, { atIssuance: true });
  await tx
    .update(workingOrders)
    .set({ label: receiptOrder.orderLabel, status: "settled", settledAt })
    .where(eq(workingOrders.id, workingOrderId));
  await clearBillRequestIfPaid(tx, workingOrderId, deps.log);

  const ticket: TillSaleResult = {
    ...(await readReceiptIssuer(deps.backend, tx, saleId)),
    ...receiptOrder,
    invoiceNumber: await readInvoiceNumber(tx, saleId),
    issuedAt: fiscal.issuedAt.toISOString(),
    total: priced.total,
    vatBreakdown: toVatBreakdown(priced.vatBreakdown),
    lines: ticketLinesFrom(priced),
    tender: await readTenderBlock(tx, cfg, saleId, workingOrderId),
    payments: await readBillTenderLines(tx, saleId),
    qr: fiscal.verificationUrl ?? "",
  };
  await enqueueSaleReceipt(tx, cfg, ticket);
  return { invoice: ticket, total };
}

/**
 * Issue the bill's invoice when a write has left it fully paid (design §7): it is open, holds no
 * pending payment or refund, has at least one line and one received payment, and the net applied
 * of its received payments equals its total. Answers the ticket, or null when the bill is not
 * fully paid; a bill holding no payment is left alone.
 *
 * One tender per received payment that still holds money, dated when the money moved; every card
 * payment's provider row is linked to the sale, a fully refunded one included.
 */
export async function issueIfFullyPaid(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: TillConfig | null,
  workingOrderId: string,
  operatorId?: string,
  options: { moneyMoved: boolean } = { moneyMoved: false },
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
  const rows: ItemsDue["rows"] = [];
  for (const asked of requested) {
    const line = lines.find((candidate) => candidate.lineNo === asked.lineNo);
    if (line === undefined) {
      throw new AppError("tab.line_not_found", { tabId: workingOrderId, lineNo: asked.lineNo });
    }
    if (line.parentLineId !== null) throw invalid("lines");
    const children = lines.filter((child) => child.parentLineId === line.id);
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

/** Design §3.6: what a payment of the bill would be, writing nothing. */
export async function previewBillPayment(
  deps: TillSaleDeps,
  cfg: TillConfig,
  workingOrderId: string,
  ask: BillPaymentAsk,
): Promise<AllocationPreview> {
  return withTransaction(deps.db, async (tx) => {
    await requireOpenBill(tx, workingOrderId);
    const held = await readPaymentMoney(tx, [workingOrderId]);
    const { request } = await allocationRequestFor(tx, workingOrderId, ask, held);
    const funds = fundsOf(workingOrderId, await billTotal(tx, workingOrderId), held);
    return previewAllocation(funds, request, { tipsEnabled: cfg.tipsEnabled });
  });
}

/** `total` is the bill's total when the caller has priced its current lines in this transaction
 * already. */
async function resultOf(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: TillConfig,
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
 * way is the same request. */
function retryShapeOf(req: BillPaymentRequest): Record<string, unknown> {
  const scaled = (value: string | undefined) =>
    value === undefined ? undefined : money(decimal(value));
  return {
    ...req,
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

/**
 * The start every payment of a bill shares, in the caller's transaction: a retry finds its first
 * row; otherwise the bill must be open and no payment of the whole order in flight, the allocation
 * must be the one the operator saw (design §3.6), and the payment and its lines are inserted in
 * `state`. A new payment answers the bill's total too, which the insert leaves as it was.
 *
 * Keyed by `submissionId` within the bill (design §5.1): the same request again answers the first
 * row and writes nothing; the id with another request, or naming one of the bill's refunds, is
 * `submission.id_reused`.
 */
async function beginBillPayment(
  tx: Transaction,
  cfg: TillConfig,
  workingOrderId: string,
  req: BillPaymentRequest,
  operatorId: string,
  state: "received" | "pending",
  now: Date,
): Promise<{ replay: PaymentRow } | { payment: PaymentRow; total: Decimal }> {
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

  await requireOpenBill(tx, workingOrderId);
  await refuseRefundInProgress(tx, [workingOrderId]);
  await refuseOrderPaymentMarked(tx, [workingOrderId]);
  const held = await readPaymentMoney(tx, [workingOrderId]);
  const { request, items } = await allocationRequestFor(tx, workingOrderId, req, held);
  const total = await billTotal(tx, workingOrderId);
  const allocation = confirmAllocation(
    fundsOf(workingOrderId, total, held),
    request,
    { tipsEnabled: cfg.tipsEnabled },
    { applied: decimal(req.applied), tip: decimal(req.tip) },
  );

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
      requestedBy: operatorId,
      tillId: cfg.tillId,
      receivedAt: state === "received" ? now.toISOString() : null,
    })
    .returning();
  if (items !== null) {
    await tx
      .insert(billPaymentLines)
      .values(items.rows.map((row) => ({ billPaymentId: payment!.id, ...row })));
  }
  return { payment: payment!, total };
}

/**
 * Take a cash or hand-keyed card payment against an open bill, in one transaction: it is received
 * at once, and when it leaves the bill fully paid the same transaction issues the invoice.
 */
export async function takeBillPayment(
  deps: TillSaleDeps,
  cfg: TillConfig,
  workingOrderId: string,
  req: BillPaymentRequest,
  operatorId: string,
): Promise<BillPaymentResult> {
  return withTransaction(deps.db, async (tx) => {
    const receivedAt = deps.clock.now().instant;
    const begun = await beginBillPayment(
      tx,
      cfg,
      workingOrderId,
      req,
      operatorId,
      "received",
      receivedAt,
    );
    if ("replay" in begun) return resultOf(tx, deps, cfg, begun.replay, null);
    const { payment } = begun;
    if (req.method === "card") {
      await recordManualCardPayment(tx, {
        workingOrderId,
        amount: centsToDecimal(payment.applied + payment.tip),
        settledAt: receivedAt,
        externalRef: req.externalRef,
        billPaymentId: payment.id,
      });
    } else {
      await enqueueBillPaymentDrawer(tx, cfg, payment.id, operatorId);
    }
    const { invoice, total } = await issueWhenFullyPaid(tx, deps, cfg, workingOrderId, operatorId, {
      total: begun.total,
    });
    return resultOf(tx, deps, cfg, payment, invoice, total);
  });
}

/** The card bill payments at a reader in this process, by id: a pending payment missing here is
 * one no attempt is still driving. */
const liveBillPaymentsOf = perDatabase(() => new Set<string>());

/** Whether a card for this bill payment is at a reader in this process. */
export function billPaymentIsLive(db: Database, billPaymentId: string): boolean {
  return liveBillPaymentsOf(db).has(billPaymentId);
}

/** {@link takeReaderBillPayment}'s deps: the fiscal ones, and the reader's provider. */
export type ReaderBillPaymentDeps = TillSaleDeps & {
  provider: PaymentProvider;
  /** The chosen reader's vendor reference, passed to `collect`; absent for the simulator. */
  readerRef?: string;
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

/**
 * P3's work for a card bill payment whose charge has gone through (design §5.3, §7): the payment
 * becomes `received`, dated when the money moved, and the invoice is issued if the bill is now
 * fully paid. Shared by the live attempt, the loop's recovery and the manager's actions, each of
 * which has read the payment pending in the same transaction; `bill_payments_guard_update` refuses
 * the change for one that is not. `total` is the bill's total when issuing priced it.
 */
export async function completeBillPayment(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: TillConfig,
  billPaymentId: string,
  receivedAt: Date,
  attestation?: Attestation,
): Promise<{ payment: PaymentRow; invoice: TillSaleResult | null; total?: Decimal }> {
  const [payment] = await tx
    .update(billPayments)
    .set({
      state: "received",
      receivedAt: receivedAt.toISOString(),
      ...attestationColumns(attestation),
    })
    .where(eq(billPayments.id, billPaymentId))
    .returning();
  const issued = await issueWhenFullyPaid(
    tx,
    deps,
    { ...cfg, tillId: brandTillId(payment!.tillId) },
    payment!.workingOrderId,
    payment!.requestedBy,
    { moneyMoved: true },
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

/** The collect results that establish no money moved; any other non-captured one leaves the payment
 * pending for the loop or a manager to settle from the provider's row. */
const NOT_CHARGED: ReadonlySet<PaymentResultState> = new Set([
  "failed",
  "declined",
  "network_unavailable",
]);

/**
 * Take a card on a reader against an open bill, in the three phases of design §5.3:
 *  - P1 (transaction): {@link beginBillPayment} inserts the payment `pending`, which reserves its
 *    applied amount, and registers it as live in this process;
 *  - P2 (no transaction): the provider's `collect` for `applied + tip`, naming the bill payment;
 *  - P3 (transaction): a capture is {@link completeBillPayment}; a decline or a refusal to go
 *    offline fails it; any other answer leaves it pending, for the loop to settle from the
 *    provider's row. `collect` is never allowed to accept the card offline (design §11.9).
 *
 * A retry of a payment already taken answers its state and never collects again.
 */
export async function takeReaderBillPayment(
  deps: ReaderBillPaymentDeps,
  cfg: TillConfig,
  workingOrderId: string,
  req: BillPaymentRequest,
  operatorId: string,
): Promise<BillPaymentResult> {
  let release = (): void => {};
  try {
    const begun = await withTransaction(deps.db, async (tx) => {
      const started = await beginBillPayment(
        tx,
        cfg,
        workingOrderId,
        req,
        operatorId,
        "pending",
        deps.clock.now().instant,
      );
      if ("replay" in started) {
        return {
          kind: "replay" as const,
          result: await resultOf(tx, deps, cfg, started.replay, null),
        };
      }
      // Inside the transaction, so no loop pass runs between the insert and its registration.
      release = claimLive(liveBillPaymentsOf(deps.db), started.payment.id);
      return { kind: "collect" as const, payment: started.payment };
    });
    if (begun.kind === "replay") return begun.result;
    const { payment } = begun;

    const result: PaymentResult = await deps.provider.collect({
      tillId: cfg.tillId,
      workingOrderId: brandWorkingOrderId(workingOrderId),
      amount: centsToDecimal(payment.applied + payment.tip),
      ...(deps.readerRef === undefined ? {} : { readerRef: deps.readerRef }),
      simulationOutcome: req.simulationOutcome,
      billPaymentId: payment.id,
    });

    return await withTransaction(deps.db, async (tx) => {
      if (result.state === "captured") {
        // A captured result carries its time (`PaymentResult`, provider.ts).
        const done = await completeBillPayment(tx, deps, cfg, payment.id, result.settledAt!);
        return resultOf(tx, deps, cfg, done.payment, done.invoice, done.total);
      }
      if (!NOT_CHARGED.has(result.state)) {
        return { ...(await resultOf(tx, deps, cfg, payment, null)), outcome: "timeout" };
      }
      const failed = await failBillPayment(tx, payment.id, deps.clock.now().instant);
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
