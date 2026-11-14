import { eq } from "drizzle-orm";
import { tenderRefunds, type Transaction } from "@waitron/db";
import type { TrustedReading } from "@waitron/fiscal";
import type { NodeId } from "@waitron/shared";
import type { BillRefundDeps } from "./bill-refunds.js";

type RefundRow = typeof tenderRefunds.$inferSelect;

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
  steps: {
    beforeCompletion?: (refund: RefundRow) => Promise<void>;
    openDrawer?: (refund: RefundRow) => Promise<void>;
  } = {},
): Promise<RefundRow> {
  await deps.backend.refuseUntilRecordable(tx, reading);
  await deps.backend.refuseNewRefund(tx, nodeId);
  await steps.beforeCompletion?.(refund);
  if (refund.method === "cash" || refund.manual) {
    const [completed] = await tx
      .update(tenderRefunds)
      .set({
        state: "completed",
        completedAt: reading.instant.toISOString(),
      })
      .where(eq(tenderRefunds.id, refund.id))
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
