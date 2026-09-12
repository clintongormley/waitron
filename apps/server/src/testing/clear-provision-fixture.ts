import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";

/** Clears untraded provision fixtures without deleting ledger rows or disabling their triggers. */
export async function clearProvisionFixture(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of [
      "department_hours",
      "preparation_routes",
      "device_zone_defaults",
      "zone_menus",
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
      "tills",
      "kitchen_stations",
      "floor_zones",
      "location_catalogues",
      "locations",
      "catalogues",
      "content_languages",
      "tenants",
      "deployment",
    ]) {
      await tx.execute(sql`delete from ${sql.identifier(table)}`);
    }
  });
}
