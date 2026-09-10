import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
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

describe("venue-service schema", () => {
  it("builds every table's constraints and indexes", () => {
    const tables = [
      departments,
      zoneServicePolicies,
      zoneMenus,
      deviceZoneDefaults,
      preparationRoutes,
      departmentHours,
      orderServiceContexts,
      workingLineContexts,
    ];
    for (const table of tables) {
      const config = getTableConfig(table);
      expect(config.name).toBeTruthy();
      expect(config.foreignKeys.length).toBeGreaterThan(0);
    }
  });

  it("constrains the two policy modes and route subject and target", () => {
    expect(getTableConfig(departments).checks.map((check) => check.name)).toContain(
      "departments_service_mode_ck",
    );
    expect(getTableConfig(zoneServicePolicies).checks.map((check) => check.name)).toContain(
      "zone_service_policies_mode_ck",
    );
    expect(getTableConfig(preparationRoutes).checks.map((check) => check.name)).toEqual(
      expect.arrayContaining(["preparation_routes_subject_ck", "preparation_routes_target_ck"]),
    );
  });
});
