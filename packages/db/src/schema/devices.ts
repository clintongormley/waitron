import { sql } from "drizzle-orm";
import { uniqueIndex } from "drizzle-orm/sqlite-core";
import { flag, id, label, newId, nowIso, smallCount, table, tsString } from "./columns.js";
import { deviceProfiles } from "./device-profiles.js";
import { pagePrinters } from "./page-printers.js";
import { printers } from "./printers.js";
import { locations } from "./tenants.js";

/**
 * An always-on trusted device: a screen that joins and then authenticates with an httpOnly
 * cookie, with no per-person login.
 *
 * Disable clears `active`; Delete also sets `deleted_at` and keeps the row, which other tables
 * reference.
 */
export const devices = table(
  "devices",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id")
      .notNull()
      /* v8 ignore start */
      .references(() => locations.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    deviceProfileId: id("device_profile_id")
      .notNull()
      /* v8 ignore start */
      .references(() => deviceProfiles.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    // The explicit receipt, slip and drawer choices; NULL means use the profile's default.
    /* v8 ignore start */
    receiptPrinterId: id("receipt_printer_id").references(() => printers.id, {
      onDelete: "restrict",
    }),
    /* v8 ignore stop */
    /* v8 ignore start */
    paymentSlipPrinterId: id("payment_slip_printer_id").references(() => printers.id, {
      onDelete: "restrict",
    }),
    /* v8 ignore stop */
    /* v8 ignore start */
    cashDrawerPrinterId: id("cash_drawer_printer_id").references(() => printers.id, {
      onDelete: "restrict",
    }),
    /* v8 ignore stop */
    // The invoice choice names a receipt printer or a page printer. `selectDevicePrinter`, the one
    // path that stores a choice, sets one column and clears the other; there is no CHECK because a
    // CHECK would make drizzle-kit rebuild `devices`.
    /* v8 ignore start */
    invoicePrinterId: id("invoice_printer_id").references(() => printers.id, {
      onDelete: "restrict",
    }),
    /* v8 ignore stop */
    /* v8 ignore start */
    invoicePagePrinterId: id("invoice_page_printer_id").references(() => pagePrinters.id, {
      onDelete: "restrict",
    }),
    /* v8 ignore stop */
    label: label("label").notNull(),
    // `hashSecret` of the device token, never the plaintext; "" once the device is deleted.
    tokenHash: label("token_hash").notNull(),
    active: flag("active").notNull().default(true),
    deletedAt: tsString("deleted_at"),
    lastSeenAt: tsString("last_seen_at"),
    // A whole percent, 0 to 100, not basis points like the `rate()` columns. The range is held by
    // `PUT /api/device/battery`: a CHECK would make drizzle-kit rebuild `devices`.
    batteryLevel: smallCount("battery_level"),
    batteryCharging: flag("battery_charging"),
    batteryReportedAt: tsString("battery_reported_at"),
    enrolledAt: tsString("enrolled_at").notNull().$defaultFn(nowIso),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    // A record stores `device_id` and screens show its device by label, so two ACTIVE devices at a
    // location never share one; a revoked device's name is free again.
    uniqueIndex("devices_location_label_active_key")
      .on(t.locationId, t.label)
      .where(sql`${t.active} = 1`),
  ],
);
