import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import {
  centsToDecimal,
  decimalToCents,
  rawCentsToDecimal,
  stringToThousandths,
  type Decimal,
} from "@waitron/shared";
import { isFullComp } from "./full-comp.js";
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
  /** On a whole comp of a dish, its extras rows, which the comp priced at zero with it. */
  compedExtras?: readonly string[];
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
  chargeKept?: boolean;
  preparationStarted?: boolean | null;
  refundHandoff?: boolean;
  refundValue?: Decimal | null;
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
      compedExtras: [...(row.compedExtras ?? [])],
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
      chargeKept: row.chargeKept ?? false,
      preparationStarted: row.preparationStarted ?? null,
      refundHandoff: row.refundHandoff ?? false,
      refundValue: row.refundValue == null ? null : decimalToCents(row.refundValue),
    })
    .returning({ id: adjustments.id });
  return written!.id;
}

export interface ReasonTotals {
  priorReductionOnBill: Decimal;
}

/** This reason's earlier comps and discounts on the bill, bill-level discounts included. Its cancels
 * are left out: a reason changed from Void to Comp keeps its id. */
export async function readReasonTotals(
  tx: Transaction,
  query: { workingOrderId: string; reasonId: string },
): Promise<ReasonTotals> {
  const { workingOrderId, reasonId } = query;
  const reduction = await tx.execute<{ total: string }>(sql`
    select cast(coalesce(sum(reduction), 0) as text) as total
    from adjustments
    where working_order_id = ${workingOrderId} and reason_id = ${reasonId}
      and action <> 'cancel'`);
  return { priorReductionOnBill: rawCentsToDecimal(reduction.rows[0]!.total) };
}

/** A comp or discount still standing on a bill. `lineId` is null for one on the whole bill. */
export interface BillAdjustment {
  lineId: string | null;
  splits: AdjustmentSplit[];
  /** It covered less than the whole quantity of its line. */
  partOfLine: boolean;
  action: Exclude<AdjustmentAction, "cancel">;
  percentBp: number | null;
  reduction: Decimal;
  /**
   * Free, or an amount that took the whole list value of its item, or of the bill for a bill-wide
   * amount: it prints as 100%. A percentage
   * carries its own `percentBp`.
   */
  full: boolean;
}

/** This bill's comps and discounts, oldest first; its cancellations are not read. */
export async function readBillAdjustments(
  tx: Transaction,
  workingOrderId: string,
): Promise<BillAdjustment[]> {
  const rows = await tx
    .select({
      lineId: adjustments.lineId,
      splits: adjustments.splits,
      quantity: adjustments.quantity,
      lineQuantity: adjustments.lineQuantity,
      action: adjustments.action,
      percentBp: adjustments.percentBp,
      reduction: adjustments.reduction,
      beforeAmount: adjustments.beforeAmount,
      afterAmount: adjustments.afterAmount,
      nominalValue: adjustments.nominalValue,
    })
    .from(adjustments)
    .where(and(eq(adjustments.workingOrderId, workingOrderId), ne(adjustments.action, "cancel")))
    .orderBy(asc(adjustments.createdAt), asc(adjustments.id));
  return rows.map(
    ({
      quantity,
      lineQuantity,
      reduction,
      action,
      beforeAmount,
      afterAmount,
      nominalValue,
      ...row
    }) => ({
      ...row,
      // The query leaves cancellations out.
      action: action as BillAdjustment["action"],
      // A line row holds both counts (`adjustments_line_level_ck`).
      partOfLine: row.lineId !== null && quantity! < lineQuantity!,
      reduction: centsToDecimal(reduction),
      full: isFullComp({
        action,
        beforeAmount: centsToDecimal(beforeAmount),
        afterAmount: centsToDecimal(afterAmount),
        nominalValue: centsToDecimal(nominalValue),
      }),
    }),
  );
}
