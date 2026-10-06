import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";

/** Clears untraded provision fixtures without deleting ledger rows or disabling their triggers. */
export async function clearProvisionFixture(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of [
      "local_holidays",
      "holiday_geographies",
      // The hours tables' keys to departments and stations have no delete rule, so they go first.
      "special_date_hours_periods",
      "special_date_hours",
      "special_dates",
      "hours_week_periods",
      "hours_week_cells",
      "department_sale_policies",
      "zone_sale_policies",
      "station_day_states",
      "station_fallbacks",
      "route_exceptions",
      "station_claims",
      "device_zone_defaults",
      // The policy goes BEFORE the menus it names: `zone_service_policies_default_allowed_fk`
      // points (zone_id, default_menu_id) at `zone_menus`.
      "zone_service_policies",
      "zone_menus",
      "departments",
      "tenant_credentials",
      "management_sessions",
      "device_profiles",
      "canvases",
      "persons",
      "cadenas",
      "registro_sif",
      "contadores_instalacion",
      "invoice_series",
      "nodes",
      "device_made_here_stations",
      "watcher_item_marks",
      "watcher_printers",
      "watcher_stations",
      "watcher_zones",
      "watchers",
      "kitchen_station_timing",
      "kitchen_stations",
      "floor_zones",
      "location_catalogues",
      "kitchen_timing_defaults",
      "locations",
      // Before the menus: `menu_details`' keys and `sections_owner_menu_fk` have no delete rule.
      "menu_details",
      "sections",
      "catalogues",
      "content_languages",
      "product_units",
      "units",
      "unit_seed_states",
      "tenants",
      "node_roles",
      "deployment",
    ]) {
      await tx.execute(sql`delete from ${sql.identifier(table)}`);
    }
  });
}
