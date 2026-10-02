import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import {
  enumCheck,
  enumType,
  flag,
  id,
  json,
  kitchenStations,
  label,
  newId,
  nowIso,
  quantity,
  table,
  tsString,
  workingOrders,
} from "@waitron/db";

export const kitchenNoticeKind = enumType(["recalled", "void", "changed", "moved", "rerouted"]);

export const KITCHEN_NOTICE_DIRECTIONS = ["added", "removed"] as const;
const kitchenNoticeDirection = enumType(KITCHEN_NOTICE_DIRECTIONS);

/**
 * A correction to work a station already has on paper or on screen, kept until a cook acknowledges
 * it. The line is copied by value because a void deletes the line the notice describes.
 */
export const kitchenNotices = table(
  "kitchen_notices",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    stationId: id("station_id").notNull(),
    workingOrderId: id("working_order_id").notNull(),
    orderLabel: label("order_label").notNull(),
    kind: kitchenNoticeKind("kind").notNull(),
    lineName: label("line_name").notNull(),
    unitName: json<Record<string, string>>("unit_name"),
    /** A flag rather than the unit's id: it must still answer after the unit is deleted. */
    soldInEach: flag("sold_in_each").notNull().default(false),
    quantity: quantity("quantity").notNull(),
    note: label("note"),
    wasStarted: flag("was_started").notNull().default(false),
    /** On a `moved` notice, the table the work now belongs to; null where it has none. */
    movedTo: label("moved_to"),
    /** On a `changed` notice, whether the quantity was added to or taken from the work. */
    direction: kitchenNoticeDirection("direction"),
    /** On a `changed` notice, the extra taken off the dish, as its kitchen paper printed it. */
    cancelledExtra: label("cancelled_extra"),
    /** On a `rerouted` notice, the station the work now belongs to, by name as it was then. */
    reroutedTo: label("rerouted_to"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    acknowledgedAt: tsString("acknowledged_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "kitchen_notices_station_fk",
    }),
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "kitchen_notices_order_fk",
    }).onDelete("cascade"),
    index("kitchen_notices_open_idx")
      .on(t.stationId, t.createdAt)
      .where(sql`${t.acknowledgedAt} is null`),
    check("kitchen_notices_kind_ck", enumCheck(t.kind)),
    check("kitchen_notices_quantity_ck", sql`${t.quantity} > 0`),
    check("kitchen_notices_moved_to_ck", sql`${t.kind} = 'moved' or ${t.movedTo} is null`),
    check(
      "kitchen_notices_rerouted_to_ck",
      sql`(${t.kind} = 'rerouted' and ${t.reroutedTo} is not null) or (${t.kind} <> 'rerouted' and ${t.reroutedTo} is null)`,
    ),
    check("kitchen_notices_direction_ck", enumCheck(t.direction)),
    check(
      "kitchen_notices_direction_kind_ck",
      sql`${t.kind} = 'changed' or ${t.direction} is null`,
    ),
    check(
      "kitchen_notices_cancelled_extra_kind_ck",
      sql`${t.kind} = 'changed' or ${t.cancelledExtra} is null`,
    ),
  ],
);
