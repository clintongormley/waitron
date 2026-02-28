import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { locations } from "./locations";

export const tableStatusEnum = pgEnum("table_status", [
  "available",
  "occupied",
  "reserved",
  "out_of_service",
]);

export const tables = pgTable("tables", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id, { onDelete: "cascade" }),
  number: varchar("number", { length: 20 }).notNull(),
  capacity: integer("capacity").notNull(),
  qrCodeId: uuid("qr_code_id").notNull().defaultRandom().unique(),
  status: tableStatusEnum("status").notNull().default("available"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
