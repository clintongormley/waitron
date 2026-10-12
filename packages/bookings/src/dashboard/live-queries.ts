export const QUERY_DEPENDENCIES = {
  bookings: ["bookings"],
  tables: ["dining_tables", "floor_today_tables", "floor_zones", "floor_plan_table_parts"],
} as const;
