import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, money, newId, nowIso, table, tenderRefunds, tsString } from "@waitron/db";
import { adjustments } from "./adjustments.js";

/** How much of one refund paid back one cancel. Declared `appendOnly()` in `../classification.ts`. */
export const adjustmentRefunds = table(
  "adjustment_refunds",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    adjustmentId: id("adjustment_id").notNull(),
    tenderRefundId: id("tender_refund_id").notNull(),
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
      columns: [t.tenderRefundId],
      foreignColumns: [tenderRefunds.id],
      name: "adjustment_refunds_tender_refund_fk",
    }).onDelete("restrict"),
    uniqueIndex("adjustment_refunds_adjustment_refund_key").on(t.adjustmentId, t.tenderRefundId),
    index("adjustment_refunds_tender_refund_idx").on(t.tenderRefundId),
    check("adjustment_refunds_amount_ck", sql`${t.amount} > 0`),
  ],
);
