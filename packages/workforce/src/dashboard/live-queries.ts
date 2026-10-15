const record = [
  "time_entries",
  "pay_period_closures",
  "attendance_questions",
  "attendance_response_commands",
  "persons",
  "locations",
  "location_day_cutover_changes",
  "location_business_day_settings",
] as const;

export const QUERY_DEPENDENCIES = {
  lookups: ["persons", "locations"],
  queue: record,
  day: record,
} as const;
