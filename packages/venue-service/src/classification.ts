import type { ChangeSource } from "@waitron/shared";

/** The tables this module's code owns. They live in core's set, which classifies them. */
export const VENUE_SERVICE_TABLES = [
  "departments",
  "department_courses",
  "service_steps",
  "service_step_completions",
  "department_transfer_destinations",
  "department_transfer_requests",
  "sale_receipt_headers",
  "menu_periods",
  "device_zone_selections",
  "device_zone_selection_zones",
  "routing_cells",
  "routing_cell_periods",
  "kitchen_notices",
  "order_kitchen_notes",
  "party_allergy_guests",
  "allergy_line_ticks",
  "seasons",
  "special_days",
  "special_day_dates",
  "opening_hours",
] as const;

export const VENUE_SERVICE_CHANGE_SOURCES: readonly ChangeSource[] = VENUE_SERVICE_TABLES.map(
  (table) => ({
    table,
    type: table,
  }),
);
