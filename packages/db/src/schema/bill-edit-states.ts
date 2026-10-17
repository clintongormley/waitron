import { sql } from "drizzle-orm";
import { check, foreignKey } from "drizzle-orm/sqlite-core";
import { count, id, table } from "./columns.js";
import { workingOrders } from "./orders.js";

export const billEditStates = table(
  "bill_edit_states",
  {
    billId: id("bill_id").primaryKey().notNull(),
    // No key: persons belongs to the identity module's migration set.
    editorId: id("editor_id"),
    editorVersion: count("editor_version").notNull().default(0),
  },
  (t) => [
    foreignKey({
      columns: [t.billId],
      foreignColumns: [workingOrders.id],
      name: "bill_edit_states_bill_fk",
    }).onDelete("cascade"),
    check("bill_edit_states_version_ck", sql`${t.editorVersion} >= 0`),
  ],
);
