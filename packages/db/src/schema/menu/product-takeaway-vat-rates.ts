import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { products } from "../menus.js";
import { day, id, newId, rate, table } from "../columns.js";

/** A product's takeaway VAT rate from `starts_on` (null: from the beginning of time) on. */
export const productTakeawayVatRates = table(
  "product_takeaway_vat_rates",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    productId: id("product_id").notNull(),
    startsOn: day("starts_on"),
    rate: rate("rate").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "product_takeaway_vat_rates_product_fk",
    }).onDelete("cascade"),
    uniqueIndex("product_takeaway_vat_rates_product_day_key").on(t.productId, t.startsOn),
    // SQLite counts two nulls as distinct, so the day key alone admits two first rows.
    uniqueIndex("product_takeaway_vat_rates_product_first_key")
      .on(t.productId)
      .where(sql`${t.startsOn} is null`),
    check("product_takeaway_vat_rates_rate_ck", sql`${t.rate} between 0 and 10000`),
    check(
      "product_takeaway_vat_rates_starts_on_ck",
      sql`length(${t.startsOn}) = 10 and ${t.startsOn} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
  ],
);
