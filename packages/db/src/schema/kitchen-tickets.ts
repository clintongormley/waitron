import { pgTable, uuid, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { orders } from "./orders";
import { kitchenStations } from "./kitchen-stations";

export const ticketStatusEnum = pgEnum("ticket_status", [
  "pending",
  "in_progress",
  "ready",
  "bumped",
]);

export const kitchenTickets = pgTable("kitchen_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  stationId: uuid("station_id")
    .notNull()
    .references(() => kitchenStations.id, { onDelete: "cascade" }),
  status: ticketStatusEnum("status").notNull().default("pending"),
  priority: integer("priority").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
