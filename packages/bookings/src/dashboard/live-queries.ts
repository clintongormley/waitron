export const QUERY_DEPENDENCIES = {
  bookings: ["bookings"],
  tables: ["dining_tables", "dining_tables.today", "floor_zones"],
} as const;
