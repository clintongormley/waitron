import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { locations } from "./tenants.js";

/**
 * An always-on trusted DEVICE (device-identity-1) — a physical screen that joins ONCE (it knocks, an
 * admin accepts) and authenticates itself thereafter with an httpOnly cookie, with NO per-person
 * login. A device
 * is DEFINED by its `device_profile_id` (NOT NULL): the profile's form factor decides whether it binds
 * a kitchen station (kds) or a register (every other form factor) — enforced by device_binding_rule_insert / _update,
 * not a kind column. Location scoped (spec §2a) — a `location_id` FK with `onDelete restrict`, the
 * `shifts` shape; the station binding narrows a kds device further to one kitchen display within
 * that venue.
 *
 * `token_hash` is the scrypt hash of the device token (`hashSecret`, packages/identity secret-hash.ts,
 * §2c): the plaintext lives ONLY in the cookie, never at rest. Revoke by flipping `active = false`
 * (instant — `requireDevice` rejects it), NEVER a hard DELETE, because a device is a durable identity
 * and later tables may reference it — so `app_user` holds SELECT/INSERT/UPDATE and no DELETE, exactly
 * the `kitchen_stations` shape, granted in the paired --custom migration.
 *
 * `station_id` is a BARE uuid: the (station_id) → kitchen_stations
 * (id) FK is hand-written in the --custom migration (the KDS-1 idiom — a
 * `kitchen_stations` table, so its FK cannot be a one-arg `.references()`), exactly as
 * `ticket_items.station_id` is. NULLABLE so a non-kds device carries no station; MATCH
 * SIMPLE (the FK default) skips the check on a NULL station_id.
 */
export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The venue the device lives in — a required scope. A DIRECT location_id →
  // locations.id FK with onDelete restrict, mirroring `shifts` (shifts_location_fk), the precedent
  // the spec cites (§2a "the shifts shape") — NOT the hand-written (location_id) FK
  // kitchen_stations uses. The station binding narrows it further to one display.
  locationId: uuid("location_id")
    .notNull()
    /* v8 ignore next */
    .references(() => locations.id, { onDelete: "restrict" }),
  // The station binding, populated only for a kds-form-factor device. Bare column: the
  // (station_id) → kitchen_stations(id) FK is hand-written
  // in the --custom migration. NULLABLE — a non-kds device carries no station (MATCH SIMPLE skips
  // the FK check on a NULL); the binding rule is enforced by device_binding_rule_insert / _update through the
  // profile's form factor, not a per-column NOT NULL.
  stationId: uuid("station_id"),
  // The `tills` row this sale-capable device rings against (SP-A.2 §16.4). Populated for a
  // non-kds (register-bound) form factor, NULL for a kds device. Bare uuid: the
  // (till_id) → tills(id) FK is hand-written in the --custom migration
  // (a bare column carries no FK), the `station_id` idiom. MATCH SIMPLE skips the check on a NULL.
  tillId: uuid("till_id"),
  // The assigned reusable DEVICE PROFILE (device-profile design 2026-09-05 §5.1) — the binding bundle
  // (name + canvas reference + capabilities) this device resolves against, and the row's FORM FACTOR:
  // a device is now DEFINED by its profile, so this is NOT NULL. Bare uuid: the
  // (device_profile_id) → device_profiles(id) FK is hand-written in
  // the --custom migration, the `station_id` idiom.
  deviceProfileId: uuid("device_profile_id").notNull(),
  // Static hardware binding (SP-A.2 §16.3) — the per-device receipt printer (and its cash-drawer kick).
  // Bare uuid, NULLABLE: the (receipt_printer_id) → printers(id)
  // FK is hand-written in the --custom migration. MATCH SIMPLE skips the check on a NULL.
  receiptPrinterId: uuid("receipt_printer_id"),
  // Static hardware binding (SP-A.2 §16.3): whether this device has a cash drawer. DEFAULT false so an
  // existing device carries no drawer until configured.
  hasCashDrawer: boolean("has_cash_drawer").notNull().default(false),
  // The human label ("Pantalla Cocina"), shown in device management.
  label: text("label").notNull(),
  // scrypt hash of the device token (hashSecret, secret-hash.ts). Never the plaintext token.
  tokenHash: text("token_hash").notNull(),
  // Revoke = active := false, checked in requireDevice for instant revocation. No hard delete.
  active: boolean("active").notNull().default(true),
  // Touched by requireDevice on each authenticated request. NULL until the device is first seen.
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});
