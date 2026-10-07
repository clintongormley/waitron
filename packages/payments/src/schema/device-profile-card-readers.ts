import { sql } from "drizzle-orm";
import { foreignKey, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, deviceProfiles, flag, id, table } from "@waitron/db";
import { cardReaders } from "./card-readers.js";

/** The card readers a profile's devices may use, in display order, with at most one default. */
export const deviceProfileCardReaders = table(
  "device_profile_card_readers",
  {
    deviceProfileId: id("device_profile_id").notNull(),
    readerId: id("reader_id").notNull(),
    position: count("position").notNull(),
    isDefault: flag("is_default").notNull().default(false),
  },
  (t) => [
    primaryKey({
      columns: [t.deviceProfileId, t.readerId],
      name: "device_profile_card_readers_pk",
    }),
    foreignKey({
      columns: [t.deviceProfileId],
      foreignColumns: [deviceProfiles.id],
      name: "device_profile_card_readers_profile_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.readerId],
      foreignColumns: [cardReaders.id],
      name: "device_profile_card_readers_reader_fk",
    }).onDelete("restrict"),
    uniqueIndex("device_profile_card_readers_profile_default_key")
      .on(t.deviceProfileId)
      .where(sql`${t.isDefault} = 1`),
  ],
);
