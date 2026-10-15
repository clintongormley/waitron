import { sql } from "drizzle-orm";
import { check, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, flag, id, newId, table } from "./columns.js";
import { deviceProfiles } from "./device-profiles.js";
import { pagePrinters } from "./page-printers.js";
import { printers } from "./printers.js";

export const deviceProfilePrinterRole = enumType([
  "receipt",
  "payment_slip",
  "cash_drawer",
  "invoice",
]);

/**
 * The printers a profile's devices may print receipts, payment slips or full invoices to, or open
 * the cash drawer of, in display order, with at most one default per role. Not location-scoped: a
 * printer listed here is offered only to devices at its own location. A row names exactly one
 * target, and only the invoice role may name a page printer.
 */
export const deviceProfilePrinters = table(
  "device_profile_printers",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    deviceProfileId: id("device_profile_id")
      .notNull()
      /* v8 ignore start */
      .references(() => deviceProfiles.id, { onDelete: "cascade" }),
    /* v8 ignore stop */
    /* v8 ignore start */
    printerId: id("printer_id").references(() => printers.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    /* v8 ignore start */
    pagePrinterId: id("page_printer_id").references(() => pagePrinters.id, {
      onDelete: "restrict",
    }),
    /* v8 ignore stop */
    role: deviceProfilePrinterRole("role").notNull(),
    position: count("position").notNull(),
    isDefault: flag("is_default").notNull().default(false),
  },
  (t) => [
    unique("device_profile_printers_profile_role_printer_key").on(
      t.deviceProfileId,
      t.role,
      t.printerId,
    ),
    uniqueIndex("device_profile_printers_profile_role_default_key")
      .on(t.deviceProfileId, t.role)
      .where(sql`${t.isDefault} = 1`),
    uniqueIndex("device_profile_printers_profile_role_page_printer_key").on(
      t.deviceProfileId,
      t.role,
      t.pagePrinterId,
    ),
    check("device_profile_printers_role_ck", enumCheck(t.role)),
    check(
      "device_profile_printers_target_ck",
      sql`(${t.printerId} is null) <> (${t.pagePrinterId} is null) and (${t.pagePrinterId} is null or ${t.role} = 'invoice')`,
    ),
  ],
);
