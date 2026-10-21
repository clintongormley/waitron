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

/** {@link readReasonItemShares}'s answer: each line's own share, and the whole bill's apart. */
export interface ReasonItemShares {
  lines: Map<string, number>;
  /** What this reason's rows on the whole bill took off the bill in all, in cents. */
  billReduction: number;
}

/**
 * The basis points this reason has already taken off each of `lineIds`, in one statement: each of
 * its rows adds `ceil(reduction × 10000 ÷ nominal_value)`, or 0 where the list value is 0. A row
 * counts on its own line and on every row split off that line by an adjustment on this bill, a bill
 * discount included, at any remove — including rows taken after the split, which err toward asking.
 * A row that covered part of its line counts only on the rows it carved off and theirs, not on the
 * rest of the line. The reason's rows on the whole bill are answered apart, as `billReduction`. A
 * split made by anything other than an adjustment is not recorded here, so a row split that way
 * starts with none. The reason's cancels count nowhere, as in {@link readReasonTotals}.
 */
export async function readReasonItemShares(
  tx: Transaction,
  query: { workingOrderId: string; reasonId: string; lineIds: readonly string[] },
): Promise<ReasonItemShares> {
  const { workingOrderId, reasonId, lineIds } = query;
  const seeds = JSON.stringify(lineIds);
  const taken = await tx.execute<{ seed: string | null; reduction: number; nominal: number }>(sql`
    with recursive lineage(seed, line_id) as (
      select value, value from json_each(${seeds})
      union
      select lineage.seed, json_extract(split.value, '$.from')
      from adjustments a, json_each(a.splits) split
      join lineage on json_extract(split.value, '$.to') = lineage.line_id
      where a.working_order_id = ${workingOrderId}
    )
    select lineage.seed as seed, row.reduction as reduction, row.nominal_value as nominal
    from lineage
    join adjustments row on row.line_id = lineage.line_id
      and row.working_order_id = ${workingOrderId} and row.reason_id = ${reasonId}
      and row.action <> 'cancel'
    where row.quantity = row.line_quantity or exists (
      select 1 from json_each(row.splits) carve
      join lineage carved on carved.seed = lineage.seed
        and carved.line_id = json_extract(carve.value, '$.to'))
    union all
    select null, row.reduction, row.nominal_value
    from adjustments row
    where row.line_id is null
      and row.working_order_id = ${workingOrderId} and row.reason_id = ${reasonId}`);
  const lines = new Map(lineIds.map((lineId) => [lineId, 0]));
  let billReduction = 0;
  for (const { seed, reduction, nominal } of taken.rows) {
    if (seed === null) billReduction += reduction;
    else lines.set(seed, lines.get(seed)! + shareBp(reduction, nominal));
  }
  return { lines, billReduction };
}

/** A comp or discount of a whole line that split no row off it: its quantity, list value and
 * reduction then, in thousandths and cents. */
export type WholeLineReduction = {
  lineId: string;
  lineQuantity: number;
  nominal: number;
  reduction: number;
};

/** The comps and discounts of any reason on each of `lineIds` that covered the whole line and
 * split no row off it. */
export async function readWholeLineReductions(
  tx: Transaction,
  query: { workingOrderId: string; lineIds: readonly string[] },
): Promise<WholeLineReduction[]> {
  const { workingOrderId, lineIds } = query;
  const found = await tx.execute<WholeLineReduction>(sql`
    select line_id as lineId, line_quantity as lineQuantity, nominal_value as nominal, reduction
    from adjustments
    where working_order_id = ${workingOrderId}
      and line_id in (select value from json_each(${JSON.stringify(lineIds)}))
      and action <> 'cancel' and quantity = line_quantity and json_array_length(splits) = 0`);
  return found.rows;
}

/** `ceil(reduction × 10000 ÷ nominal)` in exact integers; 0 where `nominal` is 0. */
export function shareBp(reduction: number, nominal: number): number {
  if (nominal === 0) return 0;
  const scaled = BigInt(reduction) * 10000n;
  const divisor = BigInt(nominal);
  return Number((scaled + divisor - 1n) / divisor);
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
