import { foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { devices, id, nowIso, table, tsString } from "@waitron/db";
import { cardReaders } from "./card-readers.js";

/** Which device holds each card reader; the key on `reader_id` allows one holder. */
export const cardReaderHolders = table(
  "card_reader_holders",
  {
    readerId: id("reader_id").notNull(),
    deviceId: id("device_id").notNull(),
    heldAt: tsString("held_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.readerId], name: "card_reader_holders_pk" }),
    foreignKey({
      columns: [t.readerId],
      foreignColumns: [cardReaders.id],
      name: "card_reader_holders_reader_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.deviceId],
      foreignColumns: [devices.id],
      name: "card_reader_holders_device_fk",
    }).onDelete("cascade"),
  ],
);
