import { sql, type SQL } from "drizzle-orm";
import { check, foreignKey, index, unique, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  count,
  day,
  enumCheck,
  enumType,
  flag,
  id,
  label,
  newId,
  smallCount,
  table,
  tsString,
} from "./columns.js";
import { diningTables } from "./dining-tables.js";
import { floorZones } from "./floor-zones.js";

export const floorPlanShape = enumType(["rect", "round"]);

const placementColumns = () => ({
  x: smallCount("x"),
  y: smallCount("y"),
  width: smallCount("width"),
  height: smallCount("height"),
  shape: floorPlanShape("shape"),
  rotation: smallCount("rotation"),
});

const between = (column: SQLiteColumn, low: number, high: number): SQL =>
  sql`${column} is null or ${column} between ${sql.raw(String(low))} and ${sql.raw(String(high))}`;

const rotationCheck = (column: SQLiteColumn): SQL =>
  sql`${column} is null or (${column} between 0 and 345 and ${column} % 15 = 0)`;

type Placed = {
  seats: SQLiteColumn;
  x: SQLiteColumn;
  y: SQLiteColumn;
  width: SQLiteColumn;
  height: SQLiteColumn;
  shape: SQLiteColumn;
  rotation: SQLiteColumn;
};

/** The checks every table carrying a place shares: all six placement columns set, or none. */
const placementChecks = (name: string, t: Placed) => {
  const six = [t.x, t.y, t.width, t.height, t.shape, t.rotation];
  return [
    check(`${name}_seats_ck`, between(t.seats, 0, 999)),
    check(`${name}_x_ck`, between(t.x, 0, 999)),
    check(`${name}_y_ck`, between(t.y, 0, 999)),
    check(`${name}_width_ck`, between(t.width, 1, 99)),
    check(`${name}_height_ck`, between(t.height, 1, 99)),
    check(`${name}_rotation_ck`, rotationCheck(t.rotation)),
    check(`${name}_shape_ck`, enumCheck(t.shape)),
    check(
      `${name}_placement_ck`,
      sql`(${sql.join(
        six.map((c) => sql`${c} is null`),
        sql` and `,
      )}) or (${sql.join(
        six.map((c) => sql`${c} is not null`),
        sql` and `,
      )})`,
    ),
  ];
};

/** A zone's master plan, edited by the dashboard only. */
export const floorPlans = table(
  "floor_plans",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    zoneId: id("zone_id").notNull(),
    revision: count("revision").notNull().default(0),
    savedAt: tsString("saved_at").notNull(),
  },
  (t) => [
    unique("floor_plans_zone_key").on(t.zoneId),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "floor_plans_zone_fk",
    }),
  ],
);

/** A table on a master plan; a spare has no place, so all six placement columns are null. */
export const floorPlanTables = table(
  "floor_plan_tables",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    planId: id("plan_id").notNull(),
    label: label("label").notNull(),
    seats: count("seats"),
    fixed: flag("fixed").notNull().default(false),
    ...placementColumns(),
  },
  (t) => [
    unique("floor_plan_tables_plan_label_key").on(t.planId, t.label),
    foreignKey({
      columns: [t.planId],
      foreignColumns: [floorPlans.id],
      name: "floor_plan_tables_plan_fk",
    }),
    ...placementChecks("floor_plan_tables", t),
  ],
);

export const floorPlanJoins = table(
  "floor_plan_joins",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    planId: id("plan_id").notNull(),
    seats: count("seats").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.planId],
      foreignColumns: [floorPlans.id],
      name: "floor_plan_joins_plan_fk",
    }),
    check("floor_plan_joins_seats_ck", sql`${t.seats} >= 1`),
  ],
);

export const floorPlanJoinTables = table(
  "floor_plan_join_tables",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    joinId: id("join_id").notNull(),
    planTableId: id("plan_table_id").notNull(),
  },
  (t) => [
    unique("floor_plan_join_tables_join_table_key").on(t.joinId, t.planTableId),
    foreignKey({
      columns: [t.joinId],
      foreignColumns: [floorPlanJoins.id],
      name: "floor_plan_join_tables_join_fk",
    }),
    foreignKey({
      columns: [t.planTableId],
      foreignColumns: [floorPlanTables.id],
      name: "floor_plan_join_tables_table_fk",
    }),
  ],
);

