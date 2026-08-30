import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { locations, tenants } from "./tenants.js";

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
 * A staff-entered table reservation — tenant + location scoped, following the built `shifts` shape
 * (separate `tenant_id` + `location_id` FKs, `onDelete restrict`, tenant-consistency via RLS —
 * shifts.ts:38-41,60-74), which needs no change to `locations` (design §2a).
 *
 * WALL-CLOCK, NOT AN INSTANT (design §2b, the #52 lesson): a booking is a future intention
 * ("Tuesday 20:00 at the venue"), not a moment that has occurred, so `booking_date` is a plain `date`
 * and `booking_time` a plain `time`, both venue-local — never a UTC instant. There is no instant to
 * misrender, so this cannot repeat #52; the one place "now" matters (the reserved-on-floor imminence
 * read, FP-1) computes the venue wall-clock from `locations.time_zone` at read time.
 *
 * `table_id` (optional table assignment) and `tab_id` (set on seat) are BARE uuid columns: their
 * tenant-consistent COMPOSITE FKs — (tenant_id, table_id) → dining_tables(tenant_id, id) and
 * (tenant_id, tab_id) → working_orders(tenant_id, id) — are hand-written in the paired --custom
 * migration, because drizzle-kit models no composite FK and those targets are TS-1 tables.
 *
 * `created_by` is the identity person who took the booking — a plain uuid with NO FK, the same
 * `drawer_opens.person_id` / `daily_closes.closed_by` / `sales.operator_id` seam: the person/identity
 * schema is a separate slice (migrates AFTER `core`), so this table records the actor without
 * depending on it (packages/db must not import @waitron/identity — it would close a load-time cycle).
 *
 * `.enableRLS()` emits only ENABLE ROW LEVEL SECURITY; the FORCE ROW LEVEL SECURITY, the
 * `bookings_tenant_isolation` policy and the SELECT/INSERT/UPDATE grant (no DELETE) are hand-written in
 * the custom migration, exactly as 0074 does for `location_catalogues`. The `inmutabilidad` guard in
 * packages/fiscal-verifactu scans every tenant_id-bearing table for FORCE, so a missing FORCE here
 * fails that suite.
 */
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    /** The centro de trabajo the reservation is for. */
    locationId: uuid("location_id").notNull(),
    // Venue-local wall-clock date + time (§2b) — plain `date`/`time`, NOT an instant.
    bookingDate: date("booking_date").notNull(),
    bookingTime: time("booking_time").notNull(),
    // Covers expected. CHECK > 0 below — a zero/negative party is malformed.
    partySize: integer("party_size").notNull(),
    contactName: text("contact_name").notNull(),
    // Free-text contact (design §0) — no customer/CRM entity exists. Both nullable.
    contactPhone: text("contact_phone"),
    notes: text("notes"),
    // Optional table assignment (TS-1). BARE column — its (tenant_id, table_id) → dining_tables
    // composite FK is hand-written in the custom migration. MATCH SIMPLE skips the check while NULL.
    tableId: uuid("table_id"),
    // Set on seat: the tab opened for the arriving party (TS-1). BARE column — its
    // (tenant_id, tab_id) → working_orders composite FK is hand-written in the custom migration.
    tabId: uuid("tab_id"),
    status: bookingStatus("status").notNull().default("booked"),
    // The identity person who took the booking. Plain uuid, NO FK — the drawer_opens.person_id seam.
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => …)`, for the coverage reason
    // shifts.ts documents (no uncovered arrow function). restrict — a booking must never orphan its
    // tenant or location.
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "bookings_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "bookings_location_fk",
    }).onDelete("restrict"),
    // Composite (tenant_id, id) UNIQUE — the house pattern for a composite-FK target (a later slice
    // may point a tenant-consistent FK at a booking).
    unique("bookings_tenant_id_key").on(t.tenantId, t.id),
    // The day-list scan: the location's bookings for a given date.
    index("bookings_tenant_location_date_idx").on(t.tenantId, t.locationId, t.bookingDate),
    // The reserved-on-floor lateral join (working-order.ts nextReservation) filters on
    // (tenant_id, table_id, status, booking_date) then orders/ranges on booking_time — matched left to
    // right by this index. Without it that per-table subquery re-scans the whole day's bookings
    // (bookings_tenant_location_date_idx has no table_id prefix), O(tables × bookings-that-day).
    index("bookings_tenant_table_status_date_time_idx").on(
      t.tenantId,
      t.tableId,
      t.status,
      t.bookingDate,
      t.bookingTime,
    ),
    // A party of zero or fewer is malformed.
    check("bookings_party_size_ck", sql`${t.partySize} > 0`),
  ],
).enableRLS();
