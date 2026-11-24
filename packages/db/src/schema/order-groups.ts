import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  id,
  label,
  newId,
  nowIso,
  table,
  tsString,
} from "./columns.js";
import { devices } from "./devices.js";
import { persons } from "./identity/persons.js";
import { parties } from "./parties.js";

export const orderGroupState = enumType(["held", "fired", "removed"]);

export type OrderGroupRequestKind = "new_order" | "next_course" | "added";

/**
 * One group of a party's order, released to the kitchen together (`apps/server/src/order-group-release.ts`).
 * A line names its group in `working_order_lines.group_id`, whichever of the party's bills it sits
 * on. A group emptied while held is `removed`, never deleted, because its events point at it.
 *
 * A group fired by a kitchen display names the device in `fired_by_device_id`; a held group
 * has no firer.
 */
export const orderGroups = table(
  "order_groups",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    partyId: id("party_id").notNull(),
    // No unique index: a reorder rewrites the positions one row at a time, and a unique index would
    // refuse a midway state that the final one satisfies.
    position: count("position").notNull(),
    displayNumber: count("display_number").notNull().default(0),
    numberPartyId: id("number_party_id").references(() => parties.id),
    state: orderGroupState("state").notNull(),
    firedAt: tsString("fired_at"),
    firedBy: id("fired_by"),
    firedByDeviceId: id("fired_by_device_id"),
    submittedBy: id("submitted_by").notNull(),
    remindAt: tsString("remind_at"),
    // When this group's advance HOLD ticket was queued for a printer; null if none was. A held copy
    // made for a moved bill carries its source group's time.
    holdPrintedAt: tsString("hold_printed_at"),
    // Typed by `OrderGroupRequestKind`; nothing refuses another value at run time, and a CHECK would
    // rebuild this table.
    requestKind: label("request_kind")
      .$type<OrderGroupRequestKind>()
      .notNull()
      .default("new_order"),
    // A held copy made for a moved bill carries its source group's time.
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.partyId],
      foreignColumns: [parties.id],
      name: "order_groups_party_fk",
    }),
    foreignKey({
      columns: [t.firedByDeviceId],
      foreignColumns: [devices.id],
      name: "order_groups_fired_by_device_fk",
    }),
    foreignKey({
      columns: [t.firedBy],
      foreignColumns: [persons.id],
      name: "order_groups_fired_by_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.submittedBy],
      foreignColumns: [persons.id],
      name: "order_groups_submitted_by_fk",
    }).onDelete("restrict"),
    index("order_groups_party_idx").on(t.partyId),
    index("order_groups_number_party_idx").on(t.numberPartyId),
    check("order_groups_state_ck", enumCheck(t.state)),
    check("order_groups_fired_at_ck", sql`(${t.state} = 'fired') = (${t.firedAt} is not null)`),
    check("order_groups_firer_ck", sql`${t.firedBy} is null or ${t.firedByDeviceId} is null`),
  ],
);
