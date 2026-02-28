import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { locations } from "./locations";
import { tables } from "./tables";

export const orderTypeEnum = pgEnum("order_type", ["dine_in", "takeaway"]);

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "served",
  "paid",
]);

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id, { onDelete: "cascade" }),
  tableId: uuid("table_id").references(() => tables.id, {
    onDelete: "set null",
  }),
  type: orderTypeEnum("type").notNull(),
  status: orderStatusEnum("status").notNull().default("pending"),
  customerName: varchar("customer_name", { length: 255 }),
  totalCents: integer("total_cents").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
