import {
  pgTable,
  uuid,
  jsonb,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { menuCategories } from "./menu-categories";

export const menuItems = pgTable("menu_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => menuCategories.id, { onDelete: "cascade" }),
  name: jsonb("name").notNull().$type<Record<string, string>>(),
  description: jsonb("description").$type<Record<string, string>>(),
  priceCents: integer("price_cents").notNull(),
  available: boolean("available").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
