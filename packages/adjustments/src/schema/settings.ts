import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { count, nowIso, rate, table, tsString } from "@waitron/db";

/**
 * The venue's adjustment settings, at most one row. `max_bill_discount` caps, in basis points of
 * the bill's price before adjustments, what every discount on one bill takes off together before a
 * manager must approve; null, or no row, sets no cap.
 */
export const adjustmentSettings = table(
  "adjustment_settings",
  {
    id: count("id").primaryKey().notNull().default(1),
    maxBillDiscount: rate("max_bill_discount"),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    check("adjustment_settings_singleton_ck", sql`${t.id} = 1`),
    check(
      "adjustment_settings_max_bill_discount_ck",
      sql`${t.maxBillDiscount} is null or ${t.maxBillDiscount} between 1 and 10000`,
    ),
  ],
);
