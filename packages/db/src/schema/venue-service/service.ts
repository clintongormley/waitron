import type { AllergenMap, DepartmentReceiptConfig, ReceiptLogoRasters } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { check, foreignKey, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { mediaImages } from "../media/images.js";
import { menuItems } from "../menu/menu.js";
import { menuVersions } from "../menu/publication.js";
import {
  count,
  enumCheck,
  flag,
  id,
  json,
  label,
  newId,
  nowIso,
  table,
  tsString,
} from "../columns.js";
import { deviceProfiles } from "../device-profiles.js";
import { floorZones } from "../floor-zones.js";
import { workingOrderLines } from "../orders.js";
import { sales } from "../sales.js";
import {
  collectionNumber,
  dining,
  diningPolicy,
  orderStart,
  paidWhen,
} from "../sale-rule-types.js";

export const departments = table(
  "departments",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    tradingName: label("trading_name").notNull(),
    isDefault: flag("is_default").notNull().default(false),
    active: flag("active").notNull().default(true),
    needsClearing: flag("needs_clearing").notNull().default(false),
    lateSendNeedsManager: flag("late_send_needs_manager").notNull().default(false),
    orderStart: orderStart("order_start").notNull().default("counter"),
    paidWhen: paidWhen("paid_when").notNull().default("prepay"),
    collectionNumber: collectionNumber("collection_number").notNull().default("none"),
    printTradingName: flag("print_trading_name").notNull().default(true),
    dining: diningPolicy("dining").notNull().default("eat_in"),
    diningStartsAs: dining("dining_starts_as").notNull().default("eat_in"),
    transferDeskProfileId: id("transfer_desk_profile_id"),
    operationDescription: label("operation_description"),
    receiptText:
      json<Omit<DepartmentReceiptConfig, "logo" | "operationDescription">>("receipt_text"),
    receiptLogoImageId: id("receipt_logo_image_id"),
    receiptLogoRasters: json<ReceiptLogoRasters>("receipt_logo_rasters"),
    receiptUpdatedAt: tsString("receipt_updated_at"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    check("departments_order_start_ck", enumCheck(t.orderStart)),
    check("departments_paid_when_ck", enumCheck(t.paidWhen)),
    check("departments_collection_number_ck", enumCheck(t.collectionNumber)),
    check("departments_dining_ck", enumCheck(t.dining)),
    check("departments_dining_starts_as_ck", enumCheck(t.diningStartsAs)),
    foreignKey({
      columns: [t.transferDeskProfileId],
      foreignColumns: [deviceProfiles.id],
      name: "departments_transfer_desk_profile_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.receiptLogoImageId],
      foreignColumns: [mediaImages.id],
      name: "departments_receipt_logo_fk",
    }).onDelete("restrict"),
    uniqueIndex("departments_name_key")
      .on(t.name)
      .where(sql`${t.active} = 1`),
    uniqueIndex("departments_one_default_key")
      .on(t.isDefault)
      .where(sql`${t.isDefault}`),
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
    allergens: json<AllergenMap>("allergens"),
    sentNutrition: json<{ allergens: AllergenMap | null; dietaryDeclarations: string[] }>(
      "sent_nutrition",
    ),
    diet: json<unknown>("diet"),
    dietOverride: json<unknown>("diet_override"),
    latePeriodName: label("late_period_name"),
    // No key yet; the writer takes the id from the same request's session or its manager
    // authorisation.
    lateConfirmedBy: id("late_confirmed_by"),
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
    // two-column key `menu_releases_version_fk` uses would take a table rebuild (CLAUDE.md §3).
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
