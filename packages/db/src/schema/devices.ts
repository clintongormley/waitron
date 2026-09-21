import { flag, id, label, newId, nowIso, table, tsString } from "./columns.js";
import { deviceProfiles } from "./device-profiles.js";
import { kitchenStations } from "./kitchen-stations.js";
import { printers } from "./printers.js";
import { locations, tills } from "./tenants.js";

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
 * the `kitchen_stations` shape.
 *
 * `station_id` references `kitchen_stations(id)` and is NULLABLE, so a non-kds device carries no
 * station; a foreign key does not check a NULL.
 */
export const devices = table("devices", {
  id: id("id").primaryKey().$defaultFn(newId),
  // The venue the device lives in — a required scope. A location_id → locations.id FK with
  // onDelete restrict, mirroring `shifts` (shifts_location_fk), the precedent the spec cites
  // (§2a "the shifts shape"). The station binding narrows it further to one display.
  locationId: id("location_id")
    .notNull()
    /* v8 ignore start */
    .references(() => locations.id, { onDelete: "restrict" }),
  /* v8 ignore stop */
  // The station binding, populated only for a kds-form-factor device. NULLABLE — a non-kds device
  // carries no station, and a foreign key does not check a NULL; the binding rule is enforced by
  // device_binding_rule_insert / _update through the profile's form factor, not a per-column
  // NOT NULL.
  /* v8 ignore start */
  stationId: id("station_id").references(() => kitchenStations.id),
  /* v8 ignore stop */
  // The `tills` row this sale-capable device rings against (SP-A.2 §16.4). Populated for a
  // non-kds (register-bound) form factor, NULL for a kds device; a foreign key does not check a
  // NULL. `onDelete restrict` keeps a till a device rings against from being deleted.
  /* v8 ignore start */
  tillId: id("till_id").references(() => tills.id, { onDelete: "restrict" }),
  /* v8 ignore stop */
  // The assigned reusable DEVICE PROFILE (device-profile design 2026-09-05 §5.1) — the binding bundle
  // (name + canvas reference + capabilities) this device resolves against, and the row's FORM FACTOR:
  // a device is now DEFINED by its profile, so this is NOT NULL. `onDelete restrict` keeps a
  // profile a device points at from being deleted.
  deviceProfileId: id("device_profile_id")
    .notNull()
    /* v8 ignore start */
    .references(() => deviceProfiles.id, { onDelete: "restrict" }),
  /* v8 ignore stop */
  // Static hardware binding (SP-A.2 §16.3) — the per-device receipt printer (and its cash-drawer kick).
  // NULLABLE, and a foreign key does not check a NULL. `onDelete restrict` keeps a printer a
  // device is bound to from being deleted.
  /* v8 ignore start */
  receiptPrinterId: id("receipt_printer_id").references(() => printers.id, {
    onDelete: "restrict",
  }),
  /* v8 ignore stop */
  // Static hardware binding (SP-A.2 §16.3): whether this device has a cash drawer. DEFAULT false so an
  // existing device carries no drawer until configured.
  hasCashDrawer: flag("has_cash_drawer").notNull().default(false),
  // The human label ("Pantalla Cocina"), shown in device management.
  label: label("label").notNull(),
  // scrypt hash of the device token (hashSecret, secret-hash.ts). Never the plaintext token.
  tokenHash: label("token_hash").notNull(),
  // Revoke = active := false, checked in requireDevice for instant revocation. No hard delete.
  active: flag("active").notNull().default(true),
  // Touched by requireDevice on each authenticated request. NULL until the device is first seen.
  lastSeenAt: tsString("last_seen_at"),
  enrolledAt: tsString("enrolled_at").notNull().$defaultFn(nowIso),
  createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
});
