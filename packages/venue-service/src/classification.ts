import { appendOnly, classify, type ClassifiedTable } from "@waitron/sync-enrolment";
import type { ChangeSource } from "@waitron/shared";

const STATE =
  "venue service configuration or live order state; copied to a standby, never drained back";

export const VENUE_SERVICE_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("departments", "state", STATE),
  classify("department_transfer_desks", "state", STATE),
  classify("department_transfer_destinations", "state", STATE),
  classify("department_transfer_requests", "state", STATE),
  classify("department_sale_policies", "state", STATE),
  classify("zone_service_policies", "state", STATE),
  classify("zone_sale_policies", "state", STATE),
  appendOnly("sale_receipt_headers", "ledger", "receipt header as issued for a sale"),
  classify("department_menus", "state", STATE),
  classify("department_all_day_menus", "state", STATE),
  classify("zone_all_day_menus", "state", STATE),
  classify("menu_periods", "state", STATE),
  classify("menu_day_timetables", "state", STATE),
  classify("menu_slots", "state", STATE),
  classify("zone_period_menus", "state", STATE),
  classify("device_profile_service_access", "state", STATE),
  classify("device_profile_zones", "state", STATE),
  classify("device_profile_stations", "state", STATE),
  classify("device_profile_watchers", "state", STATE),
  classify("station_claims", "state", STATE),
  classify("station_fallbacks", "state", STATE),
  classify("station_day_states", "state", STATE),
  classify("route_exceptions", "state", STATE),
  classify("order_service_contexts", "state", STATE),
  classify("working_line_contexts", "state", STATE),
  classify("service_settings", "state", STATE),
  classify("kitchen_notices", "state", STATE),
  classify("hours_week_cells", "state", STATE),
  classify("hours_week_periods", "state", STATE),
  classify("special_dates", "state", STATE),
  classify("special_date_hours", "state", STATE),
  classify("special_date_hours_periods", "state", STATE),
  classify("holiday_geographies", "state", STATE),
  classify("local_holidays", "state", STATE),
];

export const VENUE_SERVICE_CHANGE_SOURCES: readonly ChangeSource[] =
  VENUE_SERVICE_CLASSIFICATION.map(({ table }) => ({ table, type: table }));
