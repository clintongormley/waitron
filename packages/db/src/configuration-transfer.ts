export const CORE_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [
    { name: "catalogues" },
    { name: "kitchen_stations", locationColumns: ["location_id"] },
    { name: "kitchen_courses", locationColumns: ["location_id"] },
    { name: "categories" },
    // The catalogue module's `afterImport` sets `name_key` from the name.
    { name: "products", omit: ["name_key"] },
    { name: "location_catalogues", locationColumns: ["location_id"] },
    { name: "ingredients" },
    { name: "recipe_lines" },
    { name: "canvases" },
    { name: "device_profiles" },
    { name: "floor_zones", locationColumns: ["location_id"] },
    { name: "table_service_statuses" },
    {
      name: "dining_tables",
      locationColumns: ["location_id"],
      omit: ["needs_clearing_since"],
    },
    { name: "watchers", locationColumns: ["location_id"] },
    { name: "watcher_stations" },
    { name: "watcher_zones" },
    {
      name: "print_agents",
      locationColumns: ["location_id"],
      // `node_id` names a node of the exporting venue; the importing venue makes its own. The setup
      // page's address and port are the exporting machine's; the agent reports its own with each pull.
      omit: ["token_hash", "last_seen_at", "host", "node_id", "setup_url", "setup_port"],
      reconnect: true,
    },
    {
      name: "printers",
      locationColumns: ["location_id"],
      omit: ["poll_token_hash"],
      reconnect: true,
    },
    { name: "device_profile_printers" },
    { name: "station_printers" },
    { name: "watcher_printers" },
    { name: "tenant_themes" },
    { name: "tenant_receipts" },
  ],
} as const;
