import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumCheck, enumType, id, label, newId, nowIso, table, tsString } from "../columns.js";
import { workingOrders } from "../orders.js";
import { adjustments } from "./adjustments.js";

export const adjustmentEndingWhy = enumType([
  "extras_changed",
  "variant_changed",
  "dish_cancelled",
  "dish_moved",
  "dish_paid_alone",
  "replaced",
  "set_menu_cancelled",
]);

export type AdjustmentEndingWhy = (typeof adjustmentEndingWhy.enumValues)[number];

/**
 * A comp or discount that came off the rows it covered on one bill: the bill its rows were on when
 * it ended, which after a move need not be the bill it was given on. Declared `appendOnly()` in
 * `../../classification.ts`.
 */
export const adjustmentEndings = table(
  "adjustment_endings",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    adjustmentId: id("adjustment_id").notNull(),
    workingOrderId: id("working_order_id").notNull(),
    why: adjustmentEndingWhy("why").notNull(),
    dishName: label("dish_name").notNull(),
    // No key, for the reason `adjustment_lines.line_id` has none (./adjustment-lines.ts).
    lineId: id("line_id"),
    endedAt: tsString("ended_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.adjustmentId],
      foreignColumns: [adjustments.id],
      name: "adjustment_endings_adjustment_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "adjustment_endings_working_order_fk",
    }).onDelete("restrict"),
    uniqueIndex("adjustment_endings_adjustment_order_key").on(t.adjustmentId, t.workingOrderId),
    check("adjustment_endings_why_ck", enumCheck(t.why)),
    check(
      "adjustment_endings_line_ck",
      sql`${t.lineId} is null or ${t.why} in ('extras_changed', 'variant_changed')`,
    ),
  ],
);
