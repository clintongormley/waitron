import { unique } from "drizzle-orm/sqlite-core";
import { flag, id, label, newId, nowIso, table, tsString } from "@waitron/db";

/**
 * A reader is disabled (`active=false`, `disabled_at` set), never deleted, so historical payments
 * still resolve its name. Only the `on delete restrict` keys from `payments.reader_id` and
 * `device_card_readers.reader_id` refuse a delete, so a reader nothing references can be deleted.
 */
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
  },
  (t) => [unique("card_readers_provider_ref_key").on(t.provider, t.providerRef)],
);
