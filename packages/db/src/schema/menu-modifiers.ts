import { pgTable, uuid, jsonb, integer, timestamp } from "drizzle-orm/pg-core";
import { menuItems } from "./menu-items";

export const menuModifiers = pgTable("menu_modifiers", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => menuItems.id, { onDelete: "cascade" }),
  name: jsonb("name").notNull().$type<Record<string, string>>(),
  priceCents: integer("price_cents").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
