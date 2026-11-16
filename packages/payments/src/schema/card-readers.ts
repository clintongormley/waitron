import { sql } from "drizzle-orm";
import { foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { devices, flag, id, label, newId, nowIso, table, tsString } from "@waitron/db";

export const cardReaders = table(
  "card_readers",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    provider: label("provider").notNull(),
    // The provider's own reader id: a public identifier, NOT a credential.
    providerRef: label("provider_ref").notNull(),
    name: label("name").notNull(),
    heldByDeviceId: id("held_by_device_id"),
    printsOwnSlipAutomatically: flag("prints_own_slip_automatically").notNull().default(false),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    disabledAt: tsString("disabled_at"),
    // Provider-verified adoption must precede reuse of an unpaired registration.
    unpairedAt: tsString("unpaired_at"),
    deletedAt: tsString("deleted_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.heldByDeviceId],
      foreignColumns: [devices.id],
      name: "card_readers_holder_fk",
    }).onDelete("set null"),
    uniqueIndex("card_readers_provider_ref_key")
      .on(t.provider, t.providerRef)
      .where(sql`${t.deletedAt} is null`),
  ],
);
