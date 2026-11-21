import { eq } from "drizzle-orm";
import { refunds, type Transaction } from "@waitron/db";
import type { TrustedReading } from "@waitron/fiscal";
import { centsToDecimal, type NodeId } from "@waitron/shared";
import { recordManualRefund } from "@waitron/payments";
import type { BillRefundDeps } from "./bill-refunds.js";

type RefundRow = typeof refunds.$inferSelect;
type RefundCompletion = {
  beforeCompletion?: (refund: RefundRow) => Promise<void>;
  manualPaymentRef?: (refund: RefundRow) => Promise<string>;
  openDrawer?: (refund: RefundRow) => Promise<void>;
};

export async function refuseUntilRefundable(
  tx: Transaction,
  backend: BillRefundDeps["backend"],
  nodeId: NodeId,
  reading: TrustedReading,
): Promise<void> {
  await backend.refuseUntilRecordable(tx, reading);
  await backend.refuseNewRefund(tx, nodeId);
}

/**
 * Takes a refund `reserveTenderRefund` has just written forward: refused while the clock is behind
 * the latest fiscal record or the regime takes no new refund; a cash or hand-keyed refund is then
 * completed (opening the drawer, for cash, when `openDrawer` is given); attendance hears of it
 * either way. `beforeCompletion` runs after the refusals, before completion.
 */
export async function carryNewTenderRefund(
  tx: Transaction,
  deps: Pick<BillRefundDeps, "backend" | "attendance">,
  nodeId: NodeId,
  reading: TrustedReading,
  refund: RefundRow,
  steps: RefundCompletion = {},
): Promise<RefundRow> {
  await refuseUntilRefundable(tx, deps.backend, nodeId, reading);
  return completeRefundReservation(tx, deps, reading, refund, steps);
}

export async function completeRefundReservation(
  tx: Transaction,
  deps: Pick<BillRefundDeps, "attendance">,
  reading: TrustedReading,
  refund: RefundRow,
  steps: RefundCompletion = {},
): Promise<RefundRow> {
  await steps.beforeCompletion?.(refund);
  if (refund.manual) {
    await recordManualRefund(tx, {
      paymentRef: await steps.manualPaymentRef!(refund),
      amount: centsToDecimal(refund.appliedAmount + refund.tipAmount),
      authorizedBy: refund.authorizedBy,
    });
  }
  if (refund.method === "cash" || refund.manual) {
    const [completed] = await tx
      .update(refunds)
      .set({
        state: "completed",
        completedAt: reading.instant.toISOString(),
      })
      .where(eq(refunds.id, refund.id))
      .returning();
    refund = completed!;
    if (refund.method === "cash") await steps.openDrawer?.(refund);
  }
  await deps.attendance?.(tx, {
    source: "refund",
    key: refund.id,
    personId: refund.requestedBy,
    kind: "payment",
    at: refund.createdAt,
    offsetMinutes: 0,
    outcome: refund.state === "completed" ? "qualified" : "pending",
  });
  return refund;
}
