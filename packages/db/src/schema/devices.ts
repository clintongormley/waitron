import { boolean, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { locations, tenants } from "./tenants.js";

/**
 * An always-on trusted DEVICE (device-identity-1) — a physical screen that joins ONCE (it knocks, an
 * admin accepts) and authenticates itself thereafter with an httpOnly cookie, with NO per-person
 * login. A device
 * is DEFINED by its `device_profile_id` (NOT NULL): the profile's form factor decides whether it binds
 * a kitchen station (kds) or a register (every other form factor) — enforced by device_binding_rule_insert / _update,
 * not a kind column. Tenant + location scoped (spec §2a) — separate `tenant_id` and `location_id` FKs,
 * both `onDelete restrict`, the `shifts` shape; the station binding narrows a kds device further to one
 * kitchen display within that venue.
 *
 * `token_hash` is the scrypt hash of the device token (`hashSecret`, packages/identity secret-hash.ts,
 * §2c): the plaintext lives ONLY in the cookie, never at rest. Revoke by flipping `active = false`
 * (instant — `requireDevice` rejects it), NEVER a hard DELETE, because a device is a durable identity
 * and later tables may reference it — so `app_user` holds SELECT/INSERT/UPDATE and no DELETE, exactly
 * the `kitchen_stations` shape, granted in the paired --custom migration.
 *
 * `station_id` is a BARE uuid: the tenant-consistent (tenant_id, station_id) → kitchen_stations
 * (tenant_id, id) composite FK is hand-written in the --custom migration (the KDS-1 idiom — a
 * `kitchen_stations` table, so its FK cannot be a one-arg `.references()`), exactly as
 * `ticket_items.station_id` is. NULLABLE so a non-kds device carries no station; MATCH
 * SIMPLE (the FK default) skips the check on a NULL station_id.
 */
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      // Two-arg `.references()` so v8 tracks this thunk as its own never-invoked function (drizzle-kit
      // resolves it in a separate CLI process), the reason kitchen-stations.ts / ticket-items.ts use this form.
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // The venue the device lives in — a required scope, like tenant_id. A DIRECT location_id →
    // locations.id FK with onDelete restrict, mirroring `shifts` (shifts_location_fk), the precedent
    // the spec cites (§2a "the shifts shape") — NOT the composite (tenant_id, location_id) FK
    // kitchen_stations uses. The station binding narrows it further to one display.
    locationId: uuid("location_id")
      .notNull()
      /* v8 ignore next */
      .references(() => locations.id, { onDelete: "restrict" }),
    // The station binding, populated only for a kds-form-factor device. Bare column: the
    // tenant-consistent (tenant_id, station_id) → kitchen_stations(tenant_id, id) FK is hand-written
    // in the --custom migration. NULLABLE — a non-kds device carries no station (MATCH SIMPLE skips
    // the FK check on a NULL); the binding rule is enforced by device_binding_rule_insert / _update through the
    // profile's form factor, not a per-column NOT NULL.
    stationId: uuid("station_id"),
    // The `tills` row this sale-capable device rings against (SP-A.2 §16.4). Populated for a
    // non-kds (register-bound) form factor, NULL for a kds device. Bare uuid: the tenant-consistent
    // (tenant_id, till_id) → tills(tenant_id, id) composite FK is hand-written in the --custom migration
    // (a bare column carries no FK), the `station_id` idiom. MATCH SIMPLE skips the check on a NULL.
    tillId: uuid("till_id"),
    // The assigned reusable DEVICE PROFILE (device-profile design 2026-09-05 §5.1) — the binding bundle
    // (name + canvas reference + capabilities) this device resolves against, and the row's FORM FACTOR:
    // a device is now DEFINED by its profile, so this is NOT NULL. Bare uuid: the tenant-consistent
    // (tenant_id, device_profile_id) → device_profiles(tenant_id, id) composite FK is hand-written in
    // the --custom migration, the `station_id` idiom.
    deviceProfileId: uuid("device_profile_id").notNull(),
    // Static hardware binding (SP-A.2 §16.3) — the per-device receipt printer (and its cash-drawer kick).
    // Bare uuid, NULLABLE: the tenant-consistent (tenant_id, receipt_printer_id) → printers(tenant_id, id)
    // composite FK is hand-written in the --custom migration. MATCH SIMPLE skips the check on a NULL.
    receiptPrinterId: uuid("receipt_printer_id"),
    // Static hardware binding (SP-A.2 §16.3): whether this device has a cash drawer. DEFAULT false so an
    // existing device carries no drawer until configured.
    hasCashDrawer: boolean("has_cash_drawer").notNull().default(false),
    // Static hardware binding (SP-A.2 §16.3): the card-payment provider for this device. DEFAULT 'none'
    // (no integrated card). A plain text config token, NOT a credential — the reader's secrets stay in
    // the vault, never here.
    cardProvider: text("card_provider").notNull().default("none"),
    // Static hardware binding (SP-A.2 §16.3): the provider's reader identifier for this device. NULLABLE
    // (no integrated reader). A public identifier, NOT a credential — credentials stay in the vault.
    cardReaderId: text("card_reader_id"),
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
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite (tenant_id, id) UNIQUE — the target a later table's tenant-consistent
    // (tenant_id, device_id) FK would use, the same role kitchen_stations_tenant_id_key plays.
    unique("devices_tenant_id_key").on(t.tenantId, t.id),
  ],
);
