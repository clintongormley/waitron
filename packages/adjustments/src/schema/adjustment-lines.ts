import { foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, money, newId, quantity, table } from "@waitron/db";
import { adjustments } from "./adjustments.js";

/**
 * What one comp or discount took off one working-order line, and the line's quantity then.
 * `line_id` has no key, as `adjustments.line_id` has none: a cancel deletes the line, and a key from
 * a row nothing may change would refuse that delete. Declared `appendOnly()` in
 * `../classification.ts`.
 */
export const adjustmentLines = table(
  "adjustment_lines",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    adjustmentId: id("adjustment_id").notNull(),
    lineId: id("line_id").notNull(),
    reduction: money("reduction").notNull(),
    quantity: quantity("quantity").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.adjustmentId],
      foreignColumns: [adjustments.id],
      name: "adjustment_lines_adjustment_fk",
    }).onDelete("restrict"),
    uniqueIndex("adjustment_lines_adjustment_line_key").on(t.adjustmentId, t.lineId),
    index("adjustment_lines_line_idx").on(t.lineId),
  ],
);
