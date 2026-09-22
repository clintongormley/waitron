import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";

/** Clears untraded provision fixtures without deleting ledger rows or disabling their triggers. */
export async function clearProvisionFixture(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of [
      "department_hours",
      "preparation_routes",
      "device_zone_defaults",
      // The policy goes BEFORE the menus it names. `zone_service_policies_default_allowed_fk`
      // points (zone_id, default_menu_id) at `zone_menus`, and the DEFERRABLE INITIALLY DEFERRED
      // it carried on PostgreSQL does not survive sqlite-core, so the check lands at the statement
      // rather than at commit (`packages/venue-service/src/schema/service.ts`).
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
      "kitchen_stations",
      "floor_zones",
      "location_catalogues",
      "locations",
      "catalogues",
      "content_languages",
      "product_units",
      "units",
      "unit_seed_states",
      "tenants",
      "deployment",
    ]) {
      await tx.execute(sql`delete from ${sql.identifier(table)}`);
    }
  });
}
