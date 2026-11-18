import { expect, it } from "vitest";
import { CALENDAR_MONTH_PLAN_READS, QUERY_DEPENDENCIES } from "./live-queries.js";

it("declares no health query: Prep stations reads no live kitchen numbers", () => {
  expect(Object.keys(QUERY_DEPENDENCIES)).not.toContain("health");
});

it("refreshes the routing grid and the operations screen on a routing cell change", () => {
  expect(QUERY_DEPENDENCIES.routing).toEqual([
    "routing_cells",
    "kitchen_stations",
    "categories",

    "products",
    "floor_zones",
    "printers",
    "devices",
    "device_profile_kitchen_screens",
    "device_profile_kitchen_screen_stations",
    "device_profile_kitchen_screen_zones",
    "settings.business_day",
    "settings.venue",
    "day_cutover_changes",
    "routing_cell_periods",
    "menu_periods",
    "departments",
    "sections",
    "section_members",
    "menus",
    "seasons",
    "opening_hours",
    "special_days",
    "special_day_dates",
  ]);
  expect(QUERY_DEPENDENCIES.operations).toEqual([
    "taxpayer",
    "settings.business_day",
    "settings.venue",
    "day_cutover_changes",
    "departments",
    "floor_zones",
    "menu_periods",
    "routing_cells",
    "menus",
    "categories",
    "kitchen_stations",
    "products",

    "sections",
    "section_members",
    "menu_items",
    "seasons",
    "opening_hours",
    "special_days",
    "special_day_dates",
    "service_steps",
    "department_courses",
    "kitchen_courses",
  ]);
});

it("refreshes Opening hours from its periods, ranges, dates, menu names and the routing that names a period", () => {
  expect(QUERY_DEPENDENCIES["opening-hours"]).toEqual([
    "menu_periods",
    "departments",
    "menus",
    "settings.business_day",
    "settings.venue",
    "day_cutover_changes",
    "floor_zones",
    "routing_cells",
    "routing_cell_periods",
    "categories",

    "products",
    "seasons",
    "opening_hours",
    "special_days",
    "special_day_dates",
  ]);
});

it.each(["zone-delete-impact", "department-delete-impact"] as const)(
  "%s names every floor, live-work, configuration and display source without optional bookings",
  (interest) => {
    expect(QUERY_DEPENDENCIES[interest]).toEqual([
      "floor_zones",
      "floor_zones.today",
      "dining_tables",
      "dining_tables.today",
      "floor_plans",
      "floor_plan_tables",
      "floor_reset_tables",
      "table_merges",
      "parties",
      "party_tables",
      "working_orders",
      "working_order_lines",
      "ticket_items",
      "departments",
      "device_profiles",
      "devices",
      "device_profile_kitchen_screens",
      "device_profile_kitchen_screen_stations",
      "device_profile_kitchen_screen_zones",
      "routing_cells",
      "routing_cell_periods",
      "service_steps",
      "menu_periods",
      "opening_hours",
      "department_transfer_destinations",
      "department_transfer_requests",
      "floor_plan_sets",
    ]);
  },
);

it.each(["opening-hours", "operations", "routing", "named-days"] as const)(
  "refreshes %s when a season or a season week changes",
  (interest) => {
    expect(QUERY_DEPENDENCIES[interest]).toEqual(
      expect.arrayContaining(["seasons", "opening_hours"]),
    );
  },
);

it.each(["opening-hours", "operations", "routing", "named-days"] as const)(
  "refreshes %s when a special day or one of its dates changes",
  (interest) => {
    expect(QUERY_DEPENDENCIES[interest]).toEqual(
      expect.arrayContaining(["special_days", "special_day_dates"]),
    );
  },
);

it("refreshes a station's delete impact when a table or group is named for today", () => {
  expect(QUERY_DEPENDENCIES["station-delete-impact"]).toEqual(
    expect.arrayContaining(["dining_tables", "dining_tables.today", "table_merges"]),
  );
});

it("reads the Opening hours month again on a change to anything its plan reads", () => {
  const watched: readonly string[] = QUERY_DEPENDENCIES["opening-hours-month"];
  expect(CALENDAR_MONTH_PLAN_READS.filter((table) => !watched.includes(table))).toEqual([]);
});

it("reads a period's floor plan choices again on a set, zone or table change, not on a save that only moves or rearranges tables", () => {
  expect(QUERY_DEPENDENCIES["period-floor-plans"]).toEqual([
    "departments",
    "floor_zones",
    "floor_plan_tables",
    "floor_plan_sets",
  ]);
});
