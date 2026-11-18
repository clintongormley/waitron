import { foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import { id, newId, table } from "./columns.js";
import { workingOrderLines } from "./orders.js";
import { saleLines } from "./sales.js";

/** Which dish lines a filed sale row stands for. */
export const saleLineDishes = table(
  "sale_line_dishes",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    saleLineId: id("sale_line_id").notNull(),
    dishLineId: id("dish_line_id").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.saleLineId],
      foreignColumns: [saleLines.id],
      name: "sale_line_dishes_sale_line_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.dishLineId],
      foreignColumns: [workingOrderLines.id],
      name: "sale_line_dishes_dish_line_fk",
    }).onDelete("restrict"),
    unique("sale_line_dishes_sale_line_dish_key").on(t.saleLineId, t.dishLineId),
    index("sale_line_dishes_dish_line_idx").on(t.dishLineId),
  ],
);
