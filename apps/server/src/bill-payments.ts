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
  toScale,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { recordSale, settleSale } from "@waitron/core";
import type { SettleSaleTender } from "@waitron/core";
import {
  associatePaymentWithSale,
  findPaymentByBillPayment,
  recordManualCardPayment,
} from "@waitron/payments";
import type { PaymentProvider, PaymentResult } from "@waitron/payments";
import { confirmAllocation, previewAllocation } from "./bill-allocation.js";
import type {
  AllocationChoice,
  AllocationPreview,
  AllocationRequest,
  BillFunds,
} from "./bill-allocation.js";
import { issuancePass } from "./issuance-pass.js";
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
import { fingerprint } from "./visits.js";
import {
  priceStoredOrder,
  priceStoredOrderForIssuance,
  readInvoiceNumber,
  refuseOrderPaymentMarked,
  toVatBreakdown,
} from "./working-order.js";
import type { TillSaleDeps } from "./working-order.js";
import "./errors.js";

/**
 * Payments taken against a bill before its invoice exists (bill payments design): the balance they
 * leave, the rules every write to a bill keeps while it holds them, and the invoice issued by the
 * write that leaves the bill fully paid.
 */

const ZERO = decimal("0.00");

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
  allowOffline?: boolean;
  simulationOutcome?: "captured" | "declined";
  applied: string;
  tip: string;
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

interface PaymentMoney {
  row: PaymentRow;
  netApplied: Decimal;
  netTip: Decimal;
}

