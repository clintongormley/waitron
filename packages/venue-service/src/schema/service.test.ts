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

/**
 * The Drizzle table declarations themselves: evaluated in JavaScript, so no database is involved.
 *
 * `getTableConfig` comes from `drizzle-orm/sqlite-core`. The `pg-core` one it used to come from
 * threw `TypeError: Cannot convert undefined or null to object` on every table here, which is a
 * CRASH and not a failure — this file asserted nothing at all, so neither constraint name it listed
 * was guarded by anything.
 *
 * What it pins, and what it does NOT — the two are different, and measuring them apart is the
 * point. A FOREIGN KEY's name lives nowhere but here: `drizzle/0000_baseline.sql` emits every key
 * with a bare `FOREIGN KEY (...) REFERENCES ...` and no `CONSTRAINT` clause, and `pragma
 * foreign_key_list` returns no name column at all (measured on node:sqlite, Node v26.7.0: its row
 * keys are id, seq, table, from, to, on_update, on_delete, match). A refused write says
 * `FOREIGN KEY constraint failed` and stops. So `../migrations.test.ts` can ask a migrated database
 * for a key's SHAPE and never for what it is called, and it points here for the name.
 *
 * A CHECK is the opposite and was asserted here the wrong way round until it was run: the generated
 * SQL DOES name each one (`CONSTRAINT "departments_service_mode_ck" CHECK(...)`) and SQLite reports
 * `CHECK constraint failed: <name>` when one fires — measured in the same probe. So a check name is
 * reachable from the engine; what this file adds for those is that the DECLARATION still carries
 * the name, which is what keeps the generated SQL naming it.
 *
 * Each list is asserted with `toEqual`, never `toContain`: a DELETED constraint is the change this
 * has to catch, and `toContain` cannot see one.
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
};

describe("venue-service schema", () => {
  // The positive control: without it a rewrite that emptied EXPECTED would leave the loop below
  // passing over nothing.
  it("covers all eight of the package's tables", () => {
    expect(Object.keys(EXPECTED)).toHaveLength(8);
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

  // Six indexes are PARTIAL, and each is partial for a reason the schema states: a route the
  // predicate excludes is outside its index entirely, and that is what lets a venue-wide route and a
  // zone route for one subject both exist. Dropping a predicate leaves the name unchanged, so the
  // per-table assertions above cannot see it.
  it("keeps every partial index partial", () => {
    const partial = [
      ...getTableConfig(departments).indexes,
      ...getTableConfig(zoneServicePolicies).indexes,
      ...getTableConfig(preparationRoutes).indexes,
    ].filter((index) => index.config.where !== undefined);
    expect(partial.map((index) => [index.config.name, index.config.unique])).toEqual([
      ["departments_one_default_per_location_key", true],
      ["zone_service_policies_one_counter_default_key", true],
      ["preparation_routes_zone_product_key", true],
      ["preparation_routes_zone_category_key", true],
      ["preparation_routes_venue_product_key", true],
      ["preparation_routes_venue_category_key", true],
    ]);
  });
});
