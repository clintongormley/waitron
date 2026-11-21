import { and, eq, inArray, sql } from "drizzle-orm";
import { refunds as refundRows, type billPayments, type Transaction } from "@waitron/db";
import { MONEY_SCALE, subtractDecimal, sumDecimals, toScale } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";

type PaymentRow = typeof billPayments.$inferSelect;
type RefundRow = typeof refundRows.$inferSelect;

export type RefundMoney = Pick<
  RefundRow,
  "billPaymentId" | "appliedAmount" | "tipAmount" | "state"
>;

/** What a payment's completed refunds leave of its applied money and tip, in cents, and those
 * refunds; `refunds` may hold refunds of other payments, and in other states. */
export function netOfRefunds<R extends RefundMoney>(
  payment: Pick<PaymentRow, "id" | "applied" | "tip">,
  refunds: readonly R[],
): { applied: number; tip: number; own: R[] } {
  const own = refunds.filter(
    (refund) => refund.billPaymentId === payment.id && refund.state === "completed",
  );
  const refunded = (pick: (refund: R) => number) =>
    own.reduce((sum, refund) => sum + pick(refund), 0);
  return {
    applied: payment.applied - refunded((refund) => refund.appliedAmount),
    tip: payment.tip - refunded((refund) => refund.tipAmount),
    own,
  };
}

/** The completed refunds of these bill payments, oldest first. */
export async function completedRefundsOf(tx: Transaction, rows: readonly Pick<PaymentRow, "id">[]) {
  if (rows.length === 0) return [];
  return tx
    .select({
      billPaymentId: refundRows.billPaymentId,
      appliedAmount: refundRows.appliedAmount,
      tipAmount: refundRows.tipAmount,
      state: refundRows.state,
    })
    .from(refundRows)
    .where(
      and(
        inArray(
          refundRows.billPaymentId,
          rows.map((row) => row.id),
        ),
        eq(refundRows.state, "completed"),
      ),
    )
    .orderBy(refundRows.completedAt, sql`${refundRows}.rowid`);
}

/** A bill's `total` less what it has received, at the money scale. */
export function outstandingOf(total: Decimal, received: Decimal | undefined): Decimal {
  return received === undefined ? total : toScale(subtractDecimal(total, received), MONEY_SCALE);
}

/** What an issued bill still owes: its amount due less what each received payment has kept of its
 * applied money. */
export function owedOf(amountDue: Decimal, keptApplied: readonly Decimal[]): Decimal {
  return outstandingOf(amountDue, sumDecimals(keptApplied));
}
