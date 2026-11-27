import {
  type Transaction,
  refunds as refundRows,
  tenders,
  billPayments,
  invoiceCorrectionRefunds,
  invoiceCorrections,
  billAdvances,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import {
  type RefundRefusalReason,
  findPaymentsByBillPayments,
  MANUAL_PROVIDER,
  findCaptureWarning,
} from "@waitron/payments";
import {
  type Decimal,
  centsToDecimal,
  rawCentsToDecimal,
  AppError,
  subtractDecimal,
  sumDecimals,
} from "@waitron/shared";
import { sql, and, eq, notExists } from "drizzle-orm";
import { type TakenOffBy, advancesTakenOff } from "./advance-taken-off.js";
import type { AdvanceTicket, AdvancePaymentMoney } from "./bill-advances.js";
import { money, cashChange, ZERO } from "./bill-allocation.js";
import { overpaidBy } from "./bill-payment-money.js";
import {
  type PaymentRow,
  type RefundRow,
  type PaymentMoney,
  readPaymentsAndRefunds,
  advancesPaidBy,
  moneyOf,
  fundsOf,
  billPaymentTotal,
} from "./bill-payment-rows.js";
import { type OutsideCardDetails, outsideCardDetails } from "./outside-card.js";
import { sentCounterOrderWithoutReceipt } from "./sent-order-open.js";
import type { TillSaleDeps } from "./working-order-context.js";
import "./errors.js";

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
  /** It paid an advance, whose own sale is `saleId`; `left` and `tipLeft` are what Correct
   * invoice on that ticket has not given back. */
  hasTicket?: true;
  saleId?: string;
  ticket?: AdvanceTicket;
  /** The bill's invoice that took the advance off, once issued; never a corrective of it. */
  takenOffBy?: TakenOffBy;
  left?: Decimal;
  tipLeft?: Decimal;
  /** What Refund a payment gave back from the advance's ticket; `left` still counts it. */
  givenBack?: Decimal;
  id: string;
  submissionId: string;
  kind: PaymentRow["kind"];
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
  refunds: BillRefundView[];
}

export interface BillBalance {
  captureWarning?: import("@waitron/payments").CaptureMismatch;
  workingOrderId: string;
  status: "open" | "placed" | "settled" | "abandoned";
  total: Decimal;
  /** The net applied of the received payments; on a settled bill, less the completed refunds of
   * filed Correct invoices on its payments that paid no advance. */
  received: Decimal;
  /** The applied amount of the pending payments. */
  reserved: Decimal;
  /** The total less received and reserved; zero once the bill is settled or abandoned. */
  outstanding: Decimal;
  /** On an open or placed bill, received and reserved less the total when that is more than
   * nothing; zero otherwise. Such a bill issues nothing. */
  overpaid: Decimal;
  /** The net tips of the received payments. */
  tips: Decimal;
  payments: BillPaymentView[];
  /** On an open bill, or a sent Counter order with no receipt: the open bill its chosen items moved
   * to (Pay for items) while a card payment of theirs is pending. */
  beingPaidOn?: { billId: string; billNumber: number | null };
}

