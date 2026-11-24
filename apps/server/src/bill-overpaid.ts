import { and, eq, inArray } from "drizzle-orm";
import { billPayments, recordActivity, tenders, type Transaction } from "@waitron/db";
import { readPaymentsSettings } from "@waitron/payments";
import {
  AppError,
  centsToDecimal,
  compareDecimal,
  decimalToCents,
  subtractDecimal,
  sumDecimals,
} from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import {
  findSubmission,
  issueIfFullyPaid,
  readBillBalance,
  readBillExcess,
  requireRefundableBill,
  type BillBalance,
} from "./bill-payments.js";
import { assertStillSignedIn } from "./till-session.js";
import { requireEconomicWrite } from "./trading-admission.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import {
  refusePaymentInFlight,
  refusePendingPartPayment,
  refuseRefundInProgress,
  type TillSaleDeps,
} from "./working-order.js";
import "./errors.js";

/**
 * The permission a give-back of `amount` from a bill payment needs, its applied money and tip
 * together (owner, 2026-11-24): on a bill Pay for items left holding more than it owes, handing
 * back no more than that excess is money just taken on this bill, so `payment.take`; any other
 * refund `sale.refund`. The excess counts applied money only, so applied money given back lowers
 * it and a tip given back does not: every tip the bill's payments have given back is counted
 * against it too, or give-backs in turn could hand back more than it.
 */
export async function refundPermission(
  tx: Transaction,
  workingOrderId: string,
  amount: Decimal,
): Promise<"payment.take" | "sale.refund"> {
  const { excess, held } = await readBillExcess(tx, workingOrderId);
  if (excess === undefined) return "sale.refund";
  const tipsGivenBack = held.map(({ row, netTip }) =>
    subtractDecimal(centsToDecimal(row.tip), netTip),
  );
  return compareDecimal(sumDecimals([amount, ...tipsGivenBack]), excess) <= 0
    ? "payment.take"
    : "sale.refund";
}

/**
 * Keep what an open or placed bill was paid over its total as a tip, then issue the bill if that
 * leaves it paid: the excess moves from `applied` to `tip` on its received payments, the newest
 * first, each giving up no more than its refunds have left of its applied money. A payment that
 * paid an advance, already has a tender, or paid for chosen items keeps its money as it is.
 *
 * `bill.not_overpaid` when nothing is paid over the total; `bill.tip_not_allowed_on_excess` while
 * the venue takes no tips. Nothing records `submissionId`, so a retry after a lost answer is
 * refused, as the bill is no longer overpaid or open; it may not be one of the bill's payments' or
 * refunds'.
 */
export async function keepOverpaidAsTip(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  submissionId: string,
  operator: { personId: string; sessionId: string },
): Promise<BillBalance> {
  await requireEconomicWrite(tx, cfg, deps.admission);
  await assertStillSignedIn(tx, {
    deviceId: cfg.origin.deviceId,
    personId: operator.personId,
    sessionId: operator.sessionId,
  });
  if ((await requireRefundableBill(tx, workingOrderId)) === "placed") {
    await refuseRefundInProgress(tx, [workingOrderId]);
    await refusePendingPartPayment(tx, [workingOrderId], "any");
  } else {
    await refusePaymentInFlight(tx, [workingOrderId]);
  }
  const earlier = await findSubmission(tx, workingOrderId, submissionId);
  if (earlier.payment !== undefined || earlier.refund !== undefined)
    throw new AppError("submission.id_reused", { submissionId });
  const { excess, held, advances } = await readBillExcess(tx, workingOrderId);
  if (excess === undefined) throw new AppError("bill.not_overpaid", { workingOrderId });
  if (!(await readPaymentsSettings(tx)).doc.tipsEnabled)
    throw new AppError("bill.tip_not_allowed_on_excess", { workingOrderId });

  const received = held.filter(
    ({ row }) => row.state === "received" && !advances.payments.has(row.id),
  );
  const tendered = new Set(
    (
      await tx
        .select({ id: tenders.billPaymentId })
        .from(tenders)
        .where(
          inArray(
            tenders.billPaymentId,
            received.map(({ row }) => row.id),
          ),
        )
    ).map(({ id }) => id),
  );
  // An items payment's applied money is what its paid lines record, so it keeps it.
  const newestFirst = received
    .filter(({ row }) => !tendered.has(row.id) && row.kind !== "items")
    .sort((a, b) => b.row.receivedAt!.localeCompare(a.row.receivedAt!));
  let left = decimalToCents(excess);
  const moved: { billPaymentId: string; amount: string }[] = [];
  for (const { row, netApplied } of newestFirst) {
    if (left === 0) break;
    const cents = Math.min(left, decimalToCents(netApplied));
    if (cents <= 0) continue;
    await tx
      .update(billPayments)
      .set({ applied: row.applied - cents, tip: row.tip + cents })
      .where(and(eq(billPayments.id, row.id), eq(billPayments.workingOrderId, workingOrderId)));
    moved.push({ billPaymentId: row.id, amount: centsToDecimal(cents) });
    left -= cents;
  }
  await recordActivity(tx, {
    kind: "bill.overpaid_kept_as_tip",
    subjectId: workingOrderId,
    personId: operator.personId,
    deviceId: cfg.origin.deviceId,
    data: { amount: centsToDecimal(decimalToCents(excess) - left), payments: moved },
  });
  await issueIfFullyPaid(tx, deps, cfg, workingOrderId, operator.personId);
  return readBillBalance(tx, workingOrderId);
}
