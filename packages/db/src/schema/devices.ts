import { isNull, sql, type SQL } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  flag,
  id,
  json,
  jsonShapeCheck,
  label,
  newId,
  nowIso,
  smallCount,
  table,
  tsString,
} from "./columns.js";
import { deviceProfiles } from "./device-profiles.js";
import { printers } from "./printers.js";

export const devices = table(
  "devices",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    deviceProfileId: id("device_profile_id")
      .notNull()
      .references(() => deviceProfiles.id, { onDelete: "restrict" }),
    // The explicit receipt, slip and drawer choices; NULL means use the profile's default.
    receiptPrinterId: id("receipt_printer_id").references(() => printers.id, {
      onDelete: "restrict",
    }),
    paymentSlipPrinterId: id("payment_slip_printer_id").references(() => printers.id, {
      onDelete: "restrict",
    }),
    cashDrawerPrinterId: id("cash_drawer_printer_id").references(() => printers.id, {
      onDelete: "restrict",
    }),
    // An invoice choice can name either printer kind.
    invoicePrinterId: id("invoice_printer_id").references(() => printers.id, {
      onDelete: "restrict",
    }),
    // No key into the switchable payments set; selectDeviceReader checks it and reader deletion clears it.
    cardReaderId: id("card_reader_id"),
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
    // The assignment writer checks the station; station deletion clears the id.
    madeHereStationIds: json<string[]>("made_here_station_ids").notNull().default([]),
    invoiceRevision: count("invoice_revision").notNull().default(0),
  },
  (t) => [
    check(
      "devices_battery_level_ck",
      sql`${t.batteryLevel} is null or ${t.batteryLevel} between 0 and 100`,
    ),
    check("devices_deleted_ck", sql`${t.deletedAt} is null or ${t.active} = 0`),
    check(
      "devices_made_here_station_ids_ck",
      sql`${jsonShapeCheck(t.madeHereStationIds, "array")} and json_array_length(${t.madeHereStationIds}) <= 1`,
    ),
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
