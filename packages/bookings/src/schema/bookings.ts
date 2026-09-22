import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
// The FK targets are core tables — this module's schema points INTO core (a clean leaf), so they
// import from @waitron/db rather than a sibling file.
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
 * The lifecycle of a staff-entered reservation (design §1). `booked` on creation; `seated` when the
 * party arrives and a tab is opened (TS-1 `openTab`); then a terminal `completed` / `no_show` /
 * `cancelled`. There is no hard-delete — a booking is CANCELLED, never removed — so every
 * reservation stays auditable. The grant that used to refuse a DELETE outright went with the
 * PostgreSQL engine; nothing in the database enforces this now, only the verbs in `bookings.ts`.
 */
export const bookingStatus = enumType(["booked", "seated", "completed", "no_show", "cancelled"]);

/**
 * WALL-CLOCK, NOT AN INSTANT (design §2b, the #52 lesson): a booking is a future intention
 * ("Tuesday 20:00 at the venue"), not a moment that has occurred, so `booking_date` is a calendar day
 * and `booking_time` a time of day — the `day` and `timeOfDay` helpers — both venue-local, never a
 * UTC instant. Neither helper is a dedicated engine type here (both emit `text`), so neither
 * normalises nor refuses what it is handed: `storedTime` in `../bookings.ts` chooses the one stored
 * spelling of a time, and `routes.ts`'s `TIME_HHMM` is what refuses a malformed one. There is no instant to misrender, so this cannot repeat #52; the one place "now"
 * matters (the reserved-on-floor imminence read, FP-1) computes the venue wall-clock from
 * `locations.time_zone` at read time.
 *
 * `table_id` (optional table assignment) and `tab_id` (set on seat) point INTO core — table_id →
 * dining_tables(id), tab_id → working_orders(id) — and both keys are declared below. Both columns
 * are nullable, and a null satisfies its key.
 *
 * `created_by` is the identity person who took the booking — a plain uuid with NO FK, the same
 * `drawer_opens.person_id` / `daily_closes.closed_by` / `sales.operator_id` seam: the person/identity
 * schema is a separate slice (migrates AFTER `core`), so this table records the actor without
 * depending on it (packages/db must not import @waitron/identity — it would close a load-time cycle).
 */
export const bookings = table(
  "bookings",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    /** The workplace the reservation is for. */
    locationId: id("location_id").notNull(),
    // Venue-local wall-clock date + time (§2b) — `day`/`timeOfDay`, a plain `date` and a plain
    // `time`, NOT an instant.
    bookingDate: day("booking_date").notNull(),
    bookingTime: timeOfDay("booking_time").notNull(),
    // Covers expected. CHECK > 0 below — a zero/negative party is malformed.
    partySize: count("party_size").notNull(),
    contactName: label("contact_name").notNull(),
    // Free-text contact (design §0) — no customer/CRM entity exists. Both nullable.
    contactPhone: label("contact_phone"),
    notes: label("notes"),
    // Optional table assignment (TS-1). Its key to dining_tables is declared below and is
    // satisfied while the column is null.
    tableId: id("table_id"),
    // Set on seat: the tab opened for the arriving party (TS-1). Its key to working_orders is
    // declared below and is satisfied while the column is null.
    tabId: id("tab_id"),
    status: bookingStatus("status").notNull().default("booked"),
    // The identity person who took the booking. Plain uuid, NO FK — the drawer_opens.person_id seam.
    createdBy: id("created_by").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => …)`, for the coverage reason
    // shifts.ts documents (no uncovered arrow function). restrict — a booking must never orphan its
    // location.
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "bookings_location_fk",
    }).onDelete("restrict"),
    // Both point at the parent's primary key, and both columns are nullable, so an unassigned
    // booking and an unseated one each satisfy their key.
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
    // The day-list scan: the location's bookings for a given date.
    index("bookings_location_date_idx").on(t.locationId, t.bookingDate),
    // The reserved-on-floor read filters on (table_id, status, booking_date) then orders/ranges on
    // booking_time — matched left to right by this index. Without it the read re-scans the whole day's
    // bookings (bookings_location_date_idx has no table_id prefix), O(tables × bookings-that-day).
    index("bookings_table_status_date_time_idx").on(
      t.tableId,
      t.status,
      t.bookingDate,
      t.bookingTime,
    ),
    // A party of zero or fewer is malformed.
    check("bookings_party_size_ck", sql`${t.partySize} > 0`),
    check("bookings_status_ck", enumCheck(t.status)),
  ],
);