/**
 * What the zone's last reset copied: one row per planned live table, plus one per table it is to
 * create (`table_id` null).
 */
export const floorResetTables = table(
  "floor_reset_tables",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    zoneId: id("zone_id").notNull(),
    tableId: id("table_id"),
    label: label("label").notNull(),
    seats: count("seats"),
    fixed: flag("fixed").notNull().default(false),
    ...placementColumns(),
    remove: flag("remove").notNull().default(false),
    pending: flag("pending").notNull().default(false),
    // The master table the target was copied from; a table created for the target follows it.
    planTableId: id("plan_table_id").references(() => floorPlanTables.id),
    // Today's row has been set from the target; a pending row then waits only for its name.
    placed: flag("placed").notNull().default(false),
  },
  (t) => [
    unique("floor_reset_tables_table_key").on(t.tableId),
    index("floor_reset_tables_zone_pending_idx").on(t.zoneId, t.pending),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "floor_reset_tables_zone_fk",
    }),
    foreignKey({
      columns: [t.tableId],
      foreignColumns: [diningTables.id],
      name: "floor_reset_tables_table_fk",
    }),
    ...placementChecks("floor_reset_tables", t),
  ],
);

/** Today's plan for one zone: the business day it was built for. */
export const floorTodayZones = table(
  "floor_today_zones",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    zoneId: id("zone_id").notNull(),
    businessDay: day("business_day").notNull(),
    generation: count("generation").notNull().default(0),
  },
  (t) => [
    unique("floor_today_zones_zone_key").on(t.zoneId),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "floor_today_zones_zone_fk",
    }),
  ],
);

/** A live table's state for the day; with all six placement columns null it is an unplaced spare. */
export const floorTodayTables = table(
  "floor_today_tables",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    tableId: id("table_id").notNull(),
    seats: count("seats"),
    fixed: flag("fixed").notNull().default(false),
    ...placementColumns(),
    takenOff: flag("taken_off").notNull().default(false),
  },
  (t) => [
    unique("floor_today_tables_table_key").on(t.tableId),
    foreignKey({
      columns: [t.tableId],
      foreignColumns: [diningTables.id],
      name: "floor_today_tables_table_fk",
    }),
    ...placementChecks("floor_today_tables", t),
  ],
);

export const floorTodayJoins = table(
  "floor_today_joins",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    zoneId: id("zone_id").notNull(),
    seats: count("seats").notNull(),
  },
  (t) => [
    index("floor_today_joins_zone_idx").on(t.zoneId),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "floor_today_joins_zone_fk",
    }),
    check("floor_today_joins_seats_ck", sql`${t.seats} >= 1`),
  ],
);

/** A table in one of today's merges, with where it stood before the merge moved it. */
export const floorTodayJoinTables = table(
  "floor_today_join_tables",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    joinId: id("join_id").notNull(),
    tableId: id("table_id").notNull(),
    beforeX: smallCount("before_x").notNull(),
    beforeY: smallCount("before_y").notNull(),
    beforeRotation: smallCount("before_rotation").notNull(),
  },
  (t) => [
    unique("floor_today_join_tables_table_key").on(t.tableId),
    foreignKey({
      columns: [t.joinId],
      foreignColumns: [floorTodayJoins.id],
      name: "floor_today_join_tables_join_fk",
    }),
    foreignKey({
      columns: [t.tableId],
      foreignColumns: [diningTables.id],
      name: "floor_today_join_tables_table_fk",
    }),
    check("floor_today_join_tables_before_x_ck", between(t.beforeX, 0, 999)),
    check("floor_today_join_tables_before_y_ck", between(t.beforeY, 0, 999)),
    check("floor_today_join_tables_before_rotation_ck", rotationCheck(t.beforeRotation)),
  ],
);