export function toRefundView(refund: RefundRow): BillRefundView {
  return {
    id: refund.id,
    paymentId: refund.billPaymentId!,
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
  refunds: readonly RefundRow[],
  manualCards: ReadonlyMap<string, OutsideCardDetails & { externalRef: string | null }>,
  advance:
    | (PaymentMoney &
        Pick<AdvancePaymentMoney, "saleId" | "ticket" | "givenBack"> & {
          takenOffBy: TakenOffBy | undefined;
        })
    | undefined,
): BillPaymentView {
  const manual = manualCards.get(payment.id);
  return {
    ...outsideCardDetails(manual ?? {}),
    ...(manual?.externalRef == null ? {} : { externalRef: manual.externalRef }),
    ...(advance === undefined
      ? {}
      : {
          hasTicket: true as const,
          saleId: advance.saleId,
          ticket: advance.ticket,
          ...(advance.takenOffBy === undefined ? {} : { takenOffBy: advance.takenOffBy }),
          left: money(advance.netApplied),
          tipLeft: money(advance.netTip),
          givenBack: centsToDecimal(advance.givenBack),
        }),
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
    refunds: refunds.filter((refund) => refund.billPaymentId === payment.id).map(toRefundView),
  };
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
/** The applied money completed refunds of filed corrections gave back from the
 * tenders of the bill's payments that paid no advance; an advance's own are already out of what is
 * left of it. Until a correction files, and for a plain refund, the bill's total is as it was, so
 * those are left in. Filtered by the bill, so the values it binds do not grow with its payments. */
async function givenBackAfterSettling(tx: Transaction, workingOrderId: string): Promise<Decimal> {
  const [row] = await tx
    .select({ cents: sql<string>`cast(coalesce(sum(${refundRows.appliedAmount}), 0) as text)` })
    // Pin the sale-key index because the box collects no planner statistics.
    .from(sql`${refundRows} indexed by refunds_sale_submission_key`)
    .innerJoin(
      tenders,
      and(eq(tenders.id, refundRows.tenderId), eq(refundRows.saleId, tenders.saleId)),
    )
    .innerJoin(billPayments, eq(billPayments.id, tenders.billPaymentId))
    .innerJoin(invoiceCorrectionRefunds, eq(invoiceCorrectionRefunds.tenderRefundId, refundRows.id))
    .innerJoin(
      invoiceCorrections,
      eq(invoiceCorrections.id, invoiceCorrectionRefunds.invoiceCorrectionId),
    )
    .where(
      and(
        eq(billPayments.workingOrderId, workingOrderId),
        notExists(
          tx
            .select({ id: billAdvances.id })
            .from(billAdvances)
            .where(eq(billAdvances.billPaymentId, billPayments.id)),
        ),
        eq(refundRows.state, "completed"),
        eq(invoiceCorrections.state, "filed"),
      ),
    );
  return rawCentsToDecimal(row!.cents);
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
    .select({ status: workingOrders.status, partyId: workingOrders.partyId })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  if (order === undefined) {
    throw new AppError("working_order.not_found", { workingOrderId });
  }
  const { rows, refunds, advanced } = await readPaymentsAndRefunds(tx, workingOrderId);
  const advances = await advancesPaidBy(tx, [workingOrderId], advanced);
  const held = moneyOf(rows, refunds, advances.payments);
  const manualCards = await manualCardsOf(tx, rows);
  const funds = fundsOf(
    workingOrderId,
    await billPaymentTotal(tx, workingOrderId, advances, total),
    held,
  );
  const outstanding = subtractDecimal(subtractDecimal(funds.total, funds.received), funds.reserved);
  const takenOff = await advancesTakenOff(
    tx,
    [...advances.payments.values()].map((advance) => advance.saleId),
  );
  const advanceOf = (payment: PaymentMoney) => {
    const advance = advances.payments.get(payment.row.id);
    return advance === undefined
      ? undefined
      : {
          ...payment,
          saleId: advance.saleId,
          ticket: advance.ticket,
          givenBack: advance.givenBack,
          takenOffBy: takenOff.get(advance.saleId),
        };
  };
  const captureWarning = await findCaptureWarning(tx, { orderIds: [workingOrderId] });
  const beingPaidOn = await itemsBeingPaidOn(tx, workingOrderId, order);
  return {
    ...(captureWarning === undefined ? {} : { captureWarning }),
    ...(beingPaidOn === undefined ? {} : { beingPaidOn }),
    workingOrderId,
    status: order.status,
    total: money(funds.total),
    received: money(
      order.status === "settled"
        ? subtractDecimal(funds.received, await givenBackAfterSettling(tx, workingOrderId))
        : funds.received,
    ),
    reserved: money(funds.reserved),
    outstanding: order.status === "open" || order.status === "placed" ? money(outstanding) : ZERO,
    overpaid:
      order.status === "open" || order.status === "placed"
        ? (overpaidBy(outstanding) ?? ZERO)
        : ZERO,
    tips: money(
      sumDecimals(held.filter(({ row }) => row.state === "received").map(({ netTip }) => netTip)),
    ),
    payments: held.map((payment) => toView(payment.row, refunds, manualCards, advanceOf(payment))),
  };
}

async function itemsBeingPaidOn(
  tx: Transaction,
  sourceId: string,
  source: { status: string; partyId: string | null },
): Promise<BillBalance["beingPaidOn"]> {
  if (source.status !== "open" && (source.status !== "placed" || source.partyId !== null))
    return undefined;
  const [row] = await tx
    .select({ billId: workingOrders.id, billNumber: workingOrders.billNumber })
    .from(workingOrders)
    .innerJoin(billPayments, eq(billPayments.workingOrderId, workingOrders.id))
    .where(
      and(
        eq(workingOrders.itemsPaidFrom, sourceId),
        eq(workingOrders.status, "open"),
        eq(billPayments.state, "pending"),
      ),
    )
    .limit(1);
  if (row === undefined || source.status === "open") return row;
  return (await sentCounterOrderWithoutReceipt(tx, sourceId, source)) ? row : undefined;
}
/** Reads a bill's balance in its own transaction. */
export async function getBillBalance(
  deps: Pick<TillSaleDeps, "db">,
  workingOrderId: string,
): Promise<BillBalance> {
  return withTransaction(deps.db, (tx) => readBillBalance(tx, workingOrderId));
}
