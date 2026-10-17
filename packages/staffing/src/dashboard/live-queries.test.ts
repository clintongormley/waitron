import { describe, expect, it } from "vitest";
import { QUERY_DEPENDENCIES } from "./live-queries.js";

describe("QUERY_DEPENDENCIES", () => {
  it("reads the staff roles again when a role, a holder or a person changes", () => {
    expect(QUERY_DEPENDENCIES["staff-roles"]).toEqual([
      "staff_roles",
      "person_staff_roles",
      "persons",
    ]);
  });

  it("reads a delete's impact again when a role, a holder, a painted block, a shift or a person changes", () => {
    expect(QUERY_DEPENDENCIES["staff-role-delete-impact"]).toEqual([
      "staff_roles",
      "person_staff_roles",
      "staffing_blocks",
      "shift_assignments",
      "persons",
    ]);
  });

  it("reads the month again when its paint, a staff role, an area, a season, a special day, a holiday area, the location or the day's changeover changes", () => {
    expect(QUERY_DEPENDENCIES["staffing-month"]).toEqual([
      "shifts",
      "roster_versions",
      "shift_assignments",
      "staffing_days",
      "staffing_blocks",
      "staff_roles",
      "departments",
      "kitchen_stations",
      "tenants",
      "locations",
      "location_day_cutover_changes",
      "holiday_geographies",
      "seasons",
      "special_days",
      "special_day_dates",
      "department_days",
      "department_day_ranges",
      "zone_days",
      "zone_day_ranges",
    ]);
    expect(Object.keys(QUERY_DEPENDENCIES)).toEqual([
      "staff-roles",
      "staff-role-delete-impact",
      "staffing-month",
      "rota-warnings",
      "rota",
    ]);
  });
});
