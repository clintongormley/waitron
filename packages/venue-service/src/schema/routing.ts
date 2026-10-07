import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  categories,
  count,
  flag,
  floorZones,
  id,
  kitchenStations,
  locations,
  newId,
  products,
  table,
} from "@waitron/db";

export const stationClaims = table(
  "station_claims",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    categoryId: id("category_id").notNull(),
    stationId: id("station_id"),
    noPreparation: flag("no_preparation").notNull().default(false),
  },
  (t) => [
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "station_claims_location_fk",
    }),
    foreignKey({
      columns: [t.categoryId],
      foreignColumns: [categories.id],
      name: "station_claims_category_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "station_claims_station_fk",
    }),
    check(
      "station_claims_target_ck",
      sql`(${t.stationId} is not null) + (nullif(${t.noPreparation}, false) is not null) = 1`,
    ),
    uniqueIndex("station_claims_folder_key").on(t.locationId, t.categoryId),
  ],
);

export const routeExceptions = table(
  "route_exceptions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    position: count("position").notNull(),
    zoneId: id("zone_id"),
    categoryId: id("category_id"),
    productId: id("product_id"),
    stationId: id("station_id"),
    noPreparation: flag("no_preparation").notNull().default(false),
  },
  (t) => [
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "route_exceptions_location_fk",
    }),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "route_exceptions_zone_fk",
    }),
    foreignKey({
      columns: [t.categoryId],
      foreignColumns: [categories.id],
      name: "route_exceptions_category_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "route_exceptions_product_fk",
    }),
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "route_exceptions_station_fk",
    }),
    check(
      "route_exceptions_what_ck",
      sql`not (${t.categoryId} is not null and ${t.productId} is not null)`,
    ),
    check(
      "route_exceptions_condition_ck",
      sql`${t.zoneId} is not null or ${t.categoryId} is not null or ${t.productId} is not null`,
    ),
    check(
      "route_exceptions_target_ck",
      sql`(${t.stationId} is not null) + (nullif(${t.noPreparation}, false) is not null) = 1`,
    ),
    // Reordering updates one row at a time, so positions must permit a swap's intermediate state.
    index("route_exceptions_order_idx").on(t.locationId, t.position),
  ],
);

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
      sql`not (${t.categoryId} is null and ${t.productId} is null and ${t.zoneId} is null)`,
    ),
    check(
      "routing_cells_target_ck",
      sql`(${t.stationId} is not null and ${t.noPreparation} = 0) or (${t.stationId} is null and ${t.noPreparation} = 1)`,
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
      .where(sql`${t.categoryId} is null and ${t.productId} is null and ${t.zoneId} is not null`),
  ],
);
