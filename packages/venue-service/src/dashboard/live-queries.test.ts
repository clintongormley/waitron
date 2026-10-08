import { expect, it } from "vitest";
import { QUERY_DEPENDENCIES } from "./live-queries.js";

it("declares the health sources for counts, names, context, thresholds and output problems", () => {
  expect(QUERY_DEPENDENCIES.health).toEqual([
    "kitchen_stations",
    "kitchen_timing_defaults",
    "kitchen_station_timing",
    "ticket_items",
    "working_order_lines",
    "working_orders",
    "party_tables",
    "dining_tables",
    "devices",
    "station_printers",
    "printers",
    "print_jobs",
  ]);
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
    "watchers",
    "watcher_stations",
    "watcher_zones",
    "watcher_printers",
    "station_fallbacks",
    "station_day_states",
    "hours_week_cells",
    "hours_week_periods",
    "special_dates",
    "special_date_hours",
    "special_date_hours_periods",
    "locations",
  ]);
  expect(QUERY_DEPENDENCIES.operations).toEqual([
    "departments",
    "zone_service_policies",
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

it("refreshes Opening hours from its periods, ranges, dates and menu names", () => {
  expect(QUERY_DEPENDENCIES["opening-hours"]).toEqual([
    "menu_periods",
    "menu_period_staff_menus",
    "menu_day_timetables",
    "menu_slots",
    "special_dates",
    "departments",
    "catalogues",
    "locations",
  ]);
});
