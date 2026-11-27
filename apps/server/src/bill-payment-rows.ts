import { billPayments, refunds as refundRows, type Transaction, billAdvances } from "@waitron/db";
import { findPaymentsByBillPayments, associatePaymentWithSale } from "@waitron/payments";
import {
  type Decimal,
  centsToDecimal,
  sumDecimals,
  compareDecimal,
  AppError,
  subtractDecimal,
  addDecimal,
} from "@waitron/shared";
import { eq, inArray, sql, and } from "drizzle-orm";
import {
  type AdvancePaymentMoney,
  type BillAdvances,
  readBillAdvances,
  refuseWhileAdvanceCorrectionOpen,
} from "./bill-advances.js";
import { type BillFunds, ZERO, money } from "./bill-allocation.js";
import {
  type RefundMoney,
  netOfRefunds,
  completedRefundsOf,
  owedOf,
} from "./bill-payment-money.js";
import type { IssuedSale } from "./sale-due.js";
import { storedOrderTotal } from "./stored-order-lines.js";
import { readOutstandingSaleForOrder } from "./till-sale.js";
import "./errors.js";

export type PaymentRow = typeof billPayments.$inferSelect;
export type RefundRow = typeof refundRows.$inferSelect;

export interface PaymentMoney {
  row: PaymentRow;
  netApplied: Decimal;
  netTip: Decimal;
}
/** Each payment with what its completed refunds leave of it; `refunds` may hold refunds of other
 * payments, and in other states. A payment that paid an advance (`advances`) holds what is left of
 * the advance, and its tip less the tips given back from its tender, so an advance given back
 * through Correct invoice stops holding money. */
