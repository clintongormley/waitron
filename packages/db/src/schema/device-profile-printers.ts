import { sql } from "drizzle-orm";
import { check, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, flag, id, newId, table } from "./columns.js";
import { deviceProfiles } from "./device-profiles.js";
import { printers } from "./printers.js";

export const deviceProfilePrinterRole = enumType([
  "receipt",
  "payment_slip",
  "cash_drawer",
  "invoice",
]);

/**
 * The printers a profile's devices may print receipts, payment slips or full invoices to, or open
 * the cash drawer of, in display order, with at most one default per role. The list writer only
 * accepts an A4 printer for the invoice role.
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
    printerId: id("printer_id")
      .notNull()
      .references(() => printers.id, { onDelete: "restrict" }),
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
    check("device_profile_printers_role_ck", enumCheck(t.role)),
  ],
);
