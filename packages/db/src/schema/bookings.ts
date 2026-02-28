import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  pgEnum,
  text,
} from "drizzle-orm/pg-core";
import { locations } from "./locations";

export const bookingStatusEnum = pgEnum("booking_status", [
  "pending",
  "confirmed",
  "seated",
  "cancelled",
  "no_show",
]);

export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id, { onDelete: "cascade" }),
  customerName: varchar("customer_name", { length: 255 }).notNull(),
  customerEmail: varchar("customer_email", { length: 255 }),
  customerPhone: varchar("customer_phone", { length: 50 }),
  partySize: integer("party_size").notNull(),
  datetime: timestamp("datetime", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(90),
  status: bookingStatusEnum("status").notNull().default("pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
