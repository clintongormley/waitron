import { foreignKey, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, label, newId, now, products, table, ts } from "@waitron/db";

/** A flat tag a product may carry any number of ("Alcoholic", "Happy hour drinks"). Independent of
 * the reporting category tree: a label never implies a category, nor a category a label. The name is
 * staff-facing plain text, not translated. */
export const labels = table(
  "labels",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    createdAt: ts("created_at").notNull().$defaultFn(now),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("labels_name_uq").on(t.name)],
);

/** Which labels a product carries. A variant stores none: it reads its parent's. */
export const productLabels = table(
  "product_labels",
  {
    productId: id("product_id").notNull(),
    labelId: id("label_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.labelId] }),
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "product_labels_product_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.labelId],
      foreignColumns: [labels.id],
      name: "product_labels_label_fk",
    }).onDelete("cascade"),
    index("product_labels_label_idx").on(t.labelId),
  ],
);
