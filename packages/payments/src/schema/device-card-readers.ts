import { foreignKey, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { devices, tenants } from "@waitron/db";
import { cardReaders } from "./card-readers.js";

/**
 * A device's DEFAULT card reader — a mutable mapping, not a ledger: at most one row per device
 * (PK `tenant_id, device_id`), replaced or removed as the manager re-points a device's reader.
 * Classified `state` (manager configuration, copied to a standby, never drained back); the grant
 * idiom in 0006_device_card_readers_sql.sql includes DELETE for that reason, unlike `card_readers`
 * itself.
 */
export const deviceCardReaders = pgTable(
  "device_card_readers",
  {
    tenantId: uuid("tenant_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    readerId: uuid("reader_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.deviceId] }),
    // `restrict`, deliberately — NOT `cascade` like the sibling state-config table `payment_policy`.
    // A device's default-reader mapping must not silently vanish if a tenant row is deleted, and it
    // is consistent with `card_readers` (restrict-and-kept, so historical payments still resolve a
    // reader's name). One tenant per database means a tenant delete does not happen in normal
    // operation anyway; if it ever must, the mappings are cleared explicitly first.
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "device_card_readers_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.deviceId],
      foreignColumns: [devices.tenantId, devices.id],
      name: "device_card_readers_device_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.readerId],
      foreignColumns: [cardReaders.tenantId, cardReaders.id],
      name: "device_card_readers_reader_fk",
    }).onDelete("restrict"),
  ],
);
