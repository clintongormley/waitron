import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";

/** Clears untraded provision fixtures without deleting ledger rows or disabling their triggers. */
export async function clearProvisionFixture(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of [
      "period_extensions",
      "zone_extensions",
      "holiday_geographies",
      "menu_slots",
      "menu_day_timetables",
      "menu_period_staff_menus",
      "menu_periods",
      // The hours tables' keys to departments and stations have no delete rule, so they go first.
      "special_dates",
      "department_sale_policies",
      "zone_sale_policies",
      "station_day_states",
      "routing_cell_periods",
      "routing_cells",
      "device_profile_zones",
      "device_profile_service_access",
      "device_kitchen_screen_removals",
      "device_kitchen_screen_stations",
      "device_kitchen_screen_zones",
      "device_kitchen_screens",
      "device_profile_kitchen_screen_stations",
      "device_profile_kitchen_screen_zones",
      "device_profile_kitchen_screens",
      "device_profile_admission_roles",
      "device_profile_admission_persons",
      "device_approved_profiles",
      "zone_closed_times",
      "zone_service_policies",
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
