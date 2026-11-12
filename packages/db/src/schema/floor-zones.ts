import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  count,
  day,
  enumCheck,
  flag,
  id,
  label,
  newId,
  nowIso,
  table,
  timeOfDay,
  tsString,
} from "./columns.js";

import { floorPlanSets } from "./floor-plans.js";
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
    todayBusinessDay: day("today_business_day"),
    todayRevision: count("today_revision").notNull().default(0),
    todaySetId: id("today_set_id").references((): AnySQLiteColumn => floorPlanSets.id),
    todayLayoutRevision: count("today_layout_revision").notNull().default(0),
    todayOccurrence: label("today_occurrence"),
    keptOpenDay: day("kept_open_day"),
    keptOpenFrom: timeOfDay("kept_open_from"),
    keptOpenUntil: timeOfDay("kept_open_until"),
  },
  (t) => [
    check(
      "floor_zones_kept_open_ck",
      sql`(${t.keptOpenDay} is null and ${t.keptOpenFrom} is null and ${t.keptOpenUntil} is null) or (${t.keptOpenDay} is not null and ${t.keptOpenFrom} is not null and ${t.keptOpenUntil} is not null)`,
    ),
    check(
      "floor_zones_kept_open_step_ck",
      sql`substr(${t.keptOpenFrom}, 4, 2) in ('00', '15', '30', '45') and substr(${t.keptOpenUntil}, 4, 2) in ('00', '15', '30', '45')`,
    ),
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
