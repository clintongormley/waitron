import { sql, type SQL } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  unique,
  uniqueIndex,
  type AnySQLiteColumn,
  type SQLiteColumn,
} from "drizzle-orm/sqlite-core";
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
import { departments } from "./venue-service/service.js";
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

/** The bounds are pasted into the SQL, so anything but a whole number is refused. */
export const rangeCheck = (column: SQLiteColumn, low: number, high: number): SQL => {
  if (!Number.isInteger(low) || !Number.isInteger(high)) {
    throw new Error(
      `rangeCheck: bounds must be whole numbers, got ${String(low)} and ${String(high)}`,
    );
  }
  return sql`${column} is null or ${column} between ${sql.raw(String(low))} and ${sql.raw(String(high))}`;
};

const rotationCheck = (column: SQLiteColumn): SQL =>
  sql`${column} is null or (${column} between 0 and 345 and ${column} % 15 = 0)`;

type Placed = {
  x: SQLiteColumn;
  y: SQLiteColumn;
  width: SQLiteColumn;
  height: SQLiteColumn;
  shape: SQLiteColumn;
  rotation: SQLiteColumn;
};

const seatsCheck = (name: string, seats: SQLiteColumn) =>
  check(`${name}_seats_ck`, rangeCheck(seats, 0, 999));

/** The checks every table carrying a place shares: all six placement columns set, or none. */
const placeChecks = (name: string, t: Placed) => {
  const six = [t.x, t.y, t.width, t.height, t.shape, t.rotation];
  return [
    check(`${name}_x_ck`, rangeCheck(t.x, 0, 999)),
    check(`${name}_y_ck`, rangeCheck(t.y, 0, 999)),
    check(`${name}_width_ck`, rangeCheck(t.width, 1, 99)),
    check(`${name}_height_ck`, rangeCheck(t.height, 1, 99)),
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

export const floorPlanSets = table(
  "floor_plan_sets",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    departmentId: id("department_id")
      .notNull()
      .references(() => departments.id),
    name: label("name").notNull(),
    isDefault: flag("is_default").notNull().default(false),
  },
  (t) => [
    uniqueIndex("floor_plan_sets_name_key").on(t.departmentId, t.name),
    uniqueIndex("floor_plan_sets_one_default_key")
      .on(t.departmentId)
      .where(sql`${t.isDefault}`),
    check("floor_plan_sets_name_ck", sql`trim(${t.name}) <> ''`),
  ],
);

/** One set's layout of one zone, edited by the dashboard only. */
export const floorPlans = table(
  "floor_plans",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    zoneId: id("zone_id").notNull(),
    setId: id("set_id").notNull(),
    revision: count("revision").notNull().default(0),
    savedAt: tsString("saved_at").notNull(),
  },
  (t) => [
    unique("floor_plans_set_zone_key").on(t.setId, t.zoneId),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "floor_plans_zone_fk",
    }),
    foreignKey({
      columns: [t.setId],
      foreignColumns: [floorPlanSets.id],
      name: "floor_plans_set_fk",
    }),
  ],
);

/** A zone's table, shared by every set's layout of the zone; where it stands is a placement. */
export const floorPlanTables = table(
  "floor_plan_tables",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    zoneId: id("zone_id").notNull(),
    label: label("label").notNull(),
    shortName: label("short_name"),
    seats: count("seats"),
    fixed: flag("fixed").notNull().default(false),
    partOfTableId: id("part_of_table_id").references((): AnySQLiteColumn => floorPlanTables.id),
  },
  (t) => [
    unique("floor_plan_tables_zone_label_key").on(t.zoneId, t.label),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "floor_plan_tables_zone_fk",
    }),
    seatsCheck("floor_plan_tables", t.seats),
    index("floor_plan_tables_part_of_idx").on(t.partOfTableId),
    check("floor_plan_tables_part_of_not_self_ck", sql`${t.partOfTableId} <> ${t.id}`),
  ],
);

