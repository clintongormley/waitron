import {
  AppError,
  isBumpMode,
  isChangesAfterSending,
  isStationColour,
  isTicketGrouping,
} from "@waitron/shared";
import "./errors.js";

export function validateCoreConfiguration(
  tables: Readonly<Record<string, readonly Record<string, unknown>[]>>,
): void {
  for (const row of tables.kitchen_stations ?? []) {
    if (row.colour !== undefined && !isStationColour(row.colour))
      throw new AppError("setup.request_invalid", { field: "kitchen_stations.colour" });
    if (row.ticket_grouping !== undefined && !isTicketGrouping(row.ticket_grouping))
      throw new AppError("setup.request_invalid", { field: "kitchen_stations.ticket_grouping" });
    if (row.bump_mode !== undefined && !isBumpMode(row.bump_mode))
      throw new AppError("setup.request_invalid", { field: "kitchen_stations.bump_mode" });
    if (
      row.changes_after_sending !== undefined &&
      !isChangesAfterSending(row.changes_after_sending)
    )
      throw new AppError("setup.request_invalid", {
        field: "kitchen_stations.changes_after_sending",
      });
  }
  for (const table of ["kitchen_courses", "kitchen_stations", "floor_zones"])
    for (const row of tables[table] ?? [])
      if (row.active === 0 || row.active === false)
        throw new AppError("setup.request_invalid", { field: `${table}.active` });
  for (const row of tables.printers ?? []) {
    if (row.deleted_at !== undefined && row.deleted_at !== null)
      throw new AppError("setup.request_invalid", { field: "printers.deleted_at" });
    if (row.pickup_roles !== undefined && !isPrinterPickupSet(row.pickup_roles))
      throw new AppError("setup.request_invalid", { field: "printers.pickup_roles" });
  }
}

export const CORE_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [
    { name: "catalogues" },
    {
      name: "kitchen_stations",
      leaveBehindWhenFalse: "active",
      locationColumns: ["location_id"],
    },
    { name: "kitchen_courses", locationColumns: ["location_id"], leaveBehindWhenFalse: "active" },
    { name: "categories" },
    // The catalogue module's `afterImport` sets `name_key` from the name.
    { name: "products", omit: ["name_key"] },
    { name: "location_catalogues", locationColumns: ["location_id"] },
    { name: "ingredients" },
    { name: "recipe_lines" },
    { name: "device_profiles", leaveBehindWhenSet: "retired_at" },
    { name: "floor_zones", locationColumns: ["location_id"], leaveBehindWhenFalse: "active" },
    {
      name: "dining_tables",
      locationColumns: ["location_id"],
      omit: ["needs_clearing_since"],
    },
    { name: "floor_plan_sets", locationColumns: ["location_id"] },
    { name: "floor_plans" },
    { name: "floor_plan_tables" },
    { name: "floor_plan_placements" },
    { name: "floor_plan_table_parts" },
    { name: "floor_plan_table_sizes" },
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
      leaveBehindWhenSet: "deleted_at",
    },
    { name: "page_printers", locationColumns: ["location_id"], reconnect: true },
    { name: "device_profile_printers" },
    { name: "station_printers" },
    { name: "custom_themes" },
  ],
  validate: validateCoreConfiguration,
} as const;

function isPrinterPickupSet(value: unknown): boolean {
  if (typeof value !== "string") return false;
  let roles: unknown;
  try {
    roles = JSON.parse(value);
  } catch {
    return false;
  }
  return (
    Array.isArray(roles) &&
    roles.every(
      (role) => typeof role === "string" && (role === "receipt" || role === "payment_slip"),
    )
  );
}
