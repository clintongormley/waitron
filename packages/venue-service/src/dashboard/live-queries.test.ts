import { expect, it } from "vitest";
import { QUERY_DEPENDENCIES } from "./live-queries.js";

it("declares no health query: Prep stations reads no live kitchen numbers", () => {
  expect(Object.keys(QUERY_DEPENDENCIES)).not.toContain("health");
});

it("refreshes the routing grid and the operations screen on a routing cell change", () => {
  expect(QUERY_DEPENDENCIES.routing).toEqual([
    "kitchen_timing_defaults",
    "kitchen_station_timing",
    "routing_cells",
    "kitchen_stations",
    "categories",
    "category_details",
    "products",
    "floor_zones",
    "station_printers",
    "printers",
    "devices",
    "device_kitchen_screens",
    "device_kitchen_screen_stations",
    "device_kitchen_screen_zones",
    "device_kitchen_screen_removals",
    "device_profile_kitchen_screens",
    "device_profile_kitchen_screen_stations",
    "device_profile_kitchen_screen_zones",
    "station_day_states",
    "special_dates",
    "locations",
    "location_business_day_settings",
    "location_day_cutover_changes",
    "routing_cell_periods",
    "menu_periods",
    "menu_period_staff_menus",
    "menu_slots",
    "menu_day_timetables",
    "departments",
    "zone_service_policies",
    "sections",
    "section_members",
    "catalogues",
    "seasons",
    "department_days",
    "department_day_ranges",
    "zone_days",
    "zone_day_ranges",
    "special_days",
    "special_day_dates",
  ]);
  expect(QUERY_DEPENDENCIES.operations).toEqual([
    "department_receipts",
    "locations",
    "location_business_day_settings",
    "location_day_cutover_changes",
    "departments",
    "zone_service_policies",
    "department_sale_policies",
    "zone_sale_policies",
    "menu_periods",
    "menu_period_staff_menus",
    "menu_day_timetables",
    "menu_slots",
    "routing_cells",
    "service_settings",
    "catalogues",
    "categories",
    "kitchen_stations",
    "floor_zones",
    "products",
    "content_languages",
    "menu_details",
    "sections",
    "section_members",
    "menu_items",
    "seasons",
    "department_days",
    "department_day_ranges",
    "zone_days",
    "zone_day_ranges",
    "special_days",
    "special_day_dates",
  ]);
});

it("refreshes Opening hours from its periods, ranges, dates, menu names and the routing that names a period", () => {
  expect(QUERY_DEPENDENCIES["opening-hours"]).toEqual([
    "menu_periods",
    "menu_period_staff_menus",
    "menu_day_timetables",
    "menu_slots",
    "special_dates",
    "departments",
    "catalogues",
    "locations",
    "location_business_day_settings",
    "location_day_cutover_changes",
    "zone_closed_times",
    "zone_service_policies",
    "floor_zones",
    "routing_cells",
    "routing_cell_periods",
    "categories",
    "category_details",
    "products",
    "seasons",
    "department_days",
    "department_day_ranges",
    "zone_days",
    "zone_day_ranges",
    "special_days",
    "special_day_dates",
  ]);
});

it("refreshes a zone's floor plan preview when a floor plan, its tables or joins, or a dining table changes", () => {
  expect(QUERY_DEPENDENCIES["floor-plan"]).toEqual([
    "floor_plans",
    "floor_plan_tables",
    "floor_plan_joins",
    "floor_plan_join_tables",
    "dining_tables",
    "floor_zones",
  ]);
});

it.each(["zone-delete-impact", "department-delete-impact"] as const)(
  "%s names every floor, live-work, configuration and display source without optional bookings",
  (interest) => {
    expect(QUERY_DEPENDENCIES[interest]).toEqual([
      "floor_zones",
      "dining_tables",
      "floor_plans",
      "floor_plan_tables",
      "floor_plan_joins",
      "floor_plan_join_tables",
      "floor_reset_tables",
      "floor_reset_joins",
      "floor_reset_join_tables",
      "floor_today_zones",
      "floor_today_tables",
      "floor_today_joins",
      "floor_today_join_tables",
      "parties",
      "party_tables",
      "working_orders",
      "working_order_lines",
      "ticket_items",
      "order_service_contexts",
      "departments",
      "device_profiles",
      "devices",
      "device_profile_service_access",
      "device_profile_zones",
      "device_kitchen_screens",
      "device_kitchen_screen_stations",
      "device_kitchen_screen_zones",
      "device_kitchen_screen_removals",
      "device_profile_kitchen_screens",
      "device_profile_kitchen_screen_stations",
      "device_profile_kitchen_screen_zones",
      "routing_cells",
      "routing_cell_periods",
      "zone_service_policies",
      "zone_sale_policies",
      "zone_closed_times",
      "zone_extensions",
      "department_sale_policies",
      "menu_periods",
      "menu_period_staff_menus",
      "menu_day_timetables",
      "menu_slots",
      "department_days",
      "department_day_ranges",
      "zone_days",
      "zone_day_ranges",
      "period_extensions",
      "department_transfer_desks",
      "department_transfer_destinations",
      "department_transfer_requests",
    ]);
  },
);

it.each(["opening-hours", "operations", "routing", "named-days"] as const)(
  "refreshes %s when a season or a season week changes",
  (interest) => {
    expect(QUERY_DEPENDENCIES[interest]).toEqual(
      expect.arrayContaining([
        "seasons",
        "department_days",
        "department_day_ranges",
        "zone_days",
        "zone_day_ranges",
      ]),
    );
  },
);

it.each(["opening-hours", "operations", "routing", "named-days", "holidays"] as const)(
  "refreshes %s when a special day or one of its dates changes",
  (interest) => {
    expect(QUERY_DEPENDENCIES[interest]).toEqual(
      expect.arrayContaining(["special_days", "special_day_dates"]),
    );
  },
);
