import { AppError } from "@waitron/shared";
import "./errors.js";
import { isStatusColor } from "./status-color.js";

/** Refuses (`setup.request_invalid`) a table service status whose colour a save would refuse. */
export function validateCoreConfiguration(
  tables: Readonly<Record<string, readonly Record<string, unknown>[]>>,
): void {
  for (const row of tables.table_service_statuses ?? [])
    if (!isStatusColor(row.color))
      throw new AppError("setup.request_invalid", { field: "table_service_statuses.color" });
}

export const CORE_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [
    { name: "catalogues" },
    {
      name: "kitchen_stations",
      locationColumns: ["location_id"],
      omit: ["warm_after_minutes", "overdue_after_minutes", "forgotten_after_minutes"],
    },
    { name: "kitchen_timing_defaults", locationColumns: ["location_id"] },
    { name: "kitchen_station_timing" },
    { name: "kitchen_courses", locationColumns: ["location_id"] },
    { name: "categories" },
    // The catalogue module's `afterImport` sets `name_key` from the name.
    { name: "products", omit: ["name_key"] },
    { name: "location_catalogues", locationColumns: ["location_id"] },
    { name: "ingredients" },
    { name: "recipe_lines" },
    { name: "canvases" },
    { name: "device_profiles", leaveBehindWhenSet: "retired_at" },
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
    { name: "page_printers", locationColumns: ["location_id"], reconnect: true },
    { name: "device_profile_printers" },
    { name: "station_printers" },
    { name: "watcher_printers" },
    { name: "tenant_themes" },
    { name: "tenant_receipts" },
  ],
  validate: validateCoreConfiguration,
} as const;
