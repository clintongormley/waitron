const record = [
  "time_entries",
  "pay_period_closures",
  "attendance_questions",
  "attendance_response_commands",
  "persons",
  "settings.business_day",
  "settings.venue",
  "day_cutover_changes",
] as const;

export const QUERY_DEPENDENCIES = {
  lookups: ["persons"],
  queue: record,
  day: record,
  hours: [...record, "pay_period_settings"],
  ownInbox: [...record, "pay_period_settings"],
  ownDay: [...record, "pay_period_settings"],
} as const;
