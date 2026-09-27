import { and, eq } from "drizzle-orm";
import { billPaymentRefunds, billPayments, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { authorize } from "@waitron/identity";
import type { Override } from "@waitron/identity";
import {
  AppError,
  compareDecimal,
  decimal,
  decimalToCents,
  MONEY_SCALE,
  toScale,
} from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import {
  readBillBalance,
  readPaymentMoney,
  requireOpenBill,
  toRefundView,
} from "./bill-payments.js";
import type { BillBalance, BillRefundView } from "./bill-payments.js";
import { enqueueBillRefundDrawer } from "./receipt-print.js";
import type { TillConfig } from "./till-config.js";
import { fingerprint } from "./visits.js";
import { refusePaymentInFlight } from "./working-order.js";
import type { TillSaleDeps } from "./working-order.js";
import "./errors.js";

const ZERO = decimal("0.00");

export interface BillRefundRequest {
  submissionId: string;
  appliedAmount: string;
  tipAmount: string;
  reason: string;
  /** A second person holding `sale.refund`, when the operator does not. */
  override?: Override;
}

export interface BillRefundResult {
  refund: BillRefundView;
  balance: BillBalance;
}

type RefundRow = typeof billPaymentRefunds.$inferSelect;

const money = (value: string): Decimal => toScale(decimal(value), MONEY_SCALE);

async function resultOf(tx: Transaction, refund: RefundRow, workingOrderId: string) {
  return { refund: toRefundView(refund), balance: await readBillBalance(tx, workingOrderId) };
}

/**
 * Give money back from one bill payment of an open bill, needing `sale.refund` from the operator or
 * the override. A payment gives back up to its net applied money; its tip comes back only with the
 * whole of what is left of it; an item payment only whole, which frees its lines.
 *
 * Keyed by `submissionId` across the whole bill (design §5.1): the same refund again answers the
 * first and writes nothing; the id with another request, of another payment, or naming one of the
 * bill's payments is `submission.id_reused`. The override is left out of the comparison, so a retry
 * authorised by another manager is the same refund, and no PIN is hashed into a stored fingerprint.
 *
 * Cash only: a cash refund is written `completed`, and opens the till's drawer, in one transaction.
 */
export async function refundBillPayment(
  deps: Pick<TillSaleDeps, "db" | "clock">,
  cfg: TillConfig,
  workingOrderId: string,
  paymentId: string,
  req: BillRefundRequest,
  operator: { personId: string; sessionId: string },
): Promise<BillRefundResult> {
  const applied = money(req.appliedAmount);
  const tip = money(req.tipAmount);
  const print = fingerprint({
    paymentId,
    appliedAmount: applied,
    tipAmount: tip,
    reason: req.reason,
  });
  return withTransaction(deps.db, async (tx) => {
    const authorization = await authorize(tx, {
      sessionId: operator.sessionId,
      permission: "sale.refund",
      override: req.override,
    });
    const [payment] = await tx
      .select()
      .from(billPayments)
      .where(and(eq(billPayments.id, paymentId), eq(billPayments.workingOrderId, workingOrderId)));
    if (payment === undefined) throw new AppError("bill.payment_not_found", { paymentId });

    const [earlier] = await tx
      .select({ refund: billPaymentRefunds })
      .from(billPaymentRefunds)
      .innerJoin(billPayments, eq(billPayments.id, billPaymentRefunds.billPaymentId))
      .where(
        and(
          eq(billPayments.workingOrderId, workingOrderId),
          eq(billPaymentRefunds.submissionId, req.submissionId),
        ),
      );
    if (earlier !== undefined) {
      if (earlier.refund.fingerprint !== print) {
        throw new AppError("submission.id_reused", { submissionId: req.submissionId });
      }
      return resultOf(tx, earlier.refund, workingOrderId);
    }
    const [paymentWithId] = await tx
      .select({ id: billPayments.id })
      .from(billPayments)
      .where(
        and(
          eq(billPayments.workingOrderId, workingOrderId),
          eq(billPayments.submissionId, req.submissionId),
        ),
      );
    if (paymentWithId !== undefined) {
      throw new AppError("submission.id_reused", { submissionId: req.submissionId });
    }

    await requireOpenBill(tx, workingOrderId);
    await refusePaymentInFlight(tx, [workingOrderId]);

    const held = (await readPaymentMoney(tx, [workingOrderId])).find(
      ({ row }) => row.id === paymentId,
    )!;
    const [refundable, refundableTip] =
      payment.state === "received" ? [held.netApplied, held.netTip] : [ZERO, ZERO];
    const whole = compareDecimal(applied, refundable) === 0;
    if (
      compareDecimal(applied, refundable) > 0 ||
      (compareDecimal(tip, ZERO) !== 0 && !(whole && compareDecimal(tip, refundableTip) === 0))
    ) {
      throw new AppError("bill.refund_exceeds_payment", {
        paymentId,
        applied: toScale(refundable, MONEY_SCALE),
        tip: toScale(refundableTip, MONEY_SCALE),
      });
    }
    if (payment.kind === "items" && !whole) {
      throw new AppError("management.request_invalid", { field: "appliedAmount" });
    }
    if (payment.method !== "cash") {
      throw new AppError("bill.refund_unsupported", { paymentId });
    }

    const completedAt = deps.clock.now().instant.toISOString();
    const [refund] = await tx
      .insert(billPaymentRefunds)
      .values({
        billPaymentId: paymentId,
        submissionId: req.submissionId,
        fingerprint: print,
        appliedAmount: decimalToCents(applied),
        tipAmount: decimalToCents(tip),
        reason: req.reason,
        authorizedBy: authorization.authorizedBy,
        requestedBy: operator.personId,
        tillId: cfg.tillId,
        state: "completed",
        createdAt: completedAt,
        completedAt,
      })
      .returning();
    await enqueueBillRefundDrawer(tx, cfg, paymentId, operator.personId, {
      authorizedBy: authorization.authorizedBy,
      viaOverride: authorization.viaOverride,
    });
    return resultOf(tx, refund!, workingOrderId);
  });
}
