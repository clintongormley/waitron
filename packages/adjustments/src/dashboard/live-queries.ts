export const QUERY_DEPENDENCIES = {
  reasons: ["adjustment_reasons"],
  // `computeAdjustmentReport` (../reports.ts): the adjustments on bills opened in the range, the
  // lines credited on those bills, the names from `persons`, and the clock from `locations`.
  report: ["adjustments", "working_orders", "working_order_lines", "persons", "locations"],
  // `listAdjustmentEntries`, the same file: the report's reads less the credited lines.
  entries: ["adjustments", "working_orders", "persons", "locations"],
} as const;
