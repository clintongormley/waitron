export const QUERY_DEPENDENCIES = {
  reasons: ["adjustment_reasons"],
  settings: ["adjustment_settings"],
  report: [
    "adjustments",
    "working_orders",
    "working_order_lines",
    "persons",
    "locations",
    "location_business_day_settings",
    "location_day_cutover_changes",
  ],
  entries: [
    "adjustments",
    "working_orders",
    "persons",
    "locations",
    "location_business_day_settings",
    "location_day_cutover_changes",
  ],
} as const;