export function moneyOf(
  rows: readonly PaymentRow[],
  refunds: readonly RefundMoney[],
  advances: ReadonlyMap<string, AdvancePaymentMoney>,
): PaymentMoney[] {
  return rows.map((row) => {
    const net = netOfRefunds(row, refunds);
    const advance = advances.get(row.id);
    return {
      row,
      netApplied: advance?.left ?? centsToDecimal(net.applied),
      netTip: centsToDecimal(net.tip - (advance?.tipGivenBack ?? 0)),
    };
  });
}
/** The bills' payments, oldest first, and those of them that paid an advance. */
export async function readPaymentRows(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<{ rows: PaymentRow[]; advanced: Set<string> }> {
  if (workingOrderIds.length === 0) return { rows: [], advanced: new Set() };
  const read = await tx
    .select({ row: billPayments, advanceId: billAdvances.id })
    .from(billPayments)
    .leftJoin(billAdvances, eq(billAdvances.billPaymentId, billPayments.id))
    .where(inArray(billPayments.workingOrderId, [...workingOrderIds]))
    // Two payments can share a millisecond; a tie falls back to `rowid`, the order the rows were
    // written in.
    .orderBy(billPayments.createdAt, sql`${billPayments}.rowid`);
  return {
    rows: read.map(({ row }) => row),
    advanced: new Set(read.flatMap(({ row, advanceId }) => (advanceId === null ? [] : [row.id]))),
  };
}
/** The bills' {@link BillAdvances}, read only when one of their payments paid an advance: each
 * advance is linked to the payment that paid it, and a bill's advances are those whose payment is
 * on it, so a bill none of whose payments paid one has none. */
export async function advancesPaidBy(
  tx: Transaction,
  workingOrderIds: readonly string[],
  advanced: ReadonlySet<string>,
): Promise<BillAdvances> {
  return advanced.size === 0 ? noAdvances() : readBillAdvances(tx, workingOrderIds);
}
function noAdvances(): BillAdvances {
  return { credits: new Map(), payments: new Map() };
}
/** Each payment of some bills, with what its completed refunds leave of it, and the bills'
 * advances. */
export interface HeldMoney {
  held: PaymentMoney[];
  advances: BillAdvances;
}
/** {@link HeldMoney} of these bills; `advances` are theirs when the caller has read them. */
export async function readHeld(
  tx: Transaction,
  workingOrderIds: readonly string[],
  advances?: BillAdvances,
): Promise<HeldMoney> {
  const { rows, advanced } = await readPaymentRows(tx, workingOrderIds);
  if (rows.length === 0) return { held: [], advances: advances ?? noAdvances() };
  const read = advances ?? (await advancesPaidBy(tx, workingOrderIds, advanced));
  return { held: moneyOf(rows, await completedRefundsOf(tx, rows), read.payments), advances: read };
}
/** Each payment of the bills, with what its completed refunds leave of it. */
export async function readPaymentMoney(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<PaymentMoney[]> {
  return (await readHeld(tx, workingOrderIds)).held;
}
/** {@link readPaymentMoney} for one payment already read, which paid no advance. */
export async function readOnePaymentMoney(tx: Transaction, row: PaymentRow): Promise<PaymentMoney> {
  return moneyOf([row], await completedRefundsOf(tx, [row]), new Map())[0]!;
}
/** The bill's payments, oldest first, every refund of them, oldest first, and those of them that
 * paid an advance. */
export async function readPaymentsAndRefunds(
  tx: Transaction,
  workingOrderId: string,
): Promise<{ rows: PaymentRow[]; refunds: RefundRow[]; advanced: Set<string> }> {
  const { rows, advanced } = await readPaymentRows(tx, [workingOrderId]);
  const refunds =
    rows.length === 0
      ? []
      : await tx
          .select()
          .from(refundRows)
          .where(
            inArray(
              refundRows.billPaymentId,
              rows.map((row) => row.id),
            ),
          )
          // Two refunds can share a millisecond; a tie falls back to `rowid`, the order the rows
          // were written in.
          .orderBy(refundRows.createdAt, sql`${refundRows}.rowid`);
  return { rows, refunds, advanced };
}
export function fundsOf(
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
  };
}
/** The states in which a payment is held on its bill, one given back in full included. */
export const HOLDING_STATES: readonly PaymentRow["state"][] = ["pending", "received"];
/**
 * The invariant of design §4.4, for the money: the net applied of each bill's received payments
 * plus the applied of its pending ones is at most its total. The line writers that take lines off
 * a bill or lower a quantity call it, or {@link assertLinesKeptExcess} where the bill may be
 * above it already, before they commit. No trigger stands behind it, because the total is
 * computed, not stored, so a writer that forgets it is seen only by its own tests.
 */
export async function assertBillInvariant(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<void> {
  for (const [workingOrderId, excess] of await billExcesses(tx, workingOrderIds)) {
    refuseExcess(workingOrderId, excess, undefined);
  }
}
function refuseExcess(workingOrderId: string, excess: Decimal, allowed: Decimal | undefined) {
  if (compareDecimal(excess, allowed ?? ZERO) > 0) {
    throw new AppError("bill.received_exceeds_total", { workingOrderId, excess: money(excess) });
  }
}
/**
 * {@link assertBillInvariant} for one bill as an edit not yet written would leave it, `pricedMeal`
 * its priced total then, so a preview refuses what the edit's own check would.
 */
export async function assertBillInvariantAt(
  tx: Transaction,
  workingOrderId: string,
  pricedMeal: Decimal,
): Promise<void> {
  const { held, advances } = await readHeld(tx, [workingOrderId]);
  const { excess } = await excessOf(tx, workingOrderId, held, advances, pricedMeal);
  if (excess !== undefined) refuseExcess(workingOrderId, excess, undefined);
}
/** By how much the bill, holding these of its payments, has received and reserved more than its
 * total now, or at `pricedMeal` (undefined when it is not overpaid), and that total (undefined
 * when it holds no payment, as the total is then not read). */
async function excessOf(
  tx: Transaction,
  workingOrderId: string,
  held: readonly PaymentMoney[],
  advances: BillAdvances,
  pricedMeal?: Decimal,
): Promise<{ excess: Decimal | undefined; total: Decimal | undefined }> {
  if (held.length === 0) return { excess: undefined, total: undefined };
  const total = await billPaymentTotal(tx, workingOrderId, advances, pricedMeal);
  const funds = fundsOf(workingOrderId, total, held);
  const excess = subtractDecimal(addDecimal(funds.received, funds.reserved), funds.total);
  return { excess: compareDecimal(excess, ZERO) > 0 ? excess : undefined, total: funds.total };
}
/** By how much each of these bills holding a payment has received and reserved more than its
 * total; a bill that is not overpaid is left out. */
async function billExcesses(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<Map<string, Decimal>> {
  const { held: payments, advances } = await readHeld(tx, workingOrderIds);
  const excesses = new Map<string, Decimal>();
  for (const workingOrderId of workingOrderIds) {
    const held = payments.filter(({ row }) => row.workingOrderId === workingOrderId);
    const { excess } = await excessOf(tx, workingOrderId, held, advances);
    if (excess !== undefined) excesses.set(workingOrderId, excess);
  }
  return excesses;
}
/** One bill's {@link HeldMoney}, by how much it is paid over its total (undefined when it is
 * not), and its total (undefined when it holds no payment). */
export interface BillExcess extends HeldMoney {
  workingOrderId: string;
  excess: Decimal | undefined;
  total: Decimal | undefined;
}
/** The bill's {@link BillExcess}, read now. */
export async function readBillExcess(tx: Transaction, workingOrderId: string): Promise<BillExcess> {
  const { held, advances } = await readHeld(tx, [workingOrderId]);
  return {
    workingOrderId,
    held,
    advances,
    ...(await excessOf(tx, workingOrderId, held, advances)),
  };
}
/**
 * {@link assertBillInvariant} after a write that changed the bill's lines but none of its payments,
 * refunds or advances, against `before`, read ahead of the write: only the bill's new total is
 * read. The write may keep or lessen an excess the bill already had, but not raise it.
 */
export async function assertLinesKeptExcess(tx: Transaction, before: BillExcess): Promise<void> {
  const { workingOrderId, held, advances } = before;
  const { excess } = await excessOf(tx, workingOrderId, held, advances);
  if (excess !== undefined) refuseExcess(workingOrderId, excess, before.excess);
}
export function receivedHoldsMoney({ row, netApplied, netTip }: PaymentMoney): boolean {
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
/** The money each received payment of an issued bill has kept, the payments of its advances
 * aside: an advance's money is on its own ticket, and the bill's amount due has it taken off. */
async function keptByIssuedBill(tx: Transaction, workingOrderId: string): Promise<Decimal[]> {
  const { held, advances } = await readHeld(tx, [workingOrderId]);
  return held
    .filter(({ row }) => row.state === "received" && !advances.payments.has(row.id))
    .map(({ netApplied }) => netApplied);
}
/** What an issued bill's own payments have kept so far ({@link keptByIssuedBill}), tips aside. */
export async function paidOnIssuedBill(tx: Transaction, workingOrderId: string): Promise<Decimal> {
  return sumDecimals([ZERO, ...(await keptByIssuedBill(tx, workingOrderId))]);
}
/** What an issued bill still owes: its amount due less the money its payments have kept. */
export async function stillOwedOnIssuedBill(
  tx: Transaction,
  workingOrderId: string,
  amountDue: Decimal,
): Promise<Decimal> {
  return owedOf(amountDue, await keptByIssuedBill(tx, workingOrderId));
}
/**
 * Those of these bills that hold money: a pending payment, or received money not given back.
 * `besidesAdvances` leaves out the payments that paid an advance, whose money is on its own ticket.
 */
export async function billsHoldingMoney(
  tx: Transaction,
  workingOrderIds: readonly string[],
  options: { besidesAdvances?: boolean } = {},
): Promise<Set<string>> {
  const { held, advances } = await readHeld(tx, workingOrderIds);
  const payments = held.filter(
    ({ row }) => options.besidesAdvances !== true || !advances.payments.has(row.id),
  );
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
/**
 * Point the provider row of each of these received card bill payments at the sale, a payment
 * given back in full included (design §2.5). A card that paid an advance (`advancePayments`) stays
 * linked to its advance.
 */
export async function linkCardBillPayments(
  tx: Transaction,
  received: readonly PaymentRow[],
  saleId: string,
  advancePayments: ReadonlySet<string>,
): Promise<void> {
  const provided = await findPaymentsByBillPayments(
    tx,
    received
      .filter((row) => row.method === "card" && !advancePayments.has(row.id))
      .map((row) => row.id),
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
  const { rows, advanced } = await readPaymentRows(tx, [workingOrderId]);
  await linkCardBillPayments(
    tx,
    rows.filter((row) => row.state === "received"),
    saleId,
    advanced,
  );
}
/** The bill's {@link BillFigures} `meal`. */
export async function billPaymentTotal(
  tx: Transaction,
  id: string,
  advances: BillAdvances,
  pricedMeal?: Decimal,
): Promise<Decimal> {
  return (await readBillFigures(tx, id, advances, pricedMeal)).meal;
}
/** What a bill's money is measured against. */
export interface BillFigures {
  /** The sale the bill has already issued, if any. */
  issued: IssuedSale | undefined;
  /**
   * What the bill's payments, those that paid an advance included, add up to once it is paid: its
   * priced total before its invoice, and after it the invoice's amount due with the advances it
   * took off added back.
   */
  meal: Decimal;
  /** What the bill's own invoice is settled at: the meal less its advances. */
  due: Decimal;
  /** The bill's advances. */
  advances: BillAdvances;
}
/** The bill's {@link BillFigures}; `advances` are the bill's, and `pricedMeal` its priced total
 * when the caller has priced its current lines in this transaction already. */
export async function readBillFigures(
  tx: Transaction,
  id: string,
  advances: BillAdvances,
  pricedMeal?: Decimal,
): Promise<BillFigures> {
  const issued = await readOutstandingSaleForOrder(tx, id);
  const taken = sumDecimals((advances.credits.get(id) ?? []).map((credit) => credit.gross));
  if (issued !== undefined)
    return { issued, meal: addDecimal(issued.amountDue, taken), due: issued.amountDue, advances };
  const meal = pricedMeal ?? (await storedOrderTotal(tx, id));
  return { issued, meal, due: subtractDecimal(meal, taken), advances };
}
/**
 * Refuses `advance.correction_open` when the bill's money already covers it and one of its
 * advances has an open correction, as a payment that covers it is refused: for a bill whose invoice
 * is held while a card for another bill is collected, before that card is asked.
 */
export async function refuseCoveredWhileAdvanceCorrectionOpen(
  tx: Transaction,
  workingOrderId: string,
): Promise<void> {
  const { held, advances } = await readHeld(tx, [workingOrderId]);
  if (!advances.credits.has(workingOrderId)) return;
  const funds = fundsOf(workingOrderId, await billPaymentTotal(tx, workingOrderId, advances), held);
  if (compareDecimal(addDecimal(funds.received, funds.reserved), funds.total) >= 0)
    await refuseWhileAdvanceCorrectionOpen(tx, workingOrderId);
}
