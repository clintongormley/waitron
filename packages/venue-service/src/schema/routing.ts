import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  categories,
  flag,
  floorZones,
  id,
  kitchenStations,
  locations,
  newId,
  products,
  table,
} from "@waitron/db";
import { menuPeriods } from "./menus.js";

/** A missing row is an unset cell; All categories × Every zone is the default station, never a row. */
export const routingCells = table(
  "routing_cells",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    categoryId: id("category_id"),
    productId: id("product_id"),
    zoneId: id("zone_id"),
    stationId: id("station_id"),
    noPreparation: flag("no_preparation").notNull().default(false),
    noCategory: flag("no_category").notNull().default(false),
  },
  (t) => [
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "routing_cells_location_fk",
    }),
    foreignKey({
      columns: [t.categoryId],
      foreignColumns: [categories.id],
      name: "routing_cells_category_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "routing_cells_product_fk",
    }),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "routing_cells_zone_fk",
    }),
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "routing_cells_station_fk",
    }),
    check(
      "routing_cells_subject_ck",
      sql`not (${t.categoryId} is not null and ${t.productId} is not null)`,
    ),
    check(
      "routing_cells_coordinate_ck",
      sql`not (${t.categoryId} is null and ${t.productId} is null and ${t.noCategory} = 0 and ${t.zoneId} is null)`,
    ),
    check(
      "routing_cells_target_ck",
      sql`(${t.stationId} is not null and ${t.noPreparation} = 0) or (${t.stationId} is null and ${t.noPreparation} = 1)`,
    ),
    check(
      "routing_cells_no_category_ck",
      sql`${t.noCategory} = 0 or (${t.noCategory} = 1 and ${t.categoryId} is null and ${t.productId} is null)`,
    ),
    uniqueIndex("routing_cells_category_every_zone_key")
      .on(t.locationId, t.categoryId)
      .where(sql`${t.categoryId} is not null and ${t.zoneId} is null`),
    uniqueIndex("routing_cells_category_zone_key")
      .on(t.locationId, t.categoryId, t.zoneId)
      .where(sql`${t.categoryId} is not null and ${t.zoneId} is not null`),
    uniqueIndex("routing_cells_product_every_zone_key")
      .on(t.locationId, t.productId)
      .where(sql`${t.productId} is not null and ${t.zoneId} is null`),
    uniqueIndex("routing_cells_product_zone_key")
      .on(t.locationId, t.productId, t.zoneId)
      .where(sql`${t.productId} is not null and ${t.zoneId} is not null`),
    uniqueIndex("routing_cells_all_zone_key")
      .on(t.locationId, t.zoneId)
      .where(
        sql`${t.categoryId} is null and ${t.productId} is null and ${t.noCategory} = 0 and ${t.zoneId} is not null`,
      ),
    uniqueIndex("routing_cells_no_category_every_zone_key")
      .on(t.locationId, t.noCategory)
      .where(sql`${t.noCategory} = 1 and ${t.zoneId} is null`),
    uniqueIndex("routing_cells_no_category_zone_key")
      .on(t.locationId, t.noCategory, t.zoneId)
      .where(sql`${t.noCategory} = 1 and ${t.zoneId} is not null`),
  ],
);

/** A cell's station, or No preparation, for one of a department's service periods. */
export const routingCellPeriods = table(
  "routing_cell_periods",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    cellId: id("cell_id").notNull(),
    periodId: id("period_id").notNull(),
    departmentId: id("department_id").notNull(),
    stationId: id("station_id"),
    noPreparation: flag("no_preparation").notNull().default(false),
  },
  (t) => [
    foreignKey({
      columns: [t.cellId],
      foreignColumns: [routingCells.id],
      name: "routing_cell_periods_cell_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.periodId, t.departmentId],
      foreignColumns: [menuPeriods.id, menuPeriods.departmentId],
      name: "routing_cell_periods_period_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "routing_cell_periods_station_fk",
    }),
    check(
      "routing_cell_periods_target_ck",
      sql`(${t.stationId} is not null and ${t.noPreparation} = 0) or (${t.stationId} is null and ${t.noPreparation} = 1)`,
    ),
    uniqueIndex("routing_cell_periods_cell_period_key").on(t.cellId, t.periodId),
  ],
);
