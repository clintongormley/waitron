import { boolean, foreignKey, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";

/**
 * One row per physical card reader the venue owns (SumUp/Stripe). Manager configuration, not a
 * money movement — classified `state` (copied to a standby, never drained back). A reader is
 * RETIRED via UPDATE (`active=false`, `retired_at` set), never DELETEd, so historical payments can
 * still resolve the reader's name; the grant idiom in 0004_card_readers_sql.sql withholds DELETE
 * for that reason.
 */
export const cardReaders = pgTable(
  "card_readers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // A plain config token (the provider's id), NOT a credential.
    provider: text("provider").notNull(),
    // The provider's own opaque reference (SumUp/Stripe reader id). A public identifier, NOT a credential.
    providerRef: text("provider_ref").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    // Set when `active` flips false; the row is kept so historical payments still resolve a name.
    retiredAt: timestamp("retired_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "card_readers_tenant_fk",
    }).onDelete("restrict"),
    // Composite target for tenant-consistent FKs from device_card_readers and payments.reader_id.
    unique("card_readers_tenant_id_key").on(t.tenantId, t.id),
    unique("card_readers_provider_ref_key").on(t.tenantId, t.provider, t.providerRef),
  ],
);
