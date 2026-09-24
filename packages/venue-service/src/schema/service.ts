import { sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { check, foreignKey, index, primaryKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { menuItems } from "@waitron/catalogue";
import {
  catalogues,
  categories,
  count,
  devices,
  flag,
  floorZones,
  id,
  json,
  kitchenStations,
  label,
  locations,
  newId,
  nowIso,
  products,
  table,
  timeOfDay,
  tsString,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";

export const departments = table(
  "departments",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    name: label("name").notNull(),
    tradingName: label("trading_name").notNull(),
    // Not the enumText/enumCheck pair, here or in the four other checked value-set columns in this
    // file: enumCheck joins the values with ", " and these constraints have no space, so
    // substituting it rewrites the constraint.
    defaultServiceMode: label("default_service_mode").notNull(),
    isDefault: flag("is_default").notNull().default(false),
    active: flag("active").notNull().default(true),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    unique("departments_location_name_key").on(t.locationId, t.name),
    uniqueIndex("departments_one_default_per_location_key")
      .on(t.locationId)
      .where(sql`${t.isDefault}`),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "departments_location_fk",
    }),
    check(
      "departments_service_mode_ck",
      sql`${t.defaultServiceMode} in ('table_tab','prepay','invoice_first','ticket_then_pay')`,
    ),
  ],
);

export const zoneServicePolicies = table(
  "zone_service_policies",
  {
    locationId: id("location_id").notNull(),
    zoneId: id("zone_id").notNull(),
    departmentId: id("department_id").notNull(),
    // Not enumText: see departments.default_service_mode.
    serviceMode: label("service_mode"),
    defaultMenuId: id("default_menu_id"),
    isCounterDefault: flag("is_counter_default").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.zoneId], name: "zone_service_policies_pk" }),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "zone_service_policies_location_fk",
    }),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "zone_service_policies_zone_fk",
    }),
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "zone_service_policies_department_fk",
    }),
    foreignKey({
      columns: [t.defaultMenuId],
      foreignColumns: [catalogues.id],
      name: "zone_service_policies_default_menu_fk",
    }),
    // A default menu must also be an allowed menu for that zone; a null default satisfies the key.
    // The key is not declared deferrable, so outside `pragma defer_foreign_keys` it is checked at
    // each statement, and `zone_menus.zone_id` points back at this row: insert the policy with a
    // null default, then its `zone_menus` rows, then name the default.
    foreignKey({
      columns: [t.zoneId, t.defaultMenuId],
      foreignColumns: ZONE_MENU_KEY,
      name: "zone_service_policies_default_allowed_fk",
    }),
    uniqueIndex("zone_service_policies_one_counter_default_key")
      .on(t.locationId)
      .where(sql`${t.isCounterDefault}`),
    check(
      "zone_service_policies_mode_ck",
      sql`${t.serviceMode} is null or ${t.serviceMode} in ('table_tab','prepay','invoice_first','ticket_then_pay')`,
    ),
  ],
);

export const zoneMenus = table(
  "zone_menus",
  {
    zoneId: id("zone_id").notNull(),
    menuId: id("menu_id").notNull(),
    displayOrder: count("display_order").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.zoneId, t.menuId], name: "zone_menus_pk" }),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [zoneServicePolicies.zoneId],
      name: "zone_menus_zone_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.menuId],
      foreignColumns: [catalogues.id],
      name: "zone_menus_menu_fk",
    }),
    index("zone_menus_order_idx").on(t.zoneId, t.displayOrder),
  ],
);

/**
 * Explicitly typed because the two tables reference each other, and TypeScript cannot infer either
 * table's type through the cycle (TS7022). The callback that reads it runs after this line.
 */
const ZONE_MENU_KEY: [AnySQLiteColumn, AnySQLiteColumn] = [zoneMenus.zoneId, zoneMenus.menuId];

export const deviceZoneDefaults = table(
  "device_zone_defaults",
  {
    deviceId: id("device_id").notNull(),
    zoneId: id("zone_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId], name: "device_zone_defaults_pk" }),
    foreignKey({
      columns: [t.deviceId],
      foreignColumns: [devices.id],
      name: "device_zone_defaults_device_fk",
    }),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "device_zone_defaults_zone_fk",
    }),
  ],
);

