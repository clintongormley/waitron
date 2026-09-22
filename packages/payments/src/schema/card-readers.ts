import { unique } from "drizzle-orm/sqlite-core";
import { flag, id, label, newId, nowIso, table, tsString } from "@waitron/db";

/**
 * One row per physical card reader the venue owns (SumUp/Stripe). Manager configuration, not a
 * money movement — classified `state` (copied to a standby, never drained back). A reader is
 * DISABLED via UPDATE (`active=false`, `disabled_at` set), never DELETEd, so historical payments can
 * still resolve the reader's name. The grant that used to withhold DELETE is gone with PostgreSQL;
 * what refuses it now is the schema itself, and only while something points at the row —
 * `payments.reader_id` and `device_card_readers.reader_id` are both `on delete restrict`
 * (`drizzle/0000_baseline.sql`), and the venue store opens every connection with
 * `pragma foreign_keys = on` (`packages/store/src/index.ts`). A reader nothing references can
 * still be deleted by anyone holding the file.
 */
export const cardReaders = table(
  "card_readers",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // A plain config token (the provider's id), NOT a credential.
    provider: label("provider").notNull(),
    // The provider's own opaque reference (SumUp/Stripe reader id). A public identifier, NOT a credential.
    providerRef: label("provider_ref").notNull(),
    name: label("name").notNull(),
    active: flag("active").notNull().default(true),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    // Set when `active` flips false; the row is kept so historical payments still resolve a name.
    disabledAt: tsString("disabled_at"),
    // Local Enable cannot restore a registration we removed at the provider; verified adoption can.
    unpairedAt: tsString("unpaired_at"),
  },
  (t) => [unique("card_readers_provider_ref_key").on(t.provider, t.providerRef)],
);
