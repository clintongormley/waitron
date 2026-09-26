import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  departmentHours,
  departments,
  deviceZoneDefaults,
  orderServiceContexts,
  preparationRoutes,
  workingLineContexts,
  zoneMenus,
  zoneServicePolicies,
} from "./service.js";
import { serviceSettings } from "./settings.js";
import { kitchenNotices } from "./kitchen-notices.js";

/**
 * The Drizzle declarations, read without a database. A foreign key's name exists only here: the
 * generated SQL emits no `CONSTRAINT` clause for one, so `../migrations.test.ts` can read back a
 * key's shape but never its name.
 */
const EXPECTED: Record<
  string,
  {
    table: SQLiteTable;
    foreignKeys: string[];
    checks: string[];
    indexes: string[];
    uniqueConstraints: string[];
    primaryKeys: string[];
  }
> = {
  departments: {
    table: departments,
    foreignKeys: ["departments_location_fk"],
    checks: ["departments_service_mode_ck"],
    indexes: ["departments_one_default_per_location_key"],
    uniqueConstraints: ["departments_location_name_key"],
    primaryKeys: [],
  },
  zone_service_policies: {
    table: zoneServicePolicies,
    foreignKeys: [
      "zone_service_policies_location_fk",
      "zone_service_policies_zone_fk",
      "zone_service_policies_department_fk",
      "zone_service_policies_default_menu_fk",
      "zone_service_policies_default_allowed_fk",
    ],
    checks: ["zone_service_policies_mode_ck"],
    indexes: ["zone_service_policies_one_counter_default_key"],
    uniqueConstraints: [],
    primaryKeys: ["zone_service_policies_pk"],
  },
  zone_menus: {
    table: zoneMenus,
    foreignKeys: ["zone_menus_zone_fk", "zone_menus_menu_fk"],
    checks: [],
    indexes: ["zone_menus_order_idx"],
    uniqueConstraints: [],
    primaryKeys: ["zone_menus_pk"],
  },
  device_zone_defaults: {
    table: deviceZoneDefaults,
    foreignKeys: ["device_zone_defaults_device_fk", "device_zone_defaults_zone_fk"],
    checks: [],
    indexes: [],
    uniqueConstraints: [],
    primaryKeys: ["device_zone_defaults_pk"],
  },
  preparation_routes: {
    table: preparationRoutes,
    foreignKeys: [
      "preparation_routes_location_fk",
      "preparation_routes_zone_fk",
      "preparation_routes_category_fk",
      "preparation_routes_product_fk",
      "preparation_routes_station_fk",
    ],
    checks: ["preparation_routes_subject_ck", "preparation_routes_target_ck"],
    indexes: [
      "preparation_routes_lookup_idx",
      "preparation_routes_zone_product_key",
      "preparation_routes_zone_category_key",
      "preparation_routes_venue_product_key",
      "preparation_routes_venue_category_key",
    ],
    uniqueConstraints: [],
    primaryKeys: [],
  },
  department_hours: {
    table: departmentHours,
    foreignKeys: ["department_hours_department_fk"],
    checks: ["department_hours_weekday_ck"],
    indexes: [],
    uniqueConstraints: ["department_hours_interval_key"],
    primaryKeys: [],
  },
  order_service_contexts: {
    table: orderServiceContexts,
    foreignKeys: [
      "order_service_contexts_order_fk",
      "order_service_contexts_zone_fk",
      "order_service_contexts_department_fk",
    ],
    checks: ["order_service_contexts_mode_ck"],
    indexes: [],
    uniqueConstraints: [],
    primaryKeys: ["order_service_contexts_pk"],
  },
  working_line_contexts: {
    table: workingLineContexts,
    foreignKeys: ["working_line_contexts_line_fk", "working_line_contexts_menu_item_fk"],
    checks: [
      "working_line_contexts_unit_precision_ck",
      "working_line_contexts_hardware_unit_ck",
      "working_line_contexts_vat_class_ck",
    ],
    indexes: [],
    uniqueConstraints: [],
    primaryKeys: ["working_line_contexts_pk"],
  },
  service_settings: {
    table: serviceSettings,
    foreignKeys: [],
    checks: ["service_settings_singleton_ck"],
    indexes: [],
    uniqueConstraints: [],
    primaryKeys: [],
  },
  kitchen_notices: {
    table: kitchenNotices,
    foreignKeys: ["kitchen_notices_station_fk", "kitchen_notices_order_fk"],
    checks: ["kitchen_notices_kind_ck", "kitchen_notices_quantity_ck"],
    indexes: ["kitchen_notices_open_idx"],
    uniqueConstraints: [],
    primaryKeys: [],
  },
};

describe("venue-service schema", () => {
  // Without it, an emptied EXPECTED would leave the loop below passing over nothing.
  it("covers all ten of the package's tables", () => {
    expect(Object.keys(EXPECTED)).toHaveLength(10);
  });

  for (const [name, expected] of Object.entries(EXPECTED)) {
    it(`declares ${name}'s keys, checks and indexes`, () => {
      const config = getTableConfig(expected.table);
      expect(config.name).toBe(name);
      expect(config.foreignKeys.map((key) => key.getName())).toEqual(expected.foreignKeys);
      expect(config.checks.map((check) => check.name)).toEqual(expected.checks);
      expect(config.indexes.map((index) => index.config.name)).toEqual(expected.indexes);
      expect(config.uniqueConstraints.map((unique) => unique.getName())).toEqual(
        expected.uniqueConstraints,
      );
      expect(config.primaryKeys.map((key) => key.getName())).toEqual(expected.primaryKeys);
    });
  }

  // Dropping a predicate leaves the index's name unchanged, so the per-table assertions above
  // cannot see it.
  it("keeps every partial index partial", () => {
    const partial = [
      ...getTableConfig(departments).indexes,
      ...getTableConfig(zoneServicePolicies).indexes,
      ...getTableConfig(preparationRoutes).indexes,
      ...getTableConfig(kitchenNotices).indexes,
    ].filter((index) => index.config.where !== undefined);
    expect(partial.map((index) => [index.config.name, index.config.unique])).toEqual([
      ["departments_one_default_per_location_key", true],
      ["zone_service_policies_one_counter_default_key", true],
      ["preparation_routes_zone_product_key", true],
      ["preparation_routes_zone_category_key", true],
      ["preparation_routes_venue_product_key", true],
      ["preparation_routes_venue_category_key", true],
      ["kitchen_notices_open_idx", false],
    ]);
  });
});
