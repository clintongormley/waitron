import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey } from "drizzle-orm/sqlite-core";
import { id, table, tsString } from "./columns.js";
import { devices } from "./devices.js";
import { ticketItems } from "./ticket-items.js";
import { watchers } from "./watchers.js";

/** A watcher's own Done on one kitchen record, removed with that record. */
export const watcherItemMarks = table(
  "watcher_item_marks",
  {
    watcherId: id("watcher_id").notNull(),
    ticketItemId: id("ticket_item_id").notNull(),
    doneAt: tsString("done_at").notNull(),
    // People live in identity's migration set, which core cannot reference.
    doneByPersonId: id("done_by_person_id"),
    doneByDeviceId: id("done_by_device_id"),
  },
  (t) => [
    primaryKey({ columns: [t.watcherId, t.ticketItemId], name: "watcher_item_marks_pk" }),
    foreignKey({
      columns: [t.watcherId],
      foreignColumns: [watchers.id],
      name: "watcher_item_marks_watcher_fk",
    }),
    foreignKey({
      columns: [t.ticketItemId],
      foreignColumns: [ticketItems.id],
      name: "watcher_item_marks_item_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.doneByDeviceId],
      foreignColumns: [devices.id],
      name: "watcher_item_marks_device_fk",
    }),
    check(
      "watcher_item_marks_done_by_ck",
      sql`(${t.doneByPersonId} is null) <> (${t.doneByDeviceId} is null)`,
    ),
    index("watcher_item_marks_item_idx").on(t.ticketItemId),
  ],
);
