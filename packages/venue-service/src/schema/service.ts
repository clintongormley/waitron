import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { menuItems } from "@waitron/catalogue";
import {
  catalogues,
  categories,
  devices,
  floorZones,
  kitchenStations,
  locations,
  products,
  tenants,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    name: text("name").notNull(),
    tradingName: text("trading_name").notNull(),
    defaultServiceMode: text("default_service_mode").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("departments_tenant_id_key").on(t.tenantId, t.id),
    unique("departments_location_name_key").on(t.tenantId, t.locationId, t.name),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "departments_tenant_fk",
    }),
    foreignKey({
      columns: [t.tenantId, t.locationId],
      foreignColumns: [locations.tenantId, locations.id],
      name: "departments_location_fk",
    }),
    check(
      "departments_service_mode_ck",
      sql`${t.defaultServiceMode} in ('table_tab','prepay','invoice_first','ticket_then_pay')`,
    ),
  ],
);

export const zoneServicePolicies = pgTable(
  "zone_service_policies",
  {
    tenantId: uuid("tenant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    zoneId: uuid("zone_id").notNull(),
    departmentId: uuid("department_id").notNull(),
    serviceMode: text("service_mode"),
    defaultMenuId: uuid("default_menu_id"),
    isCounterDefault: boolean("is_counter_default").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.zoneId], name: "zone_service_policies_pk" }),
    foreignKey({
      columns: [t.tenantId, t.locationId],
      foreignColumns: [locations.tenantId, locations.id],
      name: "zone_service_policies_location_fk",
    }),
    foreignKey({
      columns: [t.tenantId, t.zoneId],
      foreignColumns: [floorZones.tenantId, floorZones.id],
      name: "zone_service_policies_zone_fk",
    }),
    foreignKey({
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
      name: "zone_service_policies_department_fk",
    }),
    foreignKey({
      columns: [t.tenantId, t.defaultMenuId],
      foreignColumns: [catalogues.tenantId, catalogues.id],
      name: "zone_service_policies_default_menu_fk",
    }),
    check(
      "zone_service_policies_mode_ck",
      sql`${t.serviceMode} is null or ${t.serviceMode} in ('table_tab','prepay','invoice_first','ticket_then_pay')`,
    ),
  ],
);

export const zoneMenus = pgTable(
  "zone_menus",
  {
    tenantId: uuid("tenant_id").notNull(),
    zoneId: uuid("zone_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.zoneId, t.menuId], name: "zone_menus_pk" }),
    foreignKey({
      columns: [t.tenantId, t.zoneId],
      foreignColumns: [zoneServicePolicies.tenantId, zoneServicePolicies.zoneId],
      name: "zone_menus_zone_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.menuId],
      foreignColumns: [catalogues.tenantId, catalogues.id],
      name: "zone_menus_menu_fk",
    }),
    index("zone_menus_order_idx").on(t.tenantId, t.zoneId, t.displayOrder),
  ],
);

export const deviceZoneDefaults = pgTable(
  "device_zone_defaults",
  {
    tenantId: uuid("tenant_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    zoneId: uuid("zone_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.deviceId], name: "device_zone_defaults_pk" }),
    foreignKey({
      columns: [t.tenantId, t.deviceId],
      foreignColumns: [devices.tenantId, devices.id],
      name: "device_zone_defaults_device_fk",
    }),
    foreignKey({
      columns: [t.tenantId, t.zoneId],
      foreignColumns: [floorZones.tenantId, floorZones.id],
      name: "device_zone_defaults_zone_fk",
    }),
  ],
);

