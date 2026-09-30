export const QUERY_DEPENDENCIES = {
  reasons: ["adjustment_reasons"],
  report: ["adjustments", "working_orders", "working_order_lines", "persons", "locations"],
  entries: ["adjustments", "working_orders", "persons", "locations"],
} as const;
