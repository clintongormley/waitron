import { sql } from "drizzle-orm";
import { check, foreignKey, primaryKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { menuItems, menuVersions } from "@waitron/catalogue";
import {
  count,
  deviceProfiles,
  enumCheck,
  enumType,
  flag,
  floorZones,
  id,
  json,
  label,
  locations,
  newId,
  nowIso,
  sales,
  table,
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
  ],
);

export const zoneServicePolicies = table(
  "zone_service_policies",
  {
    locationId: id("location_id").notNull(),
    zoneId: id("zone_id").notNull(),
    departmentId: id("department_id").notNull(),
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
    uniqueIndex("zone_service_policies_one_counter_default_key")
      .on(t.locationId)
      .where(sql`${t.isCounterDefault}`),
  ],
);

const orderStart = enumType(["table", "counter"]);
const paidWhen = enumType(["prepay", "ticket_then_pay"]);
const collectionNumber = enumType(["none", "numbered"]);
const receiptMode = enumType(["auto", "on_request"]);

export const departmentSalePolicies = table(
  "department_sale_policies",
  {
    departmentId: id("department_id").primaryKey(),
    orderStart: orderStart("order_start").notNull().default("counter"),
    paidWhen: paidWhen("paid_when").notNull().default("prepay"),
    collectionNumber: collectionNumber("collection_number").notNull().default("none"),
    receiptPrintMode: receiptMode("receipt_print_mode").notNull().default("auto"),
    printTradingName: flag("print_trading_name").notNull().default(true),
  },
  (t) => [
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "department_sale_policies_department_fk",
    }),
    check("department_sale_policies_order_start_ck", enumCheck(t.orderStart)),
    check("department_sale_policies_paid_when_ck", enumCheck(t.paidWhen)),
    check("department_sale_policies_collection_number_ck", enumCheck(t.collectionNumber)),
    check("department_sale_policies_receipt_mode_ck", enumCheck(t.receiptPrintMode)),
  ],
);

export const zoneSalePolicies = table(
  "zone_sale_policies",
  {
    zoneId: id("zone_id").primaryKey(),
    orderStart: orderStart("order_start"),
    paidWhen: paidWhen("paid_when"),
    collectionNumber: collectionNumber("collection_number"),
    receiptPrintMode: receiptMode("receipt_print_mode"),
  },
  (t) => [
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [zoneServicePolicies.zoneId],
      name: "zone_sale_policies_zone_fk",
    }),
    check("zone_sale_policies_order_start_ck", enumCheck(t.orderStart)),
    check("zone_sale_policies_paid_when_ck", enumCheck(t.paidWhen)),
    check("zone_sale_policies_collection_number_ck", enumCheck(t.collectionNumber)),
    check("zone_sale_policies_receipt_mode_ck", enumCheck(t.receiptPrintMode)),
  ],
);

export const saleReceiptHeaders = table(
  "sale_receipt_headers",
  {
    saleId: id("sale_id").primaryKey(),
    departmentId: id("department_id"),
    tradingName: label("trading_name").notNull(),
    printTradingName: flag("print_trading_name").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.saleId],
      foreignColumns: [sales.id],
      name: "sale_receipt_headers_sale_fk",
    }),
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "sale_receipt_headers_department_fk",
    }),
  ],
);

/**
 * The department a device profile orders for and the zone it starts in. A profile with no row has no
 * department restriction. `every_zone` false with no `device_profile_zones` rows allows no zone,
 * so deleting those rows narrows the profile rather than widening it to the whole department.
 * `setProfileServiceAccess` checks the department and zones against the venue's live rows; the
 * keys only refuse an id that exists nowhere.
 */
export const deviceProfileServiceAccess = table(
  "device_profile_service_access",
  {
    deviceProfileId: id("device_profile_id").notNull(),
    departmentId: id("department_id").notNull(),
    everyZone: flag("every_zone").notNull().default(false),
    startingZoneId: id("starting_zone_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceProfileId], name: "device_profile_service_access_pk" }),
    foreignKey({
      columns: [t.deviceProfileId],
      foreignColumns: [deviceProfiles.id],
      name: "device_profile_service_access_profile_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "device_profile_service_access_department_fk",
    }),
    foreignKey({
      columns: [t.startingZoneId],
      foreignColumns: [floorZones.id],
      name: "device_profile_service_access_starting_zone_fk",
    }),
  ],
);

/** The explicit subset of zones a profile with `every_zone` false may order in. */
export const deviceProfileZones = table(
  "device_profile_zones",
  {
    deviceProfileId: id("device_profile_id").notNull(),
    zoneId: id("zone_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceProfileId, t.zoneId], name: "device_profile_zones_pk" }),
    foreignKey({
      columns: [t.deviceProfileId],
      foreignColumns: [deviceProfileServiceAccess.deviceProfileId],
      name: "device_profile_zones_access_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "device_profile_zones_zone_fk",
    }),
  ],
);

export const orderServiceContexts = table(
  "order_service_contexts",
  {
    workingOrderId: id("working_order_id").notNull(),
    locationId: id("location_id").notNull(),
    zoneId: id("zone_id").notNull(),
    departmentId: id("department_id").notNull(),
    // Keep the checked vocabulary's SQL spelling: enumCheck adds spaces and would rebuild the table.
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
      sql`${t.serviceMode} in ('table_tab','prepay','ticket_then_pay')`,
    ),
  ],
);

export const workingLineContexts = table(
  "working_line_contexts",
  {
    workingOrderLineId: id("working_order_line_id").notNull(),
    menuItemId: id("menu_item_id").notNull(),
    menuId: id("menu_id").notNull(),
    // Nullable because its migration adds it to a table that may already hold rows: SQLite refuses
    // `ADD COLUMN ... NOT NULL` with no default on a table holding one (measured on `node:sqlite`,
    // Node v26.7.0; the same statement on an empty table was accepted).
    menuVersionId: id("menu_version_id"),
    menuName: label("menu_name").notNull(),
    departmentId: id("department_id").notNull(),
    departmentName: label("department_name").notNull(),
    categoryName: label("category_name").notNull(),
    unitId: id("unit_id").notNull(),
    unitName: json<Record<string, string>>("unit_name").notNull(),
    unitPrecision: count("unit_precision").notNull(),
    soldInEach: flag("sold_in_each").notNull().default(false),
    hardwareUnit: label("hardware_unit"),
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
    // Refuses a version that does not exist, but not a row naming another menu's version: the
    // two-column key `menu_publications_version_fk` uses would take a table rebuild (CLAUDE.md §3).
    // `recordWorkingLineContexts` takes both from one served offer's menu; the copy copies both.
    foreignKey({
      columns: [t.menuVersionId],
      foreignColumns: [menuVersions.id],
      name: "working_line_contexts_menu_version_fk",
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
