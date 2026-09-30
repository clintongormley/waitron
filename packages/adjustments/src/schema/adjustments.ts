import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import {
  enumCheck,
  enumType,
  flag,
  id,
  json,
  label,
  money,
  newId,
  nowIso,
  quantity,
  rate,
  table,
  tsString,
  workingOrders,
} from "@waitron/db";
import { ADJUSTMENT_ACTIONS, type AdjustmentPolicySnapshot } from "../policy.js";

const adjustmentAction = enumType(ADJUSTMENT_ACTIONS);

/** How far the adjusted line had got when the adjustment was made. */
export const adjustmentStage = enumType(["unsent", "held", "fired", "served"]);

export type AdjustmentStage = (typeof adjustmentStage.enumValues)[number];

/** A row an adjustment split off `from` as the new row `to`. */
export interface AdjustmentSplit {
  from: string;
  to: string;
}

/**
 * One cancellation, comp or discount taken off a bill, with the line and the reason copied as they
 * were. Declared `appendOnly()` in `../classification.ts`. A row with no `line_id` is a discount on
 * the whole bill.
 */
export const adjustments = table(
  "adjustments",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    workingOrderId: id("working_order_id").notNull(),
    // No foreign key: a cancel deletes the line, and a key from a row nothing may change would
    // refuse that delete.
    lineId: id("line_id"),
    /** Each row this adjustment split off, with the row it came from; `readReasonTotals` follows
     * them back. A bill discount records its splits too. */
    splits: json<AdjustmentSplit[]>("splits").notNull(),
    lineName: label("line_name"),
    lineQuantity: quantity("line_quantity"),
    /** The line's unit price before any adjustment touched it. */
    lineListUnitPrice: money("line_list_unit_price"),
    // No foreign key: `persons` is in @waitron/identity's migration set, which this set does not
    // require. The same holds for `requested_by` and `approved_by`.
    creditedTo: id("credited_to"),
    // No foreign key: the configuration import deletes every reason; `reason_name` and
    // `policy_snapshot` keep the history, and this id only groups rows.
    reasonId: id("reason_id").notNull(),
    reasonName: label("reason_name").notNull(),
    policySnapshot: json<AdjustmentPolicySnapshot>("policy_snapshot").notNull(),
    action: adjustmentAction("action").notNull(),
    /** How much of the line the adjustment covered. */
    quantity: quantity("quantity"),
    percentBp: rate("percent_bp"),
    /** What the adjustment applied to, before and after it. */
    beforeAmount: money("before_amount").notNull(),
    afterAmount: money("after_amount").notNull(),
    reduction: money("reduction").notNull(),
    /** The list value of what was adjusted, which reports keep apart from the reduction. */
    nominalValue: money("nominal_value").notNull(),
    requestedBy: id("requested_by").notNull(),
    approvedBy: id("approved_by"),
    note: label("note"),
    stage: adjustmentStage("stage"),
    byGuest: flag("by_guest").notNull().default(false),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "adjustments_working_order_fk",
    }).onDelete("restrict"),
    index("adjustments_order_reason_idx").on(t.workingOrderId, t.reasonId),
    check("adjustments_action_ck", enumCheck(t.action)),
    check("adjustments_stage_ck", enumCheck(t.stage)),
    check("adjustments_reason_name_ck", sql`length(trim(${t.reasonName})) > 0`),
    check(
      "adjustments_amounts_ck",
      sql`${t.afterAmount} >= 0 and ${t.afterAmount} <= ${t.beforeAmount}
          and ${t.reduction} = ${t.beforeAmount} - ${t.afterAmount} and ${t.nominalValue} >= 0`,
    ),
    check(
      "adjustments_percent_ck",
      sql`(${t.action} = 'discount_percent') = (${t.percentBp} is not null)
          and (${t.percentBp} is null or ${t.percentBp} between 1 and 10000)`,
    ),
    // Each term says `is not null` itself: a check whose expression is null passes.
    check(
      "adjustments_line_level_ck",
      sql`${t.lineId} is null or (${t.lineName} is not null and ${t.stage} is not null
          and ${t.lineQuantity} is not null and ${t.lineQuantity} > 0
          and ${t.lineListUnitPrice} is not null and ${t.lineListUnitPrice} >= 0
          and ${t.quantity} is not null and ${t.quantity} > 0
          and ${t.quantity} <= ${t.lineQuantity})`,
    ),
    check(
      "adjustments_bill_level_ck",
      sql`${t.lineId} is not null or (${t.lineName} is null and ${t.lineQuantity} is null
          and ${t.lineListUnitPrice} is null and ${t.creditedTo} is null and ${t.quantity} is null
          and ${t.stage} is null and ${t.action} in ('discount_percent', 'discount_amount'))`,
    ),
  ],
);
