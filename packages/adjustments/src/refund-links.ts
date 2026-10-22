import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { decimalToCents, rawCentsToDecimal, type Decimal } from "@waitron/shared";
import type { AdjustmentAction } from "./policy.js";
import { adjustmentRefunds } from "./schema/refund-links.js";

/** Records how much of a refund paid back each named cancel; writes nothing else. */
export async function linkRefundToCancels(
  tx: Transaction,
  input: { tenderRefundId: string; links: readonly { adjustmentId: string; amount: Decimal }[] },
): Promise<void> {
  if (input.links.length === 0) return;
  await tx.insert(adjustmentRefunds).values(
    input.links.map((link) => ({
      adjustmentId: link.adjustmentId,
      tenderRefundId: input.tenderRefundId,
      amount: decimalToCents(link.amount),
    })),
  );
}

/** A cancel as a refund sees it. `quantity` is in thousandths. */
export interface CancelForRefund {
  id: string;
  workingOrderId: string;
  lineId: string | null;
  quantity: number | null;
  action: AdjustmentAction;
  chargeKept: boolean;
  refundHandoff: boolean;
  refundValue: Decimal | null;
  /** What refunds still pending or completed have paid back of it; a failed refund counts nothing. */
  linked: Decimal;
}

/** Each of `adjustmentIds` that exists, with what refunds have linked to it. */
export async function readCancelsForRefund(
  tx: Transaction,
  adjustmentIds: readonly string[],
): Promise<CancelForRefund[]> {
  if (adjustmentIds.length === 0) return [];
  const found = await tx.execute<{
    id: string;
    workingOrderId: string;
    lineId: string | null;
    quantity: number | null;
    action: AdjustmentAction;
    chargeKept: number;
    refundHandoff: number;
    refundValue: string | null;
    linked: string;
  }>(sql`
    select a.id, a.working_order_id as workingOrderId, a.line_id as lineId, a.quantity,
      a.action, a.charge_kept as chargeKept, a.refund_handoff as refundHandoff,
      cast(a.refund_value as text) as refundValue,
      cast(coalesce((
        select sum(l.amount) from adjustment_refunds l
        join tender_refunds r on r.id = l.tender_refund_id
        where l.adjustment_id = a.id and r.state in ('pending', 'completed')
      ), 0) as text) as linked
    from adjustments a
    where a.id in (select value from json_each(${JSON.stringify(adjustmentIds)}))
    order by a.created_at, a.id`);
  return found.rows.map((row) => ({
    ...row,
    chargeKept: row.chargeKept === 1,
    refundHandoff: row.refundHandoff === 1,
    refundValue: row.refundValue === null ? null : rawCentsToDecimal(row.refundValue),
    linked: rawCentsToDecimal(row.linked),
  }));
}
