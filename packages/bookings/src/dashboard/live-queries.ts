export const QUERY_DEPENDENCIES = {
  bookings: ["bookings"],
  tables: ["dining_tables", "floor_zones"],
} as const;
