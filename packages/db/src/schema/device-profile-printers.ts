import { check, unique } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, id, newId, table } from "./columns.js";
import { deviceProfiles } from "./device-profiles.js";
import { printers } from "./printers.js";

export const deviceProfilePrinterRole = enumType(["receipt", "payment_slip"]);

/**
 * The printers a profile's devices may print receipts or payment slips to, in the order a device
 * falls back through them. Not location-scoped: a printer listed here is offered only to devices at
 * its own location.
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
    printerId: id("printer_id")
      .notNull()
      /* v8 ignore start */
      .references(() => printers.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    role: deviceProfilePrinterRole("role").notNull(),
    position: count("position").notNull(),
  },
  (t) => [
    unique("device_profile_printers_profile_role_printer_key").on(
      t.deviceProfileId,
      t.role,
      t.printerId,
    ),
    check("device_profile_printers_role_ck", enumCheck(t.role)),
  ],
);