/** Each payment of the bills, with what its completed refunds leave of it. */
async function readPaymentMoney(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<PaymentMoney[]> {
  if (workingOrderIds.length === 0) return [];
  const rows = await tx
    .select()
    .from(billPayments)
    .where(inArray(billPayments.workingOrderId, [...workingOrderIds]))
    .orderBy(billPayments.createdAt, billPayments.id);
  if (rows.length === 0) return [];
  const refunds = await tx
    .select({
      billPaymentId: billPaymentRefunds.billPaymentId,
      applied: billPaymentRefunds.appliedAmount,
      tip: billPaymentRefunds.tipAmount,
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
  return rows.map((row) => {
    const own = refunds.filter((refund) => refund.billPaymentId === row.id);
    const refunded = (pick: (refund: (typeof own)[number]) => number) =>
      own.reduce((sum, refund) => sum + pick(refund), 0);
    return {
      row,
      netApplied: centsToDecimal(row.applied - refunded((refund) => refund.applied)),
      netTip: centsToDecimal(row.tip - refunded((refund) => refund.tip)),
    };
  });
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

const money = (value: Decimal): Decimal => toScale(value, MONEY_SCALE);

/** Each line's paid quantity, in thousandths: what its pending and received item payments cover. */
export async function readPaidQuantities(
  tx: Transaction,
  workingOrderId: string,
): Promise<ReadonlyMap<string, number>> {
  const rows = await tx
    .select({ lineId: billPaymentLines.lineId, quantity: billPaymentLines.quantity })
    .from(billPaymentLines)
    .innerJoin(billPayments, eq(billPayments.id, billPaymentLines.billPaymentId))
    .where(
      and(
        eq(billPayments.workingOrderId, workingOrderId),
        inArray(billPayments.state, ["pending", "received"]),
      ),
    );
  const paid = new Map<string, number>();
  for (const row of rows) paid.set(row.lineId, (paid.get(row.lineId) ?? 0) + row.quantity);
  return paid;
}

/**
 * Refuse `bill.line_paid` for the first of these lines of the bill that would hold less than its
 * paid quantity after the write: `keeps` is the quantity, in thousandths, the write leaves on that
 * line's row. A write that must not touch a paid line at all passes 0.
 */
export function refuseLinesPaid(
  workingOrderId: string,
  paid: ReadonlyMap<string, number>,
  lines: readonly { id: string; lineNo: number; keeps: number }[],
): void {
  const refused = lines.find((line) => (paid.get(line.id) ?? 0) > line.keeps);
  if (refused !== undefined) {
    throw new AppError("bill.line_paid", { workingOrderId, lineNo: refused.lineNo });
  }
}

/** {@link refuseLinesPaid}, reading the bill's paid quantities itself. */
export async function refusePaidLines(
  tx: Transaction,
  workingOrderId: string,
  lines: readonly { id: string; lineNo: number; keeps: number }[],
): Promise<void> {
  if (lines.length === 0) return;
  refuseLinesPaid(workingOrderId, await readPaidQuantities(tx, workingOrderId), lines);
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
  for (const workingOrderId of workingOrderIds) {
    const held = await readPaymentMoney(tx, [workingOrderId]);
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
 * invoice (design §4.5, §7): abandoning it would lose that money from the records, and paying it in
 * one go would invoice the whole total beside it.
 */
export async function refuseBillHoldingMoney(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<void> {
  for (const workingOrderId of workingOrderIds) {
    if (holdsMoney(await readPaymentMoney(tx, [workingOrderId]))) {
      throw new AppError("bill.payments_received", { workingOrderId });
    }
  }
}

/** The net applied money each of these bills has received, for those that have received any. */
export async function readReceivedByBill(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<Map<string, Decimal>> {
  const received = new Map<string, Decimal>();
  for (const payment of await readPaymentMoney(tx, workingOrderIds)) {
    if (payment.row.state !== "received") continue;
    const bill = payment.row.workingOrderId;
    received.set(bill, addDecimal(received.get(bill) ?? ZERO, payment.netApplied));
  }
  return received;
}

async function readLineNos(tx: Transaction, workingOrderId: string): Promise<Map<string, number>> {
  const rows = await tx
    .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, workingOrderId));
  return new Map(rows.map((row) => [row.id, row.lineNo]));
}

function toView(
  payment: PaymentRow,
  lines: readonly (typeof billPaymentLines.$inferSelect)[],
  lineNos: ReadonlyMap<string, number>,
): BillPaymentView {
  const applied = centsToDecimal(payment.applied);
  const tip = centsToDecimal(payment.tip);
  const tendered = payment.tendered === null ? null : centsToDecimal(payment.tendered);
  return {
    id: payment.id,
    submissionId: payment.submissionId,
    kind: payment.kind,
    shareOf: payment.shareOf,
    method: payment.method,
    applied,
    tip,
    tendered,
    change: tendered === null ? null : subtractDecimal(subtractDecimal(tendered, applied), tip),
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
  };
}

/** The bill's balance and its payments; `working_order.not_found` for an unknown bill. */
export async function readBillBalance(
  tx: Transaction,
  workingOrderId: string,
): Promise<BillBalance> {
  const [order] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  if (order === undefined) {
    throw new AppError("working_order.not_found", { workingOrderId });
  }
  const held = await readPaymentMoney(tx, [workingOrderId]);
  const funds = fundsOf(workingOrderId, await billTotal(tx, workingOrderId), held);
  const lines =
    held.length === 0
      ? []
      : await tx
          .select()
          .from(billPaymentLines)
          .where(
            inArray(
              billPaymentLines.billPaymentId,
              held.map(({ row }) => row.id),
            ),
          );
  const lineNos = await readLineNos(tx, workingOrderId);
  const paid = await readPaidQuantities(tx, workingOrderId);
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
    payments: held.map(({ row }) => toView(row, lines, lineNos)),
    paidLines: [...paid]
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
 * Issue the bill's invoice when a write has left it fully paid (design §7): it is open, holds no
 * pending payment, has at least one line and one received payment, and the net applied of its
 * received payments equals its total. Answers the ticket, or null when the bill is not fully paid.
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
  const [order] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  if (order?.status !== "open") return null;
  const held = await readPaymentMoney(tx, [workingOrderId]);
  const received = held.filter(({ row }) => row.state === "received");
  if (received.length === 0 || held.some(({ row }) => row.state === "pending")) return null;
  const total = await billTotal(tx, workingOrderId);
  if (compareDecimal(total, ZERO) === 0) return null;
  if (compareDecimal(fundsOf(workingOrderId, total, held).received, total) !== 0) return null;
  if (cfg === null) throw new SaleTillRequired();

  // A card already captured cannot be undone by refusing its invoice, so a line whose product has
  // since gone off sale is filed as it stands, as a whole-order card recovery files it.
  const priced = await issuancePass(
    tx,
    cfg,
    workingOrderId,
    await priceStoredOrderForIssuance(tx, workingOrderId, {
      refuseUnsentUnavailable: !options.moneyMoved,
    }),
  );
  const tendersOfBill: SettleSaleTender[] = received
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
    clock: deps.clock,
    operatorId,
    settlement: { kind: "deferred" },
  });
  await settleSale(tx, { saleId, tenders: tendersOfBill });

  for (const { row } of received) {
    if (row.method !== "card") continue;
    const provided = await findPaymentByBillPayment(tx, row.id);
    if (provided !== undefined) {
      await associatePaymentWithSale(tx, {
        provider: provided.provider,
        paymentRef: provided.paymentRef,
        saleId,
      });
    }
  }

  await firePrepayOrder(tx, cfg, workingOrderId);
  const settledAt = received
    .map(({ row }) => row.receivedAt!)
    .reduce((latest, at) => (at > latest ? at : latest));
  await tx
    .update(workingOrders)
    .set({
      label: (await readReceiptOrder(tx, cfg, workingOrderId, { atIssuance: true })).orderLabel,
      status: "settled",
      settledAt,
    })
    .where(eq(workingOrders.id, workingOrderId));

  const ticket: TillSaleResult = {
    ...(await readReceiptIssuer(deps.backend, tx, saleId)),
    ...(await readReceiptOrder(tx, cfg, workingOrderId)),
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
  return ticket;
}

/**
 * {@link issueIfFullyPaid} for each bill a write that can lower a total has changed, in the write's
 * own transaction. A bill holding no payment is left alone.
 */
export async function issueBillsFullyPaid(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: TillConfig | null,
  workingOrderIds: readonly string[],
  operatorId?: string,
): Promise<void> {
  for (const workingOrderId of workingOrderIds) {
    await issueIfFullyPaid(tx, deps, cfg, workingOrderId, operatorId);
  }
}

interface ItemsDue {
  due: Decimal;
  rows: { lineId: string; quantity: number; amount: number }[];
}

function invalidLines(): AppError {
  return new AppError("management.request_invalid", { field: "lines" });
}

/**
 * What an item payment's lines cost, and the rows it records. Whole units only for a line sold by
 * the unit; a weighed line, and a dish with extras, whose extras are paid with it, only whole. A
 * held line may be paid for.
 */
async function itemsDue(
  tx: Transaction,
  workingOrderId: string,
  requested: readonly { lineNo: number; quantity?: string }[],
): Promise<ItemsDue> {
  if (requested.length === 0) throw invalidLines();
  if (new Set(requested.map((line) => line.lineNo)).size !== requested.length) {
    throw invalidLines();
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
  const paid = await readPaidQuantities(tx, workingOrderId);
  const rows: ItemsDue["rows"] = [];
  for (const asked of requested) {
    const line = lines.find((candidate) => candidate.lineNo === asked.lineNo);
    if (line === undefined) {
      throw new AppError("tab.line_not_found", { tabId: workingOrderId, lineNo: asked.lineNo });
    }
    if (line.parentLineId !== null) throw invalidLines();
    const children = lines.filter((child) => child.parentLineId === line.id);
    let quantity = line.quantity;
    if (asked.quantity !== undefined) {
      try {
        assertQuantityPrecision(asked.quantity, 0, { positive: true });
        quantity = stringToThousandths(asked.quantity);
      } catch {
        throw invalidLines();
      }
      if (quantity > line.quantity) throw invalidLines();
      const whole = quantity === line.quantity;
      if (!whole && (children.length > 0 || (line.unitPrecision ?? 0) !== 0)) {
        throw invalidLines();
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
): Promise<{ request: AllocationRequest; items: ItemsDue | null }> {
  const addedTip = decimal(ask.addedTip ?? "0.00");
  const payment =
    ask.method === "cash"
      ? { method: "cash" as const, tendered: decimal(ask.tendered!), addedTip }
      : { method: "card" as const, addedTip };
  const choice = ask.choice === undefined ? {} : { choice: ask.choice };
  switch (ask.kind) {
    case "items": {
      const items = await itemsDue(tx, workingOrderId, ask.lines ?? []);
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
async function requireOpenBill(tx: Transaction, workingOrderId: string): Promise<void> {
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
    const { request } = await allocationRequestFor(tx, workingOrderId, ask);
    const funds = fundsOf(
      workingOrderId,
      await billTotal(tx, workingOrderId),
      await readPaymentMoney(tx, [workingOrderId]),
    );
    return previewAllocation(funds, request, { tipsEnabled: cfg.tipsEnabled });
  });
}

async function resultOf(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: TillConfig,
  payment: PaymentRow,
  invoice: TillSaleResult | null,
): Promise<BillPaymentResult> {
  const balance = await readBillBalance(tx, payment.workingOrderId);
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

/**
 * The start every payment of a bill shares, in the caller's transaction: a retry finds its first
 * row; otherwise the bill must be open and no payment of the whole order in flight, the allocation
 * must be the one the operator saw (design §3.6), and the payment and its lines are inserted in
 * `state`.
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
): Promise<{ replay: PaymentRow } | { payment: PaymentRow }> {
  const print = fingerprint(req as unknown as Record<string, unknown>);
  const [earlier] = await tx
    .select()
    .from(billPayments)
    .where(
      and(
        eq(billPayments.workingOrderId, workingOrderId),
        eq(billPayments.submissionId, req.submissionId),
      ),
    );
  if (earlier !== undefined) {
    if (earlier.fingerprint !== print) {
      throw new AppError("submission.id_reused", { submissionId: req.submissionId });
    }
    return { replay: earlier };
  }
  const [refund] = await tx
    .select({ id: billPaymentRefunds.id })
    .from(billPaymentRefunds)
    .innerJoin(billPayments, eq(billPayments.id, billPaymentRefunds.billPaymentId))
    .where(
      and(
        eq(billPayments.workingOrderId, workingOrderId),
        eq(billPaymentRefunds.submissionId, req.submissionId),
      ),
    );
  if (refund !== undefined) {
    throw new AppError("submission.id_reused", { submissionId: req.submissionId });
  }

  await requireOpenBill(tx, workingOrderId);
  await refuseOrderPaymentMarked(tx, [workingOrderId]);
  const { request, items } = await allocationRequestFor(tx, workingOrderId, req);
  const funds = fundsOf(
    workingOrderId,
    await billTotal(tx, workingOrderId),
    await readPaymentMoney(tx, [workingOrderId]),
  );
  const allocation = confirmAllocation(
    funds,
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
  return { payment: payment! };
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
    const invoice = await issueIfFullyPaid(tx, deps, cfg, workingOrderId, operatorId);
    return resultOf(tx, deps, cfg, payment, invoice);
  });
}

/** The card bill payments each venue store has at a reader in this process, by id. One process owns
 * a venue at a time, so a pending payment missing here is one no attempt is still driving. */
const LIVE_BILL_PAYMENTS = new WeakMap<Database, Set<string>>();

function liveBillPaymentsOf(db: Database): Set<string> {
  let live = LIVE_BILL_PAYMENTS.get(db);
  if (live === undefined) {
    live = new Set();
    LIVE_BILL_PAYMENTS.set(db, live);
  }
  return live;
}

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

/**
 * P3's work for a card bill payment whose charge has gone through (design §5.3, §7): the payment
 * becomes `received`, dated when the money moved, and the invoice is issued if the bill is now
 * fully paid. Shared by the live attempt, the loop's recovery and the manager's actions, each of
 * which has read the payment pending in the same transaction; `bill_payments_guard_update` refuses
 * the change for one that is not.
 */
export async function completeBillPayment(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: TillConfig,
  billPaymentId: string,
  receivedAt: Date,
  attestation?: { attestedBy: string; note: string },
): Promise<{ payment: PaymentRow; invoice: TillSaleResult | null }> {
  const [payment] = await tx
    .update(billPayments)
    .set({
      state: "received",
      receivedAt: receivedAt.toISOString(),
      ...(attestation === undefined
        ? {}
        : { attestedBy: attestation.attestedBy, attestationNote: attestation.note }),
    })
    .where(eq(billPayments.id, billPaymentId))
    .returning();
  const invoice = await issueIfFullyPaid(
    tx,
    deps,
    { ...cfg, tillId: brandTillId(payment!.tillId) },
    payment!.workingOrderId,
    payment!.requestedBy,
    { moneyMoved: true },
  );
  return { payment: payment!, invoice };
}

/** A card bill payment that charged nothing becomes `failed`, releasing its reservation. Its callers
 * have read it pending, as {@link completeBillPayment}'s have. */
export async function failBillPayment(
  tx: Transaction,
  billPaymentId: string,
  failedAt: Date,
  attestation?: { attestedBy: string; note: string },
): Promise<PaymentRow> {
  const [payment] = await tx
    .update(billPayments)
    .set({
      state: "failed",
      failedAt: failedAt.toISOString(),
      ...(attestation === undefined
        ? {}
        : { attestedBy: attestation.attestedBy, attestationNote: attestation.note }),
    })
    .where(eq(billPayments.id, billPaymentId))
    .returning();
  return payment!;
}

/**
 * Take a card on a reader against an open bill, in the three phases of design §5.3:
 *  - P1 (transaction): {@link beginBillPayment} inserts the payment `pending`, which reserves its
 *    applied amount, and registers it as live in this process;
 *  - P2 (no transaction): the provider's `collect` for `applied + tip`, naming the bill payment;
 *  - P3 (transaction): a capture, or an offline acceptance, is {@link completeBillPayment}; a
 *    decline or a refusal to go offline fails it; a reader that stopped answering leaves it
 *    pending, for the loop to settle from the provider's row.
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
  const live = liveBillPaymentsOf(deps.db);
  let registered: string | null = null;
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
      registered = started.payment.id;
      live.add(registered);
      return { kind: "collect" as const, payment: started.payment };
    });
    if (begun.kind === "replay") return begun.result;
    const { payment } = begun;

    const result: PaymentResult = await deps.provider.collect({
      tillId: cfg.tillId,
      workingOrderId: brandWorkingOrderId(workingOrderId),
      amount: centsToDecimal(payment.applied + payment.tip),
      ...(deps.readerRef === undefined ? {} : { readerRef: deps.readerRef }),
      allowOffline: req.allowOffline,
      simulationOutcome: req.simulationOutcome,
      billPaymentId: payment.id,
    });

    return await withTransaction(deps.db, async (tx) => {
      if (result.state === "captured" || result.state === "accepted_offline") {
        // A captured or offline-accepted result carries its time (`PaymentResult`, provider.ts).
        const done = await completeBillPayment(tx, deps, cfg, payment.id, result.settledAt!);
        return resultOf(tx, deps, cfg, done.payment, done.invoice);
      }
      if (result.state === "attempting") {
        return { ...(await resultOf(tx, deps, cfg, payment, null)), outcome: "timeout" };
      }
      const failed = await failBillPayment(tx, payment.id, deps.clock.now().instant);
      return {
        ...(await resultOf(tx, deps, cfg, failed, null)),
        outcome: result.state === "network_unavailable" ? "network_unavailable" : "declined",
      };
    });
  } finally {
    if (registered !== null) live.delete(registered);
  }
}

/** Reads a bill's balance in its own transaction. */
export async function getBillBalance(
  deps: Pick<TillSaleDeps, "db">,
  workingOrderId: string,
): Promise<BillBalance> {
  return withTransaction(deps.db, (tx) => readBillBalance(tx, workingOrderId));
}