/** Null coordinates keep an off-layout table's size without placing it. */
export const floorPlanPlacements = table(
  "floor_plan_placements",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    planId: id("plan_id").notNull(),
    planTableId: id("plan_table_id").notNull(),
    x: smallCount("x"),
    y: smallCount("y"),
    width: smallCount("width").notNull(),
    height: smallCount("height").notNull(),
    shape: floorPlanShape("shape"),
    rotation: smallCount("rotation"),
  },
  (t) => [
    unique("floor_plan_placements_table_key").on(t.planId, t.planTableId),
    foreignKey({
      columns: [t.planId],
      foreignColumns: [floorPlans.id],
      name: "floor_plan_placements_plan_fk",
    }),
    foreignKey({
      columns: [t.planTableId],
      foreignColumns: [floorPlanTables.id],
      name: "floor_plan_placements_table_fk",
    }),
    ...placeChecks("floor_plan_placements", t).filter(
      (c) => c.name !== "floor_plan_placements_placement_ck",
    ),
    check(
      "floor_plan_placements_placement_ck",
      sql`(${t.x} is null and ${t.y} is null and ${t.shape} is null and ${t.rotation} is null) or (${t.x} is not null and ${t.y} is not null and ${t.shape} is not null and ${t.rotation} is not null)`,
    ),
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
    shortName: label("short_name"),
    seats: count("seats"),
    fixed: flag("fixed").notNull().default(false),
    ...placementColumns(),
    remove: flag("remove").notNull().default(false),
    pending: flag("pending").notNull().default(false),
    // The master table the target was copied from; a table created for the target follows it.
    planTableId: id("plan_table_id").references(() => floorPlanTables.id),
    // Today's row has been set from the target; a pending row then waits only for its name.
    placed: flag("placed").notNull().default(false),
    readyToMove: flag("ready_to_move").notNull().default(false),
    // Applying the row leaves today's table taken off when it still is (Update layout copies it).
    takenOff: flag("taken_off").notNull().default(false),
    partOfResetTableId: id("part_of_reset_table_id").references(
      (): AnySQLiteColumn => floorResetTables.id,
    ),
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
    seatsCheck("floor_reset_tables", t.seats),
    index("floor_reset_tables_part_of_idx").on(t.partOfResetTableId),
    check("floor_reset_tables_part_of_not_self_ck", sql`${t.partOfResetTableId} <> ${t.id}`),
    ...placeChecks("floor_reset_tables", t),
  ],
);

/** Today's plan for one zone: the business day it was built for. */
export const floorTodayZones = table(
  "floor_today_zones",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    zoneId: id("zone_id").notNull(),
    businessDay: day("business_day").notNull(),
    // Stored as `generation`: renaming the column would need a migration.
    revision: count("generation").notNull().default(0),
    setId: id("set_id"),
    layoutRevision: count("layout_revision").notNull().default(0),
    occurrence: label("occurrence"),
  },
  (t) => [
    unique("floor_today_zones_zone_key").on(t.zoneId),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "floor_today_zones_zone_fk",
    }),
    foreignKey({
      columns: [t.setId],
      foreignColumns: [floorPlanSets.id],
      name: "floor_today_zones_set_fk",
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
    name: label("name"),
  },
  (t) => [
    unique("floor_today_tables_table_key").on(t.tableId),
    foreignKey({
      columns: [t.tableId],
      foreignColumns: [diningTables.id],
      name: "floor_today_tables_table_fk",
    }),
    seatsCheck("floor_today_tables", t.seats),
    ...placeChecks("floor_today_tables", t),
  ],
);

export const floorTodayJoins = table(
  "floor_today_joins",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    zoneId: id("zone_id").notNull(),
    seats: count("seats").notNull(),
    name: label("name"),
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
    check("floor_today_join_tables_before_x_ck", rangeCheck(t.beforeX, 0, 999)),
    check("floor_today_join_tables_before_y_ck", rangeCheck(t.beforeY, 0, 999)),
    check("floor_today_join_tables_before_rotation_ck", rotationCheck(t.beforeRotation)),
  ],
);

/** A part split off its joined table today. */
export const floorTodaySplitParts = table(
  "floor_today_split_parts",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    joinedTableId: id("joined_table_id").notNull(),
    partTableId: id("part_table_id").notNull(),
  },
  (t) => [
    unique("floor_today_split_parts_part_key").on(t.partTableId),
    index("floor_today_split_parts_joined_idx").on(t.joinedTableId),
    check("floor_today_split_parts_not_self_ck", sql`${t.joinedTableId} <> ${t.partTableId}`),
    foreignKey({
      columns: [t.joinedTableId],
      foreignColumns: [diningTables.id],
      name: "floor_today_split_parts_joined_fk",
    }),
    foreignKey({
      columns: [t.partTableId],
      foreignColumns: [diningTables.id],
      name: "floor_today_split_parts_part_fk",
    }),
  ],
);
