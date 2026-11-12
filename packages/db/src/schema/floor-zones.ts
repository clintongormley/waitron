import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, enumCheck, flag, id, label, newId, nowIso, table, tsString } from "./columns.js";

import { departments } from "./venue-service/service.js";
import { orderStart, paidWhen, collectionNumber } from "./sale-rule-types.js";

export const floorZones = table(
  "floor_zones",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    displayOrder: count("display_order").notNull().default(0),
    active: flag("active").notNull().default(true),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    departmentId: id("department_id").notNull(),
    isCounterDefault: flag("is_counter_default").notNull().default(false),
    orderStart: orderStart("order_start"),
    paidWhen: paidWhen("paid_when"),
    collectionNumber: collectionNumber("collection_number"),
  },
  (t) => [
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "floor_zones_department_fk",
    }),
    check("floor_zones_order_start_ck", enumCheck(t.orderStart)),
    check("floor_zones_paid_when_ck", enumCheck(t.paidWhen)),
    check("floor_zones_collection_number_ck", enumCheck(t.collectionNumber)),
    uniqueIndex("floor_zones_one_counter_default_key")
      .on(t.isCounterDefault)
      .where(sql`${t.isCounterDefault} = 1 and ${t.active} = 1`),
    uniqueIndex("floor_zones_name_key")
      .on(t.name)
      .where(sql`${t.active} = 1`),
  ],
);
