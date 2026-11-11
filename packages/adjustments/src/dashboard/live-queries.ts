export const QUERY_DEPENDENCIES = {
  reasons: ["adjustment_reasons"],
  "reason-delete-impact": ["adjustment_reasons"],
  settings: ["settings.adjustments"],
  report: [
    "adjustments",
    "working_orders",
    "working_order_lines",
    "persons",
    "settings.business_day",
    "settings.venue",
    "day_cutover_changes",
  ],
  entries: [
    "adjustments",
    "adjustment_refunds",
    "tender_refunds",
    "working_orders",
    "persons",
    "settings.business_day",
    "settings.venue",
    "day_cutover_changes",
  ],
} as const;
