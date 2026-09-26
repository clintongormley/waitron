import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import {
  enumCheck,
  enumType,
  flag,
  id,
  kitchenStations,
  label,
  newId,
  nowIso,
  quantity,
  table,
  tsString,
  workingOrders,
} from "@waitron/db";

export const kitchenNoticeKind = enumType(["recalled", "void", "changed"]);

/**
 * A correction to work already sent to a station, kept until a cook acknowledges it. The line is
 * copied by value because a void deletes the line the notice describes.
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
    quantity: quantity("quantity").notNull(),
    note: label("note"),
    wasStarted: flag("was_started").notNull().default(false),
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
  ],
);
