import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import {
  centsToDecimal,
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

/** What a reason has already taken, in the shape `evaluateAdjustment` asks for its priors. */
export interface ReasonTotals {
  priorReductionOnBill: Decimal;
  priorPercentOnLineBp: number;
}

/**
 * This reason's earlier reductions on the bill, bill-level discounts included, and its earlier
 * percentage discounts on `lineId` ({@link readLinePercents}). `lineId` null asks for a bill-level
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
  const percents = await readLinePercents(tx, { workingOrderId, reasonId, lineIds: [lineId] });
  return { priorReductionOnBill, priorPercentOnLineBp: percents.get(lineId)! };
}

/**
 * This reason's earlier percentage discounts on each of `lineIds`, in one statement. A row split off
 * another by an adjustment on this bill, a bill discount included, also counts the percentages
 * taken off the row it came from, at any remove — including ones taken after the split, which err
 * toward refusing. A split made by anything other than an adjustment is not recorded here, so a row
 * split that way starts with none.
 */
export async function readLinePercents(
  tx: Transaction,
  query: { workingOrderId: string; reasonId: string; lineIds: readonly string[] },
): Promise<Map<string, number>> {
  const { workingOrderId, reasonId, lineIds } = query;
  // `percent_bp` is null on every action but `discount_percent` (`adjustments_percent_ck`).
  const percent = await tx.execute<{ seed: string; total: number }>(sql`
    with recursive lineage(seed, line_id) as (
      select value, value from json_each(${JSON.stringify(lineIds)})
      union
      select lineage.seed, json_extract(split.value, '$.from')
      from adjustments a, json_each(a.splits) split
      join lineage on json_extract(split.value, '$.to') = lineage.line_id
      where a.working_order_id = ${workingOrderId}
    )
    select lineage.seed as seed, coalesce(sum(taken.percent_bp), 0) as total
    from lineage
    left join adjustments taken on taken.line_id = lineage.line_id
      and taken.working_order_id = ${workingOrderId} and taken.reason_id = ${reasonId}
    group by lineage.seed`);
  return new Map(percent.rows.map((row) => [row.seed, row.total]));
}

/** The rows a bill's own comps priced at zero. `rows`: the rows each part comp split off (a dish
 * and its extras) and the extras rows a whole comp of a dish priced with it; `dishes`: the line of
 * each whole comp. Each also names the copies later adjustments on the bill split off those rows,
 * at any remove. */
export interface CompedLines {
  rows: string[];
  dishes: string[];
}

/** The rows this bill's adjustments prove comped; a comp recorded on another bill is not read. */
export async function readCompedLines(
  tx: Transaction,
  workingOrderId: string,
): Promise<CompedLines> {
  // In the order they were written: a copy split off a row before the row was comped keeps the
  // price it had.
  const written = await tx
    .select({
      lineId: adjustments.lineId,
      splits: adjustments.splits,
      compedExtras: adjustments.compedExtras,
      action: adjustments.action,
    })
    .from(adjustments)
    .where(eq(adjustments.workingOrderId, workingOrderId))
    .orderBy(sql`rowid`);
  const rows = new Set<string>();
  const dishes = new Set<string>();
  for (const { lineId, splits, compedExtras, action } of written) {
    if (action === "comp" && splits.length === 0) dishes.add(lineId!);
    for (const extra of compedExtras) rows.add(extra);
    for (const { from, to } of splits) {
      if (action === "comp" || rows.has(from)) rows.add(to);
      if (dishes.has(from)) dishes.add(to);
    }
  }
  return { rows: [...rows], dishes: [...dishes] };
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
    })
    .from(adjustments)
    .where(and(eq(adjustments.workingOrderId, workingOrderId), ne(adjustments.action, "cancel")))
    .orderBy(asc(adjustments.createdAt), asc(adjustments.id));
  return rows.map(({ quantity, lineQuantity, reduction, action, ...row }) => ({
    ...row,
    // The query leaves cancellations out.
    action: action as BillAdjustment["action"],
    // A line row holds both counts (`adjustments_line_level_ck`).
    partOfLine: row.lineId !== null && quantity! < lineQuantity!,
    reduction: centsToDecimal(reduction),
  }));
}
