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
  ]);
  expect(QUERY_DEPENDENCIES.operations).toEqual([
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
    "zone_closed_times",
    "zone_service_policies",
    "floor_zones",
    "routing_cells",
    "routing_cell_periods",
    "categories",
    "category_details",
    "products",
  ]);
});

it("refreshes a zone's floor plan preview when a floor plan, its tables or joins, or a dining table changes", () => {
  expect(QUERY_DEPENDENCIES["floor-plan"]).toEqual([
    "floor_plans",
    "floor_plan_tables",
    "floor_plan_joins",
    "floor_plan_join_tables",
    "dining_tables",
  ]);
});
