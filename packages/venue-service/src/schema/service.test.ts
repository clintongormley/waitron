import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  departmentSalePolicies,
  departments,
  deviceProfileServiceAccess,
  deviceProfileStations,
  deviceProfileWatchers,
  deviceProfileZones,
  orderServiceContexts,
  saleReceiptHeaders,
  workingLineContexts,
  zoneMenus,
  zoneSalePolicies,
  zoneServicePolicies,
} from "./service.js";
import { serviceSettings } from "./settings.js";
import { kitchenNotices } from "./kitchen-notices.js";
import { routeExceptions, stationClaims } from "./routing.js";
import { stationDayStates, stationFallbacks } from "./station-times.js";

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
  department_sale_policies: {
    table: departmentSalePolicies,
    foreignKeys: ["department_sale_policies_department_fk"],
    checks: [
      "department_sale_policies_paid_when_ck",
      "department_sale_policies_collection_number_ck",
      "department_sale_policies_receipt_mode_ck",
    ],
    indexes: [],
    uniqueConstraints: [],
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
  zone_sale_policies: {
    table: zoneSalePolicies,
    foreignKeys: ["zone_sale_policies_zone_fk"],
    checks: [
      "zone_sale_policies_paid_when_ck",
      "zone_sale_policies_collection_number_ck",
      "zone_sale_policies_receipt_mode_ck",
    ],
    indexes: [],
    uniqueConstraints: [],
    primaryKeys: [],
  },
  sale_receipt_headers: {
    table: saleReceiptHeaders,
    foreignKeys: ["sale_receipt_headers_sale_fk", "sale_receipt_headers_department_fk"],
    checks: [],
    indexes: [],
    uniqueConstraints: [],
    primaryKeys: [],
  },
  zone_menus: {
    table: zoneMenus,
    foreignKeys: ["zone_menus_zone_fk", "zone_menus_menu_fk"],
    checks: [],
    indexes: ["zone_menus_order_idx"],
    uniqueConstraints: [],
    primaryKeys: ["zone_menus_pk"],
  },
  device_profile_service_access: {
    table: deviceProfileServiceAccess,
    foreignKeys: [
      "device_profile_service_access_profile_fk",
      "device_profile_service_access_department_fk",
      "device_profile_service_access_starting_zone_fk",
    ],
    checks: [],
    indexes: [],
    uniqueConstraints: [],
    primaryKeys: ["device_profile_service_access_pk"],
  },
  device_profile_zones: {
    table: deviceProfileZones,
    foreignKeys: ["device_profile_zones_access_fk", "device_profile_zones_zone_fk"],
    checks: [],
    indexes: [],
    uniqueConstraints: [],
    primaryKeys: ["device_profile_zones_pk"],
  },
  device_profile_stations: {
    table: deviceProfileStations,
    foreignKeys: ["device_profile_stations_profile_fk", "device_profile_stations_station_fk"],
    checks: [],
    indexes: [],
    uniqueConstraints: [],
    primaryKeys: ["device_profile_stations_pk"],
  },
  device_profile_watchers: {
    table: deviceProfileWatchers,
    foreignKeys: ["device_profile_watchers_profile_fk", "device_profile_watchers_watcher_fk"],
    checks: [],
    indexes: [],
    uniqueConstraints: [],
    primaryKeys: ["device_profile_watchers_pk"],
  },
  station_claims: {
    table: stationClaims,
    foreignKeys: [
      "station_claims_location_fk",
      "station_claims_category_fk",
      "station_claims_station_fk",
    ],
    checks: ["station_claims_target_ck"],
    indexes: ["station_claims_folder_key"],
    uniqueConstraints: [],
    primaryKeys: [],
  },
  station_fallbacks: {
    table: stationFallbacks,
    foreignKeys: ["station_fallbacks_station_fk", "station_fallbacks_fallback_fk"],
    checks: ["station_fallbacks_not_self_ck"],
    indexes: [],
    uniqueConstraints: [],
    primaryKeys: [],
  },
  station_day_states: {
    table: stationDayStates,
    foreignKeys: ["station_day_states_station_fk"],
    checks: [],
    indexes: ["station_day_states_day_key"],
    uniqueConstraints: [],
    primaryKeys: [],
  },
  route_exceptions: {
    table: routeExceptions,
    foreignKeys: [
      "route_exceptions_location_fk",
      "route_exceptions_zone_fk",
      "route_exceptions_category_fk",
      "route_exceptions_product_fk",
      "route_exceptions_station_fk",
    ],
    checks: [
      "route_exceptions_what_ck",
      "route_exceptions_condition_ck",
      "route_exceptions_target_ck",
    ],
    indexes: ["route_exceptions_order_idx"],
    uniqueConstraints: [],
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
    foreignKeys: [
      "working_line_contexts_line_fk",
      "working_line_contexts_menu_item_fk",
      "working_line_contexts_menu_version_fk",
    ],
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
    checks: ["service_settings_singleton_ck", "service_settings_kitchen_ticket_grouping_ck"],
    indexes: [],
    uniqueConstraints: [],
    primaryKeys: [],
  },
  kitchen_notices: {
    table: kitchenNotices,
    foreignKeys: ["kitchen_notices_station_fk", "kitchen_notices_order_fk"],
    checks: [
      "kitchen_notices_kind_ck",
      "kitchen_notices_quantity_ck",
      "kitchen_notices_moved_to_ck",
      "kitchen_notices_rerouted_to_ck",
      "kitchen_notices_direction_ck",
      "kitchen_notices_direction_kind_ck",
      "kitchen_notices_cancelled_extra_kind_ck",
    ],
    indexes: ["kitchen_notices_open_idx"],
    uniqueConstraints: [],
    primaryKeys: [],
  },
};

describe("venue-service schema", () => {
  // Without it, an emptied EXPECTED would leave the loop below passing over nothing.
  it("covers the eighteen tables it lists", () => {
    expect(Object.keys(EXPECTED)).toHaveLength(18);
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
      ...getTableConfig(kitchenNotices).indexes,
    ].filter((index) => index.config.where !== undefined);
    expect(partial.map((index) => [index.config.name, index.config.unique])).toEqual([
      ["departments_one_default_per_location_key", true],
      ["zone_service_policies_one_counter_default_key", true],
      ["kitchen_notices_open_idx", false],
    ]);
  });
});
