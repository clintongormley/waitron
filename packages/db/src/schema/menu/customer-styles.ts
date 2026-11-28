import type { CustomerMenuAppearance } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { flag, id, json, jsonShapeCheck, label, newId, now, table, ts } from "../columns.js";
import { mediaImages } from "../media/images.js";

export const customerMenuStyles = table(
  "customer_menu_styles",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    nameKey: label("name_key").notNull(),
    isDefault: flag("is_default").notNull().default(false),
    appearance: json<CustomerMenuAppearance>("appearance").notNull(),
    logoImage: label("logo_image").references(() => mediaImages.filename, { onDelete: "restrict" }),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("customer_menu_styles_name_key_uq").on(t.nameKey),
    uniqueIndex("customer_menu_styles_one_default_uq")
      .on(t.isDefault)
      .where(sql`${t.isDefault} = 1`),
    check("customer_menu_styles_appearance_ck", jsonShapeCheck(t.appearance, "object")),
  ],
);
