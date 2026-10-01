import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";

/** Clears untraded provision fixtures without deleting ledger rows or disabling their triggers. */
export async function clearProvisionFixture(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of [
      "department_hours",
      "station_day_states",
      "station_fallbacks",
      "station_hours",
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
      "tills",
      "device_made_here_stations",
      "kitchen_stations",
      "floor_zones",
      "location_catalogues",
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
