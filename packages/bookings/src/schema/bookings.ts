import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgEnum } from "drizzle-orm/pg-core";
// The FK targets are core tables — this module's schema points INTO core (a clean leaf), so they
// import from @waitron/db rather than a sibling file.
import { count, day, id, label, locations, table, timeOfDay, tsString } from "@waitron/db";

/**
 * The lifecycle of a staff-entered reservation (design §1). `booked` on creation; `seated` when the
 * party arrives and a tab is opened (TS-1 `openTab`); then a terminal `completed` / `no_show` /
 * `cancelled`. There is no hard-delete — a booking is CANCELLED, never removed (hence app_user holds
 * no DELETE, see the custom migration) — so every reservation stays auditable.
 */
export const bookingStatus = pgEnum("booking_status", [
  "booked",
  "seated",
  "completed",
  "no_show",
  "cancelled",
]);

/**
 * WALL-CLOCK, NOT AN INSTANT (design §2b, the #52 lesson): a booking is a future intention
 * ("Tuesday 20:00 at the venue"), not a moment that has occurred, so `booking_date` is a plain `date`
 * and `booking_time` a plain `time` — the `day` and `timeOfDay` helpers — both venue-local, never a
 * UTC instant. There is no instant to misrender, so this cannot repeat #52; the one place "now"
 * matters (the reserved-on-floor imminence read, FP-1) computes the venue wall-clock from
 * `locations.time_zone` at read time.
 *
 * `table_id` (optional table assignment) and `tab_id` (set on seat) are BARE uuid columns: their FKs,
 * table_id → dining_tables(id) and tab_id → working_orders(id), are hand-written in the custom
 * migrations rather than declared here.
 *
 * `created_by` is the identity person who took the booking — a plain uuid with NO FK, the same
 * `drawer_opens.person_id` / `daily_closes.closed_by` / `sales.operator_id` seam: the person/identity
 * schema is a separate slice (migrates AFTER `core`), so this table records the actor without
 * depending on it (packages/db must not import @waitron/identity — it would close a load-time cycle).
 */
export const bookings = table(
  "bookings",
  {
    id: id("id").primaryKey().defaultRandom(),
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
    // Optional table assignment (TS-1). BARE column — its FK to dining_tables is hand-written in the
    // custom migration, and skips the check while NULL.
    tableId: id("table_id"),
    // Set on seat: the tab opened for the arriving party (TS-1). BARE column — its FK to
    // working_orders is hand-written in the custom migration.
    tabId: id("tab_id"),
    status: bookingStatus("status").notNull().default("booked"),
    // The identity person who took the booking. Plain uuid, NO FK — the drawer_opens.person_id seam.
    createdBy: id("created_by").notNull(),
    createdAt: tsString("created_at").notNull().defaultNow(),
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
  ],
);
