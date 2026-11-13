import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { check, foreignKey, index, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { count, flag, id, label, newId, nowIso, smallCount, table, tsString } from "./columns.js";
import {
  floorPlanTables,
  floorPlanShape,
  placeChecks,
  rangeCheck,
  rotationCheck,
  tableMerges,
} from "./floor-plans.js";
import { floorZones } from "./floor-zones.js";

export const diningTables = table(
  "dining_tables",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    label: label("label").notNull(),
    shortName: label("short_name"),
    // Written only through `shortNameColumns`; nothing in the database ties it to `short_name`.
    shortNameKey: label("short_name_key"),
    zoneId: id("zone_id").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    needsClearingSince: tsString("needs_clearing_since"),
    // The master table this live table follows.
    planTableId: id("plan_table_id").references((): AnySQLiteColumn => floorPlanTables.id),
    onFloor: flag("on_floor").notNull().default(false),
    todaySeats: count("today_seats"),
    todayFixed: flag("today_fixed").notNull().default(false),
    todayX: smallCount("today_x"),
    todayY: smallCount("today_y"),
    todayWidth: smallCount("today_width"),
    todayHeight: smallCount("today_height"),
    todayShape: floorPlanShape("today_shape"),
    todayRotation: smallCount("today_rotation"),
    takenOff: flag("taken_off").notNull().default(false),
    todayName: label("today_name"),
    mergeId: id("merge_id").references((): AnySQLiteColumn => tableMerges.id),
    mergeBeforeX: smallCount("merge_before_x"),
    mergeBeforeY: smallCount("merge_before_y"),
    mergeBeforeRotation: smallCount("merge_before_rotation"),
  },
  (t) => [
    index("dining_tables_merge_idx").on(t.mergeId),
    check("dining_tables_merge_before_x_ck", rangeCheck(t.mergeBeforeX, 0, 999)),
    check("dining_tables_merge_before_y_ck", rangeCheck(t.mergeBeforeY, 0, 999)),
    check("dining_tables_merge_before_rotation_ck", rotationCheck(t.mergeBeforeRotation)),
    check(
      "dining_tables_merge_before_ck",
      sql`(${t.mergeId} is null) = (${t.mergeBeforeX} is null) and (${t.mergeId} is null) = (${t.mergeBeforeY} is null) and (${t.mergeId} is null) = (${t.mergeBeforeRotation} is null)`,
    ),
    check("dining_tables_today_seats_ck", rangeCheck(t.todaySeats, 0, 999)),
    ...placeChecks("dining_tables_today", {
      x: t.todayX,
      y: t.todayY,
      width: t.todayWidth,
      height: t.todayHeight,
      shape: t.todayShape,
      rotation: t.todayRotation,
    }),
    check(
      "dining_tables_off_floor_ck",
      sql`${t.onFloor} = 1 or (${t.todaySeats} is null and ${t.todayFixed} = 0 and ${t.todayX} is null and ${t.todayY} is null and ${t.todayWidth} is null and ${t.todayHeight} is null and ${t.todayShape} is null and ${t.todayRotation} is null and ${t.takenOff} = 0 and ${t.todayName} is null and ${t.mergeId} is null)`,
    ),
    unique("dining_tables_label_key").on(t.label),
    uniqueIndex("dining_tables_short_name_key_uq").on(t.shortNameKey),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "dining_tables_zone_fk",
    }),
  ],
);
