import { flag, id, label, newId, nowIso, table, tsString } from "./columns.js";
import { deviceProfiles } from "./device-profiles.js";
import { kitchenStations } from "./kitchen-stations.js";
import { printers } from "./printers.js";
import { locations, tills } from "./tenants.js";

/**
 * An always-on trusted device: a screen that joins once and then authenticates with an httpOnly
 * cookie, with no per-person login. Its profile's form factor decides whether it binds a kitchen
 * station (kds) or a till (every other form factor), enforced by the `device_binding_rule_insert` /
 * `_update` triggers rather than by per-column NOT NULLs.
 *
 * Revoke by setting `active = false`, never a hard DELETE: a device is a durable identity other
 * tables reference. No trigger refuses the DELETE; the rule lives in code.
 */
export const devices = table("devices", {
  id: id("id").primaryKey().$defaultFn(newId),
  locationId: id("location_id")
    .notNull()
    /* v8 ignore start */
    .references(() => locations.id, { onDelete: "restrict" }),
  /* v8 ignore stop */
  /* v8 ignore start */
  stationId: id("station_id").references(() => kitchenStations.id),
  /* v8 ignore stop */
  /* v8 ignore start */
  tillId: id("till_id").references(() => tills.id, { onDelete: "restrict" }),
  /* v8 ignore stop */
  deviceProfileId: id("device_profile_id")
    .notNull()
    /* v8 ignore start */
    .references(() => deviceProfiles.id, { onDelete: "restrict" }),
  /* v8 ignore stop */
  /* v8 ignore start */
  receiptPrinterId: id("receipt_printer_id").references(() => printers.id, {
    onDelete: "restrict",
  }),
  /* v8 ignore stop */
  hasCashDrawer: flag("has_cash_drawer").notNull().default(false),
  label: label("label").notNull(),
  // `hashSecret` of the device token, never the plaintext.
  tokenHash: label("token_hash").notNull(),
  active: flag("active").notNull().default(true),
  lastSeenAt: tsString("last_seen_at"),
  enrolledAt: tsString("enrolled_at").notNull().$defaultFn(nowIso),
  createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
});
