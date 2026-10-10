import { sql } from "drizzle-orm";
import { uniqueIndex } from "drizzle-orm/sqlite-core";
import { flag, id, label, newId, nowIso, table, tsString } from "@waitron/db";

/** Disable clears `active`; Delete also sets `deleted_at`; payments keep the row either way. */
export const cardReaders = table(
  "card_readers",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    provider: label("provider").notNull(),
    // The provider's own reader id: a public identifier, NOT a credential.
    providerRef: label("provider_ref").notNull(),
    name: label("name").notNull(),
    active: flag("active").notNull().default(true),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    disabledAt: tsString("disabled_at"),
    // Local Enable cannot restore a registration we removed at the provider; verified adoption can.
    unpairedAt: tsString("unpaired_at"),
    deletedAt: tsString("deleted_at"),
  },
  (t) => [
    // One undeleted reader per provider id; a deleted row frees it, a disabled one keeps it.
    uniqueIndex("card_readers_provider_ref_key")
      .on(t.provider, t.providerRef)
      .where(sql`${t.deletedAt} is null`),
  ],
);
