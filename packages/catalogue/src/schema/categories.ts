import { foreignKey, index, primaryKey } from "drizzle-orm/sqlite-core";
import { categories, id, label, table } from "@waitron/db";

export const categoryDetails = table(
  "category_details",
  {
    categoryId: id("category_id").notNull(),
    parentId: id("parent_id"),
    image: label("image"),
    color: label("color"),
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
