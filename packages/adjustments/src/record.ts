import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import {
  decimalToCents,
  rawCentsToDecimal,
  stringToThousandths,
  type Decimal,
} from "@waitron/shared";
import type { AdjustmentAction, AdjustmentPolicySnapshot } from "./policy.js";
import { adjustments, type AdjustmentStage } from "./schema/adjustments.js";

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
    /** Rows this adjustment carved off the line. */
    splitLineIds?: readonly string[];
  } | null;
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
      splitLineIds: [...(line?.splitLineIds ?? [])],
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
 * percentage discounts on `lineId`. A line carved off another by an adjustment on this bill also
 * counts the percentages taken off the line it came from, at any remove — including ones taken
 * after the carve, which err toward refusing. A split made by anything other than an adjustment is
 * not recorded here, so a row carved that way starts with none. `lineId` null asks for a bill-level
 * discount, which has no line percentage.
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
      select a.line_id
      from adjustments a, json_each(a.split_line_ids) carved
      join lineage on carved.value = lineage.line_id
      where a.working_order_id = ${workingOrderId}
    )
    select coalesce(sum(percent_bp), 0) as total
    from adjustments
    where working_order_id = ${workingOrderId} and reason_id = ${reasonId}
      and line_id in (select line_id from lineage)`);
  return { priorReductionOnBill, priorPercentOnLineBp: percent.rows[0]!.total };
}