export const preparationRoutes = table(
  "preparation_routes",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
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
      name: "preparation_routes_location_fk",
    }),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "preparation_routes_zone_fk",
    }),
    foreignKey({
      columns: [t.categoryId],
      foreignColumns: [categories.id],
      name: "preparation_routes_category_fk",
    }),
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "preparation_routes_product_fk",
    }),
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "preparation_routes_station_fk",
    }),
    // Each comparison is 1 or 0, so the sum counts the non-null columns; `nullif` turns a false
    // flag into NULL so it does not count.
    check(
      "preparation_routes_subject_ck",
      sql`(${t.categoryId} is not null) + (${t.productId} is not null) = 1`,
    ),
    check(
      "preparation_routes_target_ck",
      sql`(${t.stationId} is not null) + (nullif(${t.noPreparation}, false) is not null) = 1`,
    ),
    index("preparation_routes_lookup_idx").on(t.locationId, t.zoneId, t.productId, t.categoryId),
    // A null zone means venue-wide routing, so each of the four specificities has its own partial
    // unique index: a venue-wide route and a zone route for the same subject can both exist.
    uniqueIndex("preparation_routes_zone_product_key")
      .on(t.locationId, t.zoneId, t.productId)
      .where(sql`${t.zoneId} is not null and ${t.productId} is not null`),
    uniqueIndex("preparation_routes_zone_category_key")
      .on(t.locationId, t.zoneId, t.categoryId)
      .where(sql`${t.zoneId} is not null and ${t.categoryId} is not null`),
    uniqueIndex("preparation_routes_venue_product_key")
      .on(t.locationId, t.productId)
      .where(sql`${t.zoneId} is null and ${t.productId} is not null`),
    uniqueIndex("preparation_routes_venue_category_key")
      .on(t.locationId, t.categoryId)
      .where(sql`${t.zoneId} is null and ${t.categoryId} is not null`),
  ],
);

export const departmentHours = table(
  "department_hours",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    departmentId: id("department_id").notNull(),
    weekday: count("weekday").notNull(),
    opensAt: timeOfDay("opens_at").notNull(),
    closesAt: timeOfDay("closes_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "department_hours_department_fk",
    }).onDelete("cascade"),
    check("department_hours_weekday_ck", sql`${t.weekday} between 0 and 6`),
    unique("department_hours_interval_key").on(t.departmentId, t.weekday, t.opensAt, t.closesAt),
  ],
);

export const orderServiceContexts = table(
  "order_service_contexts",
  {
    workingOrderId: id("working_order_id").notNull(),
    locationId: id("location_id").notNull(),
    zoneId: id("zone_id").notNull(),
    departmentId: id("department_id").notNull(),
    // Not enumText: see departments.default_service_mode.
    serviceMode: label("service_mode").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workingOrderId], name: "order_service_contexts_pk" }),
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "order_service_contexts_order_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "order_service_contexts_zone_fk",
    }),
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "order_service_contexts_department_fk",
    }),
    check(
      "order_service_contexts_mode_ck",
      sql`${t.serviceMode} in ('table_tab','prepay','invoice_first','ticket_then_pay')`,
    ),
  ],
);

export const workingLineContexts = table(
  "working_line_contexts",
  {
    workingOrderLineId: id("working_order_line_id").notNull(),
    menuItemId: id("menu_item_id").notNull(),
    menuId: id("menu_id").notNull(),
    menuName: label("menu_name").notNull(),
    departmentId: id("department_id").notNull(),
    departmentName: label("department_name").notNull(),
    categoryName: label("category_name").notNull(),
    unitId: id("unit_id").notNull(),
    unitName: json<Record<string, string>>("unit_name").notNull(),
    unitPrecision: count("unit_precision").notNull(),
    // Not enumText: see departments.default_service_mode.
    hardwareUnit: label("hardware_unit"),
    // Not enumText: see departments.default_service_mode.
    vatClass: label("vat_class").notNull(),
    allergens:
      json<Record<string, { presence: "contains" | "may_contain"; source?: string }>>("allergens"),
    diet: json<unknown>("diet"),
    dietDerivation: json<unknown>("diet_derivation"),
    dietOverride: json<unknown>("diet_override"),
  },
  (t) => [
    primaryKey({ columns: [t.workingOrderLineId], name: "working_line_contexts_pk" }),
    foreignKey({
      columns: [t.workingOrderLineId],
      foreignColumns: [workingOrderLines.id],
      name: "working_line_contexts_line_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.menuItemId],
      foreignColumns: [menuItems.id],
      name: "working_line_contexts_menu_item_fk",
    }),
    check("working_line_contexts_unit_precision_ck", sql`${t.unitPrecision} between 0 and 3`),
    check(
      "working_line_contexts_hardware_unit_ck",
      sql`${t.hardwareUnit} is null or ${t.hardwareUnit} in ('kg','g','mg')`,
    ),
    check(
      "working_line_contexts_vat_class_ck",
      sql`${t.vatClass} in ('general','reduced','super_reduced','zero')`,
    ),
  ],
);
