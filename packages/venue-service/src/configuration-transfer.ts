export const VENUE_SERVICE_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [
    { name: "departments", locationColumns: ["location_id"] },
    { name: "zone_service_policies", locationColumns: ["location_id"] },
    { name: "zone_menus" },
    { name: "preparation_routes", locationColumns: ["location_id"] },
    { name: "station_claims", locationColumns: ["location_id"] },
    { name: "route_exceptions", locationColumns: ["location_id"] },
    { name: "department_hours" },
    { name: "service_settings" },
  ],
} as const;
