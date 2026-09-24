import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import {
  count,
  day,
  diningTables,
  enumCheck,
  enumType,
  id,
  label,
  locations,
  newId,
  nowIso,
  table,
  timeOfDay,
  tsString,
  workingOrders,
} from "@waitron/db";

/**
 * `booked` on creation; `seated` when a tab is opened; then terminal `completed` / `no_show` /
 * `cancelled`. A booking is cancelled, never deleted — but nothing in the database refuses a
 * delete; this module simply has no delete verb.
 */
export const bookingStatus = enumType(["booked", "seated", "completed", "no_show", "cancelled"]);

/**
 * A booking is a future wall-clock intention (design §2b), so `booking_date` and `booking_time` are
 * venue-local, never a UTC instant. Both are plain text that refuses nothing: `storedTime` in
 * `../bookings.ts` picks the one stored spelling of a time, and `routes.ts`'s `TIME_HHMM` refuses a
 * malformed one.
 */
export const bookings = table(
  "bookings",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    bookingDate: day("booking_date").notNull(),
    bookingTime: timeOfDay("booking_time").notNull(),
    partySize: count("party_size").notNull(),
    contactName: label("contact_name").notNull(),
    // Free text: there is no customer entity.
    contactPhone: label("contact_phone"),
    notes: label("notes"),
    tableId: id("table_id"),
    // Set on seat.
    tabId: id("tab_id"),
    status: bookingStatus("status").notNull().default("booked"),
    // No key: `persons` is identity's table, outside the `core` set this module requires. The route
    // stamps it from `authorizeManager`, whose session lookup joins `persons`.
    createdBy: id("created_by").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "bookings_location_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tableId],
      foreignColumns: [diningTables.id],
      name: "bookings_table_fk",
    }),
    foreignKey({
      columns: [t.tabId],
      foreignColumns: [workingOrders.id],
      name: "bookings_tab_fk",
    }),
    index("bookings_location_date_idx").on(t.locationId, t.bookingDate),
    // `../floor.ts`'s reserved-on-floor read filters on the first three and ranges on the time.
    index("bookings_table_status_date_time_idx").on(
      t.tableId,
      t.status,
      t.bookingDate,
      t.bookingTime,
    ),
    check("bookings_party_size_ck", sql`${t.partySize} > 0`),
    check("bookings_status_ck", enumCheck(t.status)),
  ],
);
