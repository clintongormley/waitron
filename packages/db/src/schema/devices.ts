import { isNull, sql, type SQL } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, flag, id, label, newId, nowIso, smallCount, table, tsString } from "./columns.js";
import { deviceProfiles } from "./device-profiles.js";
import { pagePrinters } from "./page-printers.js";
import { printers } from "./printers.js";

export const devices = table(
  "devices",
  {
    id: id("id").primaryKey().$defaultFn(newId),
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
    // The invoice choice names a receipt printer or a page printer. Every write that stores an
    // invoice choice takes its columns from `choiceColumns` (`packages/layouts/src/device-equipment.ts`),
    // which sets one and clears the other; there is no CHECK because a CHECK would make drizzle-kit
    // rebuild `devices`.
    /* v8 ignore start */
    invoicePrinterId: id("invoice_printer_id").references(() => printers.id, {
      onDelete: "restrict",
    }),
    /* v8 ignore stop */
    // No key into the switchable payments set; selectDeviceReader checks it and reader deletion clears it.
    cardReaderId: id("card_reader_id"),
    /* v8 ignore start */
    invoicePagePrinterId: id("invoice_page_printer_id").references(() => pagePrinters.id, {
      onDelete: "restrict",
    }),
    /* v8 ignore stop */
    label: label("label").notNull(),
    // `hashDeviceToken` of the device token, never the plaintext; "" once the device is deleted.
    tokenHash: label("token_hash").notNull(),
    active: flag("active").notNull().default(true),
    deletedAt: tsString("deleted_at"),
    lastSeenAt: tsString("last_seen_at"),
    // A whole percent.
    batteryLevel: smallCount("battery_level"),
    batteryCharging: flag("battery_charging"),
    batteryReportedAt: tsString("battery_reported_at"),
    enrolledAt: tsString("enrolled_at").notNull().$defaultFn(nowIso),
    invoiceRevision: count("invoice_revision").notNull().default(0),
  },
  (t) => [
    check(
      "devices_battery_level_ck",
      sql`${t.batteryLevel} is null or ${t.batteryLevel} between 0 and 100`,
    ),
    check("devices_deleted_ck", sql`${t.deletedAt} is null or ${t.active} = 0`),
    check(
      "devices_invoice_revision_ck",
      sql`${t.invoiceRevision} between 0 and 9007199254740991 and ${t.invoiceRevision} = cast(${t.invoiceRevision} as integer)`,
    ),
    uniqueIndex("devices_label_active_key")
      .on(t.label)
      .where(sql`${t.active} = 1`),
  ],
);

export const deviceNotDeleted = (): SQL => isNull(devices.deletedAt);
