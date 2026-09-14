import { categories, products } from "@waitron/db";
import { foreignKey, index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";

export const categoryDetails = pgTable(
  "category_details",
  {
    tenantId: uuid("tenant_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    parentId: uuid("parent_id"),
    image: text("image"),
    color: text("color"),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.categoryId] }),
    foreignKey({
      columns: [t.tenantId, t.categoryId],
      foreignColumns: [categories.tenantId, categories.id],
      name: "category_details_category_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.parentId],
      foreignColumns: [categories.tenantId, categories.id],
      name: "category_details_parent_fk",
    }).onDelete("restrict"),
    index("category_details_parent_idx").on(t.tenantId, t.parentId),
  ],
);

export const productCategories = pgTable(
  "product_categories",
  {
    tenantId: uuid("tenant_id").notNull(),
    productId: uuid("product_id").notNull(),
    categoryId: uuid("category_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.productId, t.categoryId] }),
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "product_categories_product_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.categoryId],
      foreignColumns: [categories.tenantId, categories.id],
      name: "product_categories_category_fk",
    }).onDelete("restrict"),
    index("product_categories_category_idx").on(t.tenantId, t.categoryId),
  ],
);
