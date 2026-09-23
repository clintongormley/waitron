import { sql } from "drizzle-orm";
import { check, foreignKey, unique } from "drizzle-orm/sqlite-core";
import { count, flag, id, json, label, money, newId, products, table } from "@waitron/db";

export const productVariants = table(
  "product_variants",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    productId: id("product_id").notNull(),
    // Staff-facing variant name — plain text, like the product's own name.
    name: label("name").notNull(),
    // Customer-facing translated name; null or a blank entry means "use `name`".
    customerName: json<Record<string, string>>("customer_name"),
    // Optional kitchen-ticket name for the variant.
    kitchenName: label("kitchen_name"),
    // Path reference to the variant photo — a content-addressed filename, the same plain-text shape
    // as products.image. There is no media FK: deletion protection is the application-level usage
    // scan in packages/media/src/images.ts, which covers this column. Null = no picture.
    image: label("image"),
    unitPrice: money("unit_price").notNull(),
    available: flag("available").notNull().default(true),
    displayOrder: count("display_order").notNull().default(0),
  },
  (t) => [
    unique("product_variants_product_id_key").on(t.productId, t.id),
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "product_variants_product_fk",
    }).onDelete("restrict"),
    check("product_variants_price_ck", sql`${t.unitPrice} >= 0`),
  ],
);
