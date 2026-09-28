import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  flag,
  id,
  json,
  newId,
  nowIso,
  table,
  tsString,
} from "./columns.js";
import { visits } from "./visits.js";

export const orderGroupState = enumType(["held", "fired", "removed"]);

/**
 * One group of a visit's order, released to the kitchen together (`apps/server/src/order-groups.ts`).
 * A line names its group in `working_order_lines.group_id`, whichever of the visit's bills it sits
 * on. A group emptied while held is `removed`, never deleted, because its events point at it.
 *
 * `fired_by` and `submitted_by` are plain person ids with no key: `persons` is in
 * @waitron/identity's migration set, not the core one.
 */
export const orderGroups = table(
  "order_groups",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    visitId: id("visit_id").notNull(),
    // No unique index: a reorder rewrites the positions one row at a time, and a unique index would
    // refuse a midway state that the final one satisfies.
    position: count("position").notNull(),
    state: orderGroupState("state").notNull(),
    firedAt: tsString("fired_at"),
    firedBy: id("fired_by"),
    submittedBy: id("submitted_by").notNull(),
    remindAt: tsString("remind_at"),
    // When this group's advance HOLD ticket was queued for a printer; null if none was.
    holdPrintedAt: tsString("hold_printed_at"),
    // A later addition (spec §4): the party already had a group when this one was submitted.
    addedLater: flag("added_later").notNull().default(false),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.visitId],
      foreignColumns: [visits.id],
      name: "order_groups_visit_fk",
    }),
    index("order_groups_visit_idx").on(t.visitId),
    check("order_groups_state_ck", enumCheck(t.state)),
    check("order_groups_fired_at_ck", sql`(${t.state} = 'fired') = (${t.firedAt} is not null)`),
  ],
);

export const orderGroupEventKind = enumType([
  "submitted",
  "joined",
  "fired",
  "reordered",
  "lines_moved",
  "removed",
]);

/**
 * What happened to a visit's groups, and who did it. Declared `appendOnly()` in
 * `../classification.ts`. A retried command is answered from `service_commands` and writes no
 * second event.
 *
 * `group_id` is null on a reorder, which names every held group in its `detail`. `actor_id` is a
 * plain person id, as `order_groups.submitted_by` is.
 */
export const orderGroupEvents = table(
  "order_group_events",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    visitId: id("visit_id").notNull(),
    groupId: id("group_id"),
    kind: orderGroupEventKind("kind").notNull(),
    actorId: id("actor_id").notNull(),
    detail: json<Record<string, unknown>>("detail").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.visitId],
      foreignColumns: [visits.id],
      name: "order_group_events_visit_fk",
    }),
    foreignKey({
      columns: [t.groupId],
      foreignColumns: [orderGroups.id],
      name: "order_group_events_group_fk",
    }),
    index("order_group_events_visit_idx").on(t.visitId),
    index("order_group_events_group_idx").on(t.groupId),
    check("order_group_events_kind_ck", enumCheck(t.kind)),
  ],
);
