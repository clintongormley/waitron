import { and, eq, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { billPayments, tenders, type Transaction } from "@waitron/db";
import { payments, type CardDetails } from "@waitron/payments";
import { centsToDecimal, compareDecimal, type Decimal, type SaleId } from "@waitron/shared";
import { cashChange, money, ZERO } from "./bill-allocation.js";
import { completedRefundsOf, netOfRefunds, owedOf } from "./bill-payment-money.js";
import { cardOf, type StoredCard } from "./card-details.js";
import { outsideCardDetails, type OutsideCardDetails } from "./outside-card.js";
import { readIssuedSales } from "./sale-due.js";

/**
 * One payment of a bill paid in parts, as the ticket lists it. `change` is what
 * the bill payment handed back when it was taken, never derived from the tender, whose amount a
 * refund lowers.
 */
export type BillTenderLine = (
  | { method: "cash"; amount: string; tip: string; tendered: string; change: string }
  | ({
      method: "card";
      amount: string;
      tip: string;
      reference: string | null;
      card?: CardDetails;
    } & OutsideCardDetails)
) & { refunds: BillTenderRefund[] };

/** Money given back from a bill payment: a `completed` refund, oldest first. */
export interface BillTenderRefund {
  amount: string;
  tip: string;
}

const capturedCards = alias(payments, "captured_card");

const BILL_TENDER_COLUMNS = {
  billPaymentId: billPayments.id,
  method: billPayments.method,
  applied: billPayments.applied,
  paymentTip: billPayments.tip,
  tendered: billPayments.tendered,
  reference: payments.externalRef,
  externalProvider: payments.externalProvider,
  externalMachine: payments.externalMachine,
  scheme: capturedCards.cardScheme,
  last4: capturedCards.cardLast4,
  entryMode: capturedCards.cardEntryMode,
  authCode: capturedCards.cardAuthCode,
};

const MANUAL_CARD_JOIN = and(
  eq(payments.billPaymentId, billPayments.id),
  eq(payments.provider, "manual"),
);

const CAPTURED_CARD_JOIN = and(
  eq(capturedCards.billPaymentId, billPayments.id),
  isNotNull(capturedCards.settledAt),
);

interface BillTenderRow extends StoredCard {
  method: string;
  amount: number;
  tip: number;
  applied: number;
  paymentTip: number;
  tendered: number | null;
  reference: string | null;
  externalProvider: "connected_account" | "other" | null;
  externalMachine: string | null;
}

type CompletedRefund = Awaited<ReturnType<typeof completedRefundsOf>>[number];

function billTenderLineOf(row: BillTenderRow, refunds: readonly CompletedRefund[]): BillTenderLine {
  const amount = centsToDecimal(row.amount);
  const tip = centsToDecimal(row.tip);
  const given = refunds.map((refund) => ({
    amount: centsToDecimal(refund.appliedAmount),
    tip: centsToDecimal(refund.tipAmount),
  }));
  if (row.method === "cash") {
    return {
      method: "cash",
      amount,
      tip,
      tendered: centsToDecimal(row.tendered!),
      change: cashChange(row.tendered!, row.applied, row.paymentTip),
      refunds: given,
    };
  }
  return {
    method: "card",
    amount,
    tip,
    reference: row.reference ?? null,
    ...outsideCardDetails(row),
    ...cardOf(row),
    refunds: given,
  };
}

/** The payments of a sale whose tenders were taken as bill payments, in the order they were taken. */
export async function readBillTenderLines(
  tx: Transaction,
  saleId: SaleId,
): Promise<BillTenderLine[]> {
  const rows = await tx
    .select({
      ...BILL_TENDER_COLUMNS,
      method: tenders.method,
      amount: tenders.amount,
      tip: tenders.tipAmount,
    })
    .from(tenders)
    .innerJoin(billPayments, eq(billPayments.id, tenders.billPaymentId))
    .leftJoin(payments, MANUAL_CARD_JOIN)
    .leftJoin(capturedCards, CAPTURED_CARD_JOIN)
    .where(eq(tenders.saleId, saleId))
    // Two payments can share a millisecond; here and below a tie falls back to `rowid`, the order
    // the rows were written in.
    .orderBy(tenders.settledAt, sql`${billPayments}.rowid`);
  const refunds = await completedRefundsOf(
    tx,
    rows.map((row) => ({ id: row.billPaymentId })),
  );
  return rows.map((row) =>
    billTenderLineOf(
      row,
      refunds.filter((refund) => refund.billPaymentId === row.billPaymentId),
    ),
  );
}

/** The bill's received payments, oldest first, net of completed refunds (one given back whole is
 * left off), and what each received payment has kept of its applied money. */
async function readUnsettledBill(
  tx: Transaction,
  workingOrderId: string,
): Promise<{ lines: BillTenderLine[]; keptApplied: Decimal[] }> {
  const rows = await tx
    .select(BILL_TENDER_COLUMNS)
    .from(billPayments)
    .leftJoin(payments, MANUAL_CARD_JOIN)
    .leftJoin(capturedCards, CAPTURED_CARD_JOIN)
    .where(and(eq(billPayments.workingOrderId, workingOrderId), eq(billPayments.state, "received")))
    .orderBy(billPayments.receivedAt, sql`${billPayments}.rowid`);
  const refunds = await completedRefundsOf(
    tx,
    rows.map((row) => ({ id: row.billPaymentId })),
  );
  const nets = rows.map((row) => ({
    row,
    net: netOfRefunds(
      { id: row.billPaymentId, applied: row.applied, tip: row.paymentTip },
      refunds,
    ),
  }));
  return {
    lines: nets.flatMap(({ row, net }) => {
      const amount = net.applied + net.tip;
      return amount > 0 ? [billTenderLineOf({ ...row, amount, tip: net.tip }, net.own)] : [];
    }),
    keptApplied: nets.map(({ net }) => centsToDecimal(net.applied)),
  };
}

function listed(lines: BillTenderLine[]): { payments?: BillTenderLine[] } {
  return lines.length === 0 ? {} : { payments: lines };
}

/**
 * The payments a receipt lists, and what is still owed. A settled sale lists its tenders taken as
 * bill payments; an issued, unsettled sale of an order lists its bill's received payments that
 * still hold money, net of completed refunds, and owes its amount due less their applied money.
 */
export async function readReceiptPayments(
  tx: Transaction,
  saleId: SaleId,
  workingOrderId: string | null,
  settled: boolean,
): Promise<{ payments?: BillTenderLine[]; owed?: string }> {
  if (settled || workingOrderId === null) return listed(await readBillTenderLines(tx, saleId));
  const { amountDue } = (await readIssuedSales(tx, [workingOrderId])).get(workingOrderId)!;
  const { lines, keptApplied } = await readUnsettledBill(tx, workingOrderId);
  const owed = owedOf(amountDue, keptApplied);
  return {
    ...listed(lines),
    ...(compareDecimal(owed, ZERO) > 0 ? { owed: money(owed) } : {}),
  };
}
