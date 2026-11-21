import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, money, newId, nowIso, table, tsString } from "../columns.js";
import { refunds } from "../refunds.js";
import { adjustments } from "./adjustments.js";

/**
 * How much of one refund paid back one cancel. Declared `appendOnly()` in
 * `../../classification.ts`.
 */
export const adjustmentRefunds = table(
  "adjustment_refunds",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    adjustmentId: id("adjustment_id").notNull(),
    refundId: id("refund_id").notNull(),
    amount: money("amount").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.adjustmentId],
      foreignColumns: [adjustments.id],
      name: "adjustment_refunds_adjustment_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.refundId],
      foreignColumns: [refunds.id],
      name: "adjustment_refunds_refund_fk",
    }).onDelete("restrict"),
    uniqueIndex("adjustment_refunds_adjustment_refund_key").on(t.adjustmentId, t.refundId),
    index("adjustment_refunds_refund_idx").on(t.refundId),
    check("adjustment_refunds_amount_ck", sql`${t.amount} > 0`),
  ],
);
