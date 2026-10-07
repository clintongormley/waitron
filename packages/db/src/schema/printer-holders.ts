import { foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { id, nowIso, table, tsString } from "./columns.js";
import { devices } from "./devices.js";
import { printers } from "./printers.js";

/** Which device holds each portable printer; the key on `printer_id` allows one holder. */
export const printerHolders = table(
  "printer_holders",
  {
    printerId: id("printer_id").notNull(),
    deviceId: id("device_id").notNull(),
    heldAt: tsString("held_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.printerId], name: "printer_holders_pk" }),
    foreignKey({
      columns: [t.printerId],
      foreignColumns: [printers.id],
      name: "printer_holders_printer_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.deviceId],
      foreignColumns: [devices.id],
      name: "printer_holders_device_fk",
    }).onDelete("cascade"),
  ],
);
