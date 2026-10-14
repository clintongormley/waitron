import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";

/** Clears untraded provision fixtures without deleting ledger rows or disabling their triggers. */
export async function clearProvisionFixture(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of [
      // A season day's range keys its period with no delete rule; the days take their ranges.
      "department_days",
      "zone_days",
      "seasons",
      // Its location key has no delete rule; its dates go with it.
      "special_days",
      "period_extensions",
      "zone_extensions",
      "holiday_geographies",
      "menu_period_staff_menus",
      "menu_periods",
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
      "zone_service_policies",
      "departments",
      "tenant_credentials",
      "management_sessions",
      "device_profiles",
      "canvases",
      "persons",
      "cadenas",
      "registro_sif",
      "invoice_series",
      "nodes",
      "device_made_here_stations",
      "kitchen_station_timing",
      "kitchen_stations",
      "floor_zones",
      "location_catalogues",
      "kitchen_timing_defaults",
      "location_day_cutover_changes",
      "location_business_day_settings",
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
