import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, id, label, newId, parties, table, workingOrders } from "@waitron/db";

export const orderKitchenNotes = table(
  "order_kitchen_notes",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    workingOrderId: id("working_order_id"),
    partyId: id("party_id"),
    note: label("note"),
    revision: count("revision").notNull().default(0),
  },
  (t) => [
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "order_kitchen_notes_order_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.partyId],
      foreignColumns: [parties.id],
      name: "order_kitchen_notes_party_fk",
    }).onDelete("cascade"),
    uniqueIndex("order_kitchen_notes_order_key").on(t.workingOrderId),
    uniqueIndex("order_kitchen_notes_party_key").on(t.partyId),
    check(
      "order_kitchen_notes_owner_ck",
      sql`(${t.workingOrderId} is null) <> (${t.partyId} is null)`,
    ),
    check(
      "order_kitchen_notes_revision_ck",
      sql`typeof(${t.revision}) = 'integer' and ${t.revision} >= 0`,
    ),
  ],
);
