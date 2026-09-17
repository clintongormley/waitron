import { foreignKey, primaryKey } from "drizzle-orm/pg-core";
import { devices, id, table } from "@waitron/db";
import { cardReaders } from "./card-readers.js";

/**
 * A device's DEFAULT card reader — a mutable mapping, not a ledger: at most one row per device
 * (PK `device_id`), replaced or removed as the manager re-points a device's reader.
 * Classified `state` (manager configuration, copied to a standby, never drained back); the grant
 * idiom in 0001_payments_baseline_sql.sql includes DELETE for that reason, unlike `card_readers`
 * itself.
 */
export const deviceCardReaders = table(
  "device_card_readers",
  {
    deviceId: id("device_id").notNull(),
    readerId: id("reader_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId] }),
    // `restrict`, deliberately: a mapping must not vanish with its device or reader, and readers are
    // kept rather than deleted so historical payments still resolve a reader's name.
    foreignKey({
      columns: [t.deviceId],
      foreignColumns: [devices.id],
      name: "device_card_readers_device_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.readerId],
      foreignColumns: [cardReaders.id],
      name: "device_card_readers_reader_fk",
    }).onDelete("restrict"),
  ],
);
