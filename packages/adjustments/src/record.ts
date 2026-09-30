import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import {
  decimalToCents,
  rawCentsToDecimal,
  stringToThousandths,
  type Decimal,
} from "@waitron/shared";
import type { AdjustmentAction, AdjustmentPolicySnapshot } from "./policy.js";
import { adjustments, type AdjustmentSplit, type AdjustmentStage } from "./schema/adjustments.js";

/** An adjustment to record. `line` is null for a discount on the whole bill. */
export interface NewAdjustment {
  workingOrderId: string;
  line: {
    id: string;
    name: string;
    /** The line's quantity when it was adjusted. */
    quantity: string;
    /** The unit price before any adjustment touched the line. */
    listUnitPriceGross: Decimal;
    creditedTo: string | null;
    stage: AdjustmentStage;
  } | null;
  /** The rows this adjustment split off, each with the row it came from. */
  splits?: readonly AdjustmentSplit[];
  /** How much of the line the adjustment covered; null exactly when `line` is. */
  quantity: string | null;
  reason: { id: string; name: string; policy: AdjustmentPolicySnapshot };
  action: AdjustmentAction;
  percentBp: number | null;
  beforeAmount: Decimal;
  afterAmount: Decimal;
  /** `beforeAmount` less `afterAmount`: what was actually taken off. */
  reduction: Decimal;
  nominalValue: Decimal;
  requestedBy: string;
  approvedBy: string | null;
  note: string | null;
  byGuest?: boolean;
}

/** Writes one adjustment row and returns its id. */
export async function recordAdjustment(tx: Transaction, row: NewAdjustment): Promise<string> {
  const { line } = row;
  const [written] = await tx
    .insert(adjustments)
    .values({
      workingOrderId: row.workingOrderId,
      lineId: line?.id ?? null,
      splits: [...(row.splits ?? [])],
      lineName: line?.name ?? null,
      lineQuantity: line === null ? null : stringToThousandths(line.quantity),
      lineListUnitPrice: line === null ? null : decimalToCents(line.listUnitPriceGross),
      creditedTo: line?.creditedTo ?? null,
      reasonId: row.reason.id,
      reasonName: row.reason.name,
      policySnapshot: row.reason.policy,
      action: row.action,
      quantity: row.quantity === null ? null : stringToThousandths(row.quantity),
      percentBp: row.percentBp,
      beforeAmount: decimalToCents(row.beforeAmount),
      afterAmount: decimalToCents(row.afterAmount),
      reduction: decimalToCents(row.reduction),
      nominalValue: decimalToCents(row.nominalValue),
      requestedBy: row.requestedBy,
      approvedBy: row.approvedBy,
      note: row.note,
      stage: line?.stage ?? null,
      byGuest: row.byGuest ?? false,
    })
    .returning({ id: adjustments.id });
  return written!.id;
}

/** What a reason has already taken, in the shape `evaluateAdjustment` asks for its priors. */
export interface ReasonTotals {
  priorReductionOnBill: Decimal;
  priorPercentOnLineBp: number;
}

/**
 * This reason's earlier reductions on the bill, bill-level discounts included, and its earlier
 * percentage discounts on `lineId`. A row split off another by an adjustment on this bill, a bill
 * discount included, also counts the percentages taken off the row it came from, at any remove —
 * including ones taken after the split, which err toward refusing. A split made by anything other
 * than an adjustment is not recorded here, so a row split that way starts with none. `lineId` null
 * asks for a bill-level discount, which has no line percentage.
 */
export async function readReasonTotals(
  tx: Transaction,
  query: { workingOrderId: string; reasonId: string; lineId: string | null },
): Promise<ReasonTotals> {
  const { workingOrderId, reasonId, lineId } = query;
  const reduction = await tx.execute<{ total: string }>(sql`
    select cast(coalesce(sum(reduction), 0) as text) as total
    from adjustments
    where working_order_id = ${workingOrderId} and reason_id = ${reasonId}`);
  const priorReductionOnBill = rawCentsToDecimal(reduction.rows[0]!.total);
  if (lineId === null) return { priorReductionOnBill, priorPercentOnLineBp: 0 };
  // `percent_bp` is null on every action but `discount_percent` (`adjustments_percent_ck`).
  const percent = await tx.execute<{ total: number }>(sql`
    with recursive lineage(line_id) as (
      select ${lineId}
      union
      select json_extract(split.value, '$.from')
      from adjustments a, json_each(a.splits) split
      join lineage on json_extract(split.value, '$.to') = lineage.line_id
      where a.working_order_id = ${workingOrderId}
    )
    select coalesce(sum(percent_bp), 0) as total
    from adjustments
    where working_order_id = ${workingOrderId} and reason_id = ${reasonId}
      and line_id in (select line_id from lineage)`);
  return { priorReductionOnBill, priorPercentOnLineBp: percent.rows[0]!.total };
}

/**
 * Every discount recorded on the bill, line and bill-level, under any reason: what the venue's
 * limit on a bill's total discount measures. A discounted line later cancelled or moved to another
 * bill still counts here, which errs toward asking for a manager.
 */
export async function readBillDiscountTotal(
  tx: Transaction,
  workingOrderId: string,
): Promise<Decimal> {
  const result = await tx.execute<{ total: string }>(sql`
    select cast(coalesce(sum(reduction), 0) as text) as total
    from adjustments
    where working_order_id = ${workingOrderId}
      and action in ('discount_percent', 'discount_amount')`);
  return rawCentsToDecimal(result.rows[0]!.total);
}
