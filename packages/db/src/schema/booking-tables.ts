import { pgTable, uuid, primaryKey } from "drizzle-orm/pg-core";
import { bookings } from "./bookings";
import { tables } from "./tables";

export const bookingTables = pgTable(
  "booking_tables",
  {
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.bookingId, t.tableId] })],
);
