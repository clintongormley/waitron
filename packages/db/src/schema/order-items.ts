import { pgTable, uuid, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { orders } from "./orders";
import { menuItems } from "./menu-items";

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  menuItemId: uuid("menu_item_id")
    .notNull()
    .references(() => menuItems.id, { onDelete: "restrict" }),
  modifierIds: jsonb("modifier_ids").$type<string[]>().notNull().default([]),
  quantity: integer("quantity").notNull().default(1),
  unitPriceCents: integer("unit_price_cents").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