export const preparationRoutes = pgTable(
  "preparation_routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    zoneId: uuid("zone_id"),
    categoryId: uuid("category_id"),
    productId: uuid("product_id"),
    stationId: uuid("station_id"),
    noPreparation: boolean("no_preparation").notNull().default(false),
  },
  (t) => [
    unique("preparation_routes_tenant_id_key").on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.locationId],
      foreignColumns: [locations.tenantId, locations.id],
      name: "preparation_routes_location_fk",
    }),
    foreignKey({
      columns: [t.tenantId, t.zoneId],
      foreignColumns: [floorZones.tenantId, floorZones.id],
      name: "preparation_routes_zone_fk",
    }),
    foreignKey({
      columns: [t.categoryId],
      foreignColumns: [categories.id],
      name: "preparation_routes_category_fk",
    }),
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "preparation_routes_product_fk",
    }),
    foreignKey({
      columns: [t.tenantId, t.stationId],
      foreignColumns: [kitchenStations.tenantId, kitchenStations.id],
      name: "preparation_routes_station_fk",
    }),
    check("preparation_routes_subject_ck", sql`num_nonnulls(${t.categoryId}, ${t.productId}) = 1`),
    check(
      "preparation_routes_target_ck",
      sql`num_nonnulls(${t.stationId}, nullif(${t.noPreparation}, false)) = 1`,
    ),
    index("preparation_routes_lookup_idx").on(
      t.tenantId,
      t.locationId,
      t.zoneId,
      t.productId,
      t.categoryId,
    ),
  ],
);

export const departmentHours = pgTable(
  "department_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    departmentId: uuid("department_id").notNull(),
    weekday: integer("weekday").notNull(),
    opensAt: time("opens_at").notNull(),
    closesAt: time("closes_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
      name: "department_hours_department_fk",
    }).onDelete("cascade"),
    check("department_hours_weekday_ck", sql`${t.weekday} between 0 and 6`),
    unique("department_hours_interval_key").on(
      t.tenantId,
      t.departmentId,
      t.weekday,
      t.opensAt,
      t.closesAt,
    ),
  ],
);

export const orderServiceContexts = pgTable(
  "order_service_contexts",
  {
    tenantId: uuid("tenant_id").notNull(),
    workingOrderId: uuid("working_order_id").notNull(),
    locationId: uuid("location_id").notNull(),
    zoneId: uuid("zone_id").notNull(),
    departmentId: uuid("department_id").notNull(),
    serviceMode: text("service_mode").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.workingOrderId], name: "order_service_contexts_pk" }),
    foreignKey({
      columns: [t.tenantId, t.workingOrderId],
      foreignColumns: [workingOrders.tenantId, workingOrders.id],
      name: "order_service_contexts_order_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.zoneId],
      foreignColumns: [floorZones.tenantId, floorZones.id],
      name: "order_service_contexts_zone_fk",
    }),
    foreignKey({
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
      name: "order_service_contexts_department_fk",
    }),
    check(
      "order_service_contexts_mode_ck",
      sql`${t.serviceMode} in ('table_tab','prepay','invoice_first','ticket_then_pay')`,
    ),
  ],
);

export const workingLineContexts = pgTable(
  "working_line_contexts",
  {
    tenantId: uuid("tenant_id").notNull(),
    workingOrderLineId: uuid("working_order_line_id").notNull(),
    menuItemId: uuid("menu_item_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    menuName: text("menu_name").notNull(),
    departmentId: uuid("department_id").notNull(),
    departmentName: text("department_name").notNull(),
    categoryName: text("category_name").notNull(),
    pricingUnit: text("pricing_unit").notNull(),
    vatClass: text("vat_class").notNull(),
    allergens:
      jsonb("allergens").$type<
        Record<string, { presence: "contains" | "may_contain"; source?: string }>
      >(),
    diet: jsonb("diet").$type<unknown>(),
    dietDerivation: jsonb("diet_derivation").$type<unknown>(),
    dietOverride: jsonb("diet_override").$type<unknown>(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.workingOrderLineId], name: "working_line_contexts_pk" }),
    foreignKey({
      columns: [t.tenantId, t.workingOrderLineId],
      foreignColumns: [workingOrderLines.tenantId, workingOrderLines.id],
      name: "working_line_contexts_line_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.menuItemId],
      foreignColumns: [menuItems.tenantId, menuItems.id],
      name: "working_line_contexts_menu_item_fk",
    }),
    check("working_line_contexts_pricing_unit_ck", sql`${t.pricingUnit} in ('each','weight')`),
    check(
      "working_line_contexts_vat_class_ck",
      sql`${t.vatClass} in ('general','reduced','super_reduced','zero')`,
    ),
  ],
);
