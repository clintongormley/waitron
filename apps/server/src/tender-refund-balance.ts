import { and, eq, inArray, or } from "drizzle-orm";
import {
  billPaymentRefunds,
  saleSettlements,
  saleVoids,
  tenderRefunds,
  tenders,
  type Transaction,
} from "@waitron/db";
import { MANUAL_PROVIDER, payments } from "@waitron/payments";
import { paymentRefunds } from "@waitron/payments/src/schema/payment-refunds.js";
import {
  addDecimal,
  centsToDecimal,
  compareDecimal,
  decimal,
  subtractDecimal,
  sumDecimals,
  type Decimal,
} from "@waitron/shared";
import { resolveTransactionScope } from "./find-bill-transactions.js";
import type { TillConfig } from "./till-config.js";
import type { RefundableTender } from "./tender-refund-types.js";

const ZERO = decimal("0.00");
const maximum = (left: Decimal, right: Decimal) =>
  compareDecimal(left, right) >= 0 ? left : right;
const minimum = (left: Decimal, right: Decimal) =>
  compareDecimal(left, right) <= 0 ? left : right;

export async function readRefundableTenders(
  tx: Transaction,
  cfg: TillConfig,
  saleId: string,
): Promise<RefundableTender[]> {
  await resolveTransactionScope(tx, cfg, saleId);
  const [settlement] = await tx
    .select({ id: saleSettlements.id })
    .from(saleSettlements)
    .where(eq(saleSettlements.saleId, saleId));
  const [voided] = await tx
    .select({ id: saleVoids.id })
    .from(saleVoids)
    .where(eq(saleVoids.saleId, saleId));
  if (settlement === undefined || voided !== undefined) return [];
  const rows = (
    await tx
      .select()
      .from(tenders)
      .where(eq(tenders.saleId, saleId))
      .orderBy(tenders.settledAt, tenders.id)
  ).map((row) => ({
    ...row,
    amount: centsToDecimal(row.amount),
    tipAmount: centsToDecimal(row.tipAmount),
  }));
  if (rows.length === 0) return [];
  const billIds = rows.flatMap((row) => (row.billPaymentId === null ? [] : [row.billPaymentId]));
  const captures = rows.every((row) => row.method !== "card")
    ? []
    : await tx
        .select()
        .from(payments)
        .where(
          or(
            eq(payments.saleId, saleId),
            billIds.length === 0 ? undefined : inArray(payments.billPaymentId, billIds),
          ),
        );
  const ledger = (
    await tx
      .select()
      .from(tenderRefunds)
      .where(
        inArray(
          tenderRefunds.tenderId,
          rows.map((row) => row.id),
        ),
      )
  ).map((row) => ({
    ...row,
    appliedAmount: centsToDecimal(row.appliedAmount),
    tipAmount: centsToDecimal(row.tipAmount),
  }));
  const priorBill =
    billIds.length === 0
      ? []
      : (
          await tx
            .select()
            .from(billPaymentRefunds)
            .where(
              and(
                inArray(billPaymentRefunds.billPaymentId, billIds),
                eq(billPaymentRefunds.state, "completed"),
              ),
            )
        ).map((row) => ({
          ...row,
          appliedAmount: centsToDecimal(row.appliedAmount),
          tipAmount: centsToDecimal(row.tipAmount),
        }));
  const providerReturns =
    captures.length === 0
      ? []
      : (
          await tx
            .select()
            .from(paymentRefunds)
            .where(
              and(
                inArray(
                  paymentRefunds.paymentId,
                  captures.map((row) => row.id),
                ),
                eq(paymentRefunds.state, "succeeded"),
              ),
            )
        ).map((row) => ({ ...row, amount: centsToDecimal(row.amount) }));

  const result: RefundableTender[] = [];
  for (const row of rows) {
    if (row.method !== "cash" && row.method !== "card") continue;
    const returns = ledger.filter(
      (refund) => refund.tenderId === row.id && refund.state !== "failed",
    );
    const pending = returns.find((refund) => refund.state === "pending");
    let applied = maximum(
      ZERO,
      subtractDecimal(
        subtractDecimal(row.amount, row.tipAmount),
        sumDecimals(returns.map((refund) => refund.appliedAmount)),
      ),
    );
    let tip = maximum(
      ZERO,
      subtractDecimal(row.tipAmount, sumDecimals(returns.map((refund) => refund.tipAmount))),
    );
    let last4: string | null = null;
    let manual = false;
    if (row.method === "card") {
      // A direct tender has no capture key. Only an unambiguous one-card/one-capture sale can name its original payment.
      if (
        row.billPaymentId === null &&
        rows.filter((tender) => tender.method === "card" && tender.billPaymentId === null)
          .length !== 1
      )
        continue;
      const matching = captures.filter(
        (capture) =>
          (row.billPaymentId === null
            ? capture.saleId === saleId && capture.billPaymentId === null
            : capture.billPaymentId === row.billPaymentId) &&
          ["captured", "settled", "partially_refunded", "refunded"].includes(capture.state),
      );
      if (matching.length !== 1) continue;
      const payment = matching[0]!;
      if (
        row.billPaymentId === null &&
        compareDecimal(centsToDecimal(payment.amount), row.amount) !== 0
      )
        continue;
      last4 = payment.cardLast4;
      manual = payment.provider === MANUAL_PROVIDER;
      const preInvoice = sumDecimals(
        priorBill
          .filter((refund) => refund.billPaymentId === row.billPaymentId)
          .map((refund) => addDecimal(refund.appliedAmount, refund.tipAmount)),
      );
      const accounted = addDecimal(
        preInvoice,
        sumDecimals(
          returns
            .filter((refund) => refund.state === "completed")
            .map((refund) => addDecimal(refund.appliedAmount, refund.tipAmount)),
        ),
      );
      // Bill tenders already exclude pre-invoice returns. Provider evidence mirrors those and completed ledger returns.
      const provided =
        payment.state === "refunded"
          ? centsToDecimal(payment.amount)
          : sumDecimals(
              providerReturns
                .filter((refund) => refund.paymentId === payment.id)
                .map((refund) => refund.amount),
            );
      const extra = maximum(ZERO, subtractDecimal(provided, accounted));
      const appliedExtra = minimum(applied, extra);
      applied = subtractDecimal(applied, appliedExtra);
      tip = maximum(ZERO, subtractDecimal(tip, subtractDecimal(extra, appliedExtra)));
    }
    if (compareDecimal(addDecimal(applied, tip), ZERO) === 0 && pending === undefined) continue;
    result.push({
      tenderId: row.id,
      method: row.method,
      last4,
      appliedRemaining: applied,
      tipRemaining: tip,
      pendingRefundId: pending?.id ?? null,
      manual,
    });
  }
  return result;
}
