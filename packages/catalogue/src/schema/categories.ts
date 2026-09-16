import { categories, products } from "@waitron/db";
import { foreignKey, index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";

export const categoryDetails = pgTable(
  "category_details",
  {
    categoryId: uuid("category_id").notNull(),
    parentId: uuid("parent_id"),
    image: text("image"),
    color: text("color"),
  },
  (t) => [
    primaryKey({ columns: [t.categoryId] }),
    foreignKey({
      columns: [t.categoryId],
      foreignColumns: [categories.id],
      name: "category_details_category_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [categories.id],
      name: "category_details_parent_fk",
    }).onDelete("restrict"),
    index("category_details_parent_idx").on(t.parentId),
  ],
);

export const productCategories = pgTable(
  "product_categories",
  {
    productId: uuid("product_id").notNull(),
    categoryId: uuid("category_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.categoryId] }),
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "product_categories_product_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.categoryId],
      foreignColumns: [categories.id],
      name: "product_categories_category_fk",
    }).onDelete("restrict"),
    index("product_categories_category_idx").on(t.categoryId),
  ],
);
