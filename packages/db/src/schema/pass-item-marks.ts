import { foreignKey, index, primaryKey } from "drizzle-orm/sqlite-core";
import { id, table, tsString } from "./columns.js";
import { devices } from "./devices.js";
import { ticketItems } from "./ticket-items.js";

/** A device's own Done on one kitchen record, removed with that record. */
export const passItemMarks = table(
  "pass_item_marks",
  {
    deviceId: id("device_id").notNull(),
    ticketItemId: id("ticket_item_id").notNull(),
    doneAt: tsString("done_at").notNull(),
    // People live in identity's migration set, which core cannot reference.
    doneByPersonId: id("done_by_person_id"),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.ticketItemId], name: "pass_item_marks_pk" }),
    foreignKey({
      columns: [t.deviceId],
      foreignColumns: [devices.id],
      name: "pass_item_marks_device_fk",
    }),
    foreignKey({
      columns: [t.ticketItemId],
      foreignColumns: [ticketItems.id],
      name: "pass_item_marks_item_fk",
    }).onDelete("cascade"),
    index("pass_item_marks_item_idx").on(t.ticketItemId),
  ],
);
