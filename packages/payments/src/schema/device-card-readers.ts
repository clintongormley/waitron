import { foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { devices, id, table } from "@waitron/db";
import { cardReaders } from "./card-readers.js";

/** A device's DEFAULT card reader: a mutable mapping, replaced or removed as the manager re-points it. */
export const deviceCardReaders = table(
  "device_card_readers",
  {
    deviceId: id("device_id").notNull(),
    readerId: id("reader_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId] }),
    // `restrict`, deliberately: a mapping must not vanish with its device or reader.
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
